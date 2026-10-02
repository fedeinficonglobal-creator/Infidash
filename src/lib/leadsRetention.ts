import type { CoreQueryable } from './corePool.js';
import type { LockResult } from './backupScheduler.js';

/**
 * Lead data retention (GDPR storage limitation), see docs/gdpr-retention.md.
 *
 * - Leads older than LEADS_RETENTION_MONTHS (default 24) are deleted.
 * - The raw webhook payload of leads older than LEADS_RAW_PAYLOAD_DAYS (default 90) is blanked to '{}'; the
 *   structured columns (name, email, phone, message) stay until the lead itself expires.
 *
 * Cutoff computation and the scheduling state machine are pure over injected dependencies (clock, purge function,
 * lock, logger), so they are unit-tested without PostgreSQL. server.ts wires the real ones.
 */

export const DEFAULT_LEADS_RETENTION_MONTHS = 24;
export const MAX_LEADS_RETENTION_MONTHS = 120;
export const DEFAULT_LEADS_RAW_PAYLOAD_DAYS = 90;
export const MAX_LEADS_RAW_PAYLOAD_DAYS = 3650;
export const LEADS_RETENTION_LOCK_ID = 4_790_321_774;
export const LEADS_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const LEADS_RETENTION_FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
export const LEADS_PURGE_BATCH_SIZE = 500;

export interface LeadsRetentionConfig {
  retentionMonths: number;
  rawPayloadDays: number;
}

export interface LeadsCutoffs {
  deleteBefore: Date;
  blankPayloadBefore: Date;
}

export interface LeadsPurgeResult {
  deleted: number;
  payloadsBlanked: number;
}

function parseBoundedInteger(raw: string | undefined, max: number, fallback: number) {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  // 0 is invalid on purpose: retention cannot be switched off through the environment.
  return Number.isSafeInteger(value) && value >= 1 && value <= max ? value : fallback;
}

export function resolveLeadsRetention(env: Record<string, string | undefined> = process.env): LeadsRetentionConfig {
  return {
    retentionMonths: parseBoundedInteger(env.LEADS_RETENTION_MONTHS, MAX_LEADS_RETENTION_MONTHS, DEFAULT_LEADS_RETENTION_MONTHS),
    rawPayloadDays: parseBoundedInteger(env.LEADS_RAW_PAYLOAD_DAYS, MAX_LEADS_RAW_PAYLOAD_DAYS, DEFAULT_LEADS_RAW_PAYLOAD_DAYS),
  };
}

/** Calendar-month subtraction in UTC; the day is clamped to the last day of shorter months (Mar 31 - 1 = Feb 28). */
export function subtractMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function computeLeadsCutoffs(now: Date, config: LeadsRetentionConfig): LeadsCutoffs {
  return {
    deleteBefore: subtractMonthsUtc(now, config.retentionMonths),
    blankPayloadBefore: new Date(now.getTime() - config.rawPayloadDays * 24 * 60 * 60 * 1000),
  };
}

/**
 * Deletes expired leads and blanks old raw payloads, in batches so a large backlog never holds one long lock.
 * Callers pass a pool or a transaction client; all values are bound parameters.
 */
export async function purgeLeads(db: CoreQueryable, cutoffs: LeadsCutoffs, batchSize = LEADS_PURGE_BATCH_SIZE): Promise<LeadsPurgeResult> {
  let deleted = 0;
  for (;;) {
    const result = await db.query(
      `DELETE FROM leads WHERE id IN (SELECT id FROM leads WHERE received_at < $1::timestamptz ORDER BY received_at LIMIT $2)`,
      [cutoffs.deleteBefore.toISOString(), batchSize],
    );
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < batchSize) break;
  }

  let payloadsBlanked = 0;
  for (;;) {
    const result = await db.query(
      `UPDATE leads SET raw_payload_json = '{}' WHERE id IN (
         SELECT id FROM leads WHERE received_at < $1::timestamptz AND raw_payload_json <> '{}' ORDER BY received_at LIMIT $2
       )`,
      [cutoffs.blankPayloadBefore.toISOString(), batchSize],
    );
    const count = result.rowCount ?? 0;
    payloadsBlanked += count;
    if (count < batchSize) break;
  }

  return { deleted, payloadsBlanked };
}

export type LeadsRetentionOutcome = 'ok' | 'locked' | 'busy' | 'failed';

export interface LeadsRetentionDeps {
  config: LeadsRetentionConfig;
  now: () => Date;
  purge: (cutoffs: LeadsCutoffs) => Promise<LeadsPurgeResult>;
  withLock: <T>(fn: () => Promise<T>) => Promise<LockResult<T>>;
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

export function createLeadsRetentionRunner(deps: LeadsRetentionDeps) {
  let running = false;

  async function tick(): Promise<LeadsRetentionOutcome> {
    if (running) return 'busy';
    running = true;
    try {
      const locked = await deps.withLock(async () => {
        const cutoffs = computeLeadsCutoffs(deps.now(), deps.config);
        const result = await deps.purge(cutoffs);
        // Counts only: personal data is never logged.
        if (result.deleted > 0 || result.payloadsBlanked > 0) {
          deps.log('info', 'retencion de leads aplicada', {
            deleted: result.deleted,
            payloadsBlanked: result.payloadsBlanked,
            retentionMonths: deps.config.retentionMonths,
            rawPayloadDays: deps.config.rawPayloadDays,
          });
        }
        return 'ok' as const;
      });
      return locked.acquired ? locked.value : 'locked';
    } catch (error) {
      deps.log('error', 'leads retention failed', { error: error instanceof Error ? error.message : String(error) });
      return 'failed';
    } finally {
      running = false;
    }
  }

  return { tick, getConfig: () => ({ ...deps.config }) };
}

export type LeadsRetentionRunner = ReturnType<typeof createLeadsRetentionRunner>;

/** First run delayed, then daily; timers are unref'ed and errors never escape. Returns a stop function. */
export function startLeadsRetentionTimers(runner: LeadsRetentionRunner, log: LeadsRetentionDeps['log']): () => void {
  const config = runner.getConfig();
  log('info', 'retencion de leads activada', { retentionMonths: config.retentionMonths, rawPayloadDays: config.rawPayloadDays });
  const run = () => {
    runner.tick().catch((error) => log('error', 'leads retention tick failed', { error: error instanceof Error ? error.message : String(error) }));
  };
  const first = setTimeout(run, LEADS_RETENTION_FIRST_RUN_DELAY_MS);
  const interval = setInterval(run, LEADS_RETENTION_INTERVAL_MS);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
