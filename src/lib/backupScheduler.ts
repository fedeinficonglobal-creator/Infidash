import { parseBackupFileName, parseRetentionSettings, type RetentionResult } from './backupRetention.js';
import type { BackupResult } from './databaseBackup.js';

/**
 * Daily scheduled backups. Opt-in through INFIDASH_BACKUP_SCHEDULE_HOUR (UTC hour 0..23); disabled otherwise.
 * The scheduler is a pure state machine over injected dependencies (clock, file listing, dump, retention, lock) so it
 * is fully testable without PostgreSQL or pg_dump; server.ts wires the real ones.
 */

export const BACKUP_SCHEDULER_LOCK_ID = 4_790_321_773;
export const BACKUP_CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const BACKUP_FIRST_CHECK_DELAY_MS = 60 * 1000;
export const MAX_BACKUP_ATTEMPTS_PER_DAY = 3;
export const SCHEDULED_BACKUP_LABEL = 'auto';

export interface BackupScheduleConfig {
  enabled: boolean;
  hourUtc: number | null;
  keepDaily: number;
  keepWeekly: number;
}

export function parseScheduleHour(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const hour = Number(text);
  return hour >= 0 && hour <= 23 ? hour : null;
}

export function resolveBackupSchedule(env: Record<string, string | undefined> = process.env): BackupScheduleConfig {
  const hourUtc = parseScheduleHour(env.INFIDASH_BACKUP_SCHEDULE_HOUR);
  return { enabled: hourUtc !== null, hourUtc, ...parseRetentionSettings(env) };
}

export interface BackupRunRecord {
  /** ISO time the run finished. */
  at: string;
  ok: boolean;
  name?: string;
  sizeBytes?: number;
  error?: string;
}

export type BackupTickOutcome =
  | 'disabled' | 'too-early' | 'already-done' | 'attempts-exhausted' | 'busy' | 'locked' | 'ok' | 'failed';

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface BackupSchedulerDeps {
  config: BackupScheduleConfig;
  now: () => Date;
  listFileNames: () => Promise<string[]>;
  takeBackup: (label: string) => Promise<BackupResult>;
  runRetention: () => Promise<RetentionResult>;
  withLock: <T>(fn: () => Promise<T>) => Promise<LockResult<T>>;
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
  maxAttemptsPerDay?: number;
}

export function createBackupScheduler(deps: BackupSchedulerDeps) {
  const maxAttempts = deps.maxAttemptsPerDay ?? MAX_BACKUP_ATTEMPTS_PER_DAY;
  let lastRun: BackupRunRecord | null = null;
  let running = false;
  let attemptsDay = '';
  let attempts = 0;

  async function hasAutoBackupFor(day: string) {
    return (await deps.listFileNames()).some((fileName) => {
      const parsed = parseBackupFileName(fileName);
      return parsed !== null && parsed.label === SCHEDULED_BACKUP_LABEL && parsed.createdAt.slice(0, 10) === day;
    });
  }

  async function tick(): Promise<BackupTickOutcome> {
    const { config } = deps;
    if (!config.enabled || config.hourUtc === null) return 'disabled';
    if (running) return 'busy';

    const now = deps.now();
    if (now.getUTCHours() < config.hourUtc) return 'too-early';
    const day = now.toISOString().slice(0, 10);
    if (attemptsDay !== day) {
      attemptsDay = day;
      attempts = 0;
    }
    if (attempts >= maxAttempts) return 'attempts-exhausted';

    running = true;
    try {
      if (await hasAutoBackupFor(day)) return 'already-done';

      const locked = await deps.withLock(async () => {
        // Another instance may have finished its dump between our check and acquiring the lock.
        if (await hasAutoBackupFor(day)) return 'already-done' as const;
        attempts += 1;
        try {
          const backup = await deps.takeBackup(SCHEDULED_BACKUP_LABEL);
          lastRun = { at: deps.now().toISOString(), ok: true, name: backup.name, sizeBytes: backup.sizeBytes };
          deps.log('info', 'backup programado creado', { name: backup.name, sizeBytes: backup.sizeBytes });
          try {
            const retention = await deps.runRetention();
            deps.log('info', 'retencion de backups aplicada', { kept: retention.kept.length, deleted: retention.deleted.length, failed: retention.failed.length });
          } catch (error) {
            deps.log('error', 'backup retention failed', { error: errorMessage(error) });
          }
          return 'ok' as const;
        } catch (error) {
          lastRun = { at: deps.now().toISOString(), ok: false, error: errorMessage(error) };
          deps.log('error', 'scheduled backup failed', { error: lastRun.error, attempt: attempts, maxAttempts });
          return 'failed' as const;
        }
      });
      return locked.acquired ? locked.value : 'locked';
    } catch (error) {
      // Lock or listing infrastructure failed (e.g. database unreachable): counts as an attempt for today.
      attempts += 1;
      lastRun = { at: deps.now().toISOString(), ok: false, error: errorMessage(error) };
      deps.log('error', 'scheduled backup failed', { error: lastRun.error, attempt: attempts, maxAttempts });
      return 'failed';
    } finally {
      running = false;
    }
  }

  return {
    tick,
    getLastRun: () => (lastRun ? { ...lastRun } : null),
    getConfig: () => ({ ...deps.config }),
  };
}

export type BackupScheduler = ReturnType<typeof createBackupScheduler>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Minimal surface of `pg.Pool` needed for the advisory lock, so tests can pass a fake. */
export interface AdvisoryLockPool {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
    release(error?: Error | boolean): void;
  }>;
}

/**
 * Runs `fn` while holding a session-level advisory lock (pg_try_advisory_lock) on one dedicated connection. Returns
 * `{ acquired: false }` without running `fn` when another session holds it. The lock is released in `finally`; a
 * connection that cannot unlock is destroyed instead of being returned to the pool.
 */
export async function withAdvisoryLock<T>(pool: AdvisoryLockPool, key: number, fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = await pool.connect();
  let destroy = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!rows[0]?.locked) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      } catch {
        destroy = true;
      }
    }
  } finally {
    client.release(destroy ? true : undefined);
  }
}

/** Starts the periodic check (first run delayed, timers unref'ed, errors never escape). Returns a stop function. */
export function startBackupSchedulerTimers(scheduler: BackupScheduler, log: BackupSchedulerDeps['log']): () => void {
  const config = scheduler.getConfig();
  if (!config.enabled) {
    log('info', 'backups programados desactivados (INFIDASH_BACKUP_SCHEDULE_HOUR no configurada)', { enabled: false });
    return () => {};
  }
  log('info', 'backups programados activados', {
    enabled: true, hourUtc: config.hourUtc, keepDaily: config.keepDaily, keepWeekly: config.keepWeekly,
  });
  const run = () => {
    scheduler.tick().catch((error) => log('error', 'backup scheduler tick failed', { error: errorMessage(error) }));
  };
  const first = setTimeout(run, BACKUP_FIRST_CHECK_DELAY_MS);
  const interval = setInterval(run, BACKUP_CHECK_INTERVAL_MS);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
