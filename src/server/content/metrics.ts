import type { Pool } from 'pg';
import { sanitizeError } from './contracts.js';

/** claimJob only reclaims jobs with attempt_count < 8: from 8 on a failed job is frozen. */
export const FROZEN_ATTEMPT_COUNT = 8;
const LAST_ERROR_MAX_LENGTH = 200;
const RECENT_FAILURES = 5;

type Queryable = Pick<Pool, 'query'>;

export interface RecentFailure {
  id: string;
  kind: string;
  clientId: string;
  attemptCount: number;
  updatedAt: string | null;
  lastError: string | null;
}

export interface EditorialJobMetrics {
  byStatus: Record<string, number>;
  last24hByStatus: Record<string, number>;
  failedByKind: Record<string, { retrying: number; frozen: number }>;
  /** Failed jobs updated in the last 24h: the only figure the queue alert looks at (frozen history stays failed forever). */
  failedLast24h: number;
  failedRetrying: number;
  failedFrozen: number;
  oldestPendingAgeSeconds: number | null;
  expiredLeases: number;
  recentFailures: RecentFailure[];
}

function toIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Operational snapshot of editorial.jobs, read-only, three parallel queries (no per-row lookups):
 * counts by status/kind (all time and last 24h by updated_at, with frozen = attempt_count >= 8), queue-health scalars,
 * and the most recent failures with a redacted, truncated last_error.
 */
export async function getEditorialJobMetrics(pool: Queryable): Promise<EditorialJobMetrics> {
  const [counts, health, recent] = await Promise.all([
    pool.query(
      `SELECT status, kind, count(*)::int AS total,
              count(*) FILTER (WHERE updated_at >= now() - interval '24 hours')::int AS last24h,
              count(*) FILTER (WHERE attempt_count >= ${FROZEN_ATTEMPT_COUNT})::int AS frozen
         FROM editorial.jobs GROUP BY status, kind`,
    ),
    pool.query(
      `SELECT (SELECT floor(extract(epoch FROM now() - min(next_attempt_at)))::bigint
                 FROM editorial.jobs WHERE status = 'pending' AND next_attempt_at <= now()) AS oldest_pending_seconds,
              (SELECT count(*)::int FROM editorial.jobs WHERE status = 'running' AND locked_until < now()) AS expired_leases`,
    ),
    pool.query(
      `SELECT id, kind, client_id, attempt_count, updated_at, last_error
         FROM editorial.jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT ${RECENT_FAILURES}`,
    ),
  ]);

  const byStatus: Record<string, number> = {};
  const last24hByStatus: Record<string, number> = {};
  const failedByKind: Record<string, { retrying: number; frozen: number }> = {};
  let failedRetrying = 0;
  let failedFrozen = 0;
  for (const row of counts.rows) {
    const total = Number(row.total ?? 0);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + total;
    last24hByStatus[row.status] = (last24hByStatus[row.status] ?? 0) + Number(row.last24h ?? 0);
    if (row.status === 'failed') {
      const frozen = Number(row.frozen ?? 0);
      failedByKind[row.kind] = { retrying: total - frozen, frozen };
      failedRetrying += total - frozen;
      failedFrozen += frozen;
    }
  }

  const healthRow = health.rows[0] ?? {};
  const oldest = healthRow.oldest_pending_seconds;
  return {
    byStatus,
    last24hByStatus,
    failedByKind,
    failedLast24h: last24hByStatus.failed ?? 0,
    failedRetrying,
    failedFrozen,
    oldestPendingAgeSeconds: oldest === null || oldest === undefined ? null : Math.max(0, Number(oldest)),
    expiredLeases: Number(healthRow.expired_leases ?? 0),
    recentFailures: recent.rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      clientId: String(row.client_id),
      attemptCount: Number(row.attempt_count ?? 0),
      updatedAt: toIso(row.updated_at),
      lastError: sanitizeError(row.last_error === null || row.last_error === undefined ? null : String(row.last_error))?.slice(0, LAST_ERROR_MAX_LENGTH) ?? null,
    })),
  };
}

/**
 * Returns the alert fields when failed jobs from the last 24h reach `threshold`, otherwise null. All-time retrying/frozen
 * totals are context only: old frozen jobs stay failed forever and must not keep the alert firing.
 */
export function evaluateQueueAlert(metrics: Pick<EditorialJobMetrics, 'failedLast24h' | 'failedRetrying' | 'failedFrozen'>, threshold: number) {
  return metrics.failedLast24h > 0 && metrics.failedLast24h >= threshold
    ? { failedLast24h: metrics.failedLast24h, failedRetrying: metrics.failedRetrying, failedFrozen: metrics.failedFrozen }
    : null;
}
