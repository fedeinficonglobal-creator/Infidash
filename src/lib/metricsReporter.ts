import type { HttpMetrics } from './httpMetrics.js';
import { evaluateQueueAlert, type EditorialJobMetrics } from '../server/content/metrics.js';

/**
 * Quiet structured-log reporter. Once a minute it logs `http minute summary` only for minutes that had at least one 5xx,
 * and `editorial queue alert` (rate-limited) while failed editorial jobs from the last 24h reach the threshold. Healthy = no output.
 */

export const REPORT_INTERVAL_MS = 60_000;
export const REPORT_FIRST_DELAY_MS = 60_000;
export const QUEUE_ALERT_INTERVAL_MS = 10 * 60_000;
const MAX_CATCH_UP_MINUTES = 5;

export function parseFailedJobsThreshold(raw: string | undefined) {
  const parsed = Number((raw ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export interface MetricsReporterDeps {
  now: () => number;
  http: HttpMetrics;
  getJobMetrics: () => Promise<Pick<EditorialJobMetrics, 'failedLast24h' | 'failedRetrying' | 'failedFrozen'>>;
  log: (level: 'info' | 'warn', message: string, meta: Record<string, unknown>) => void;
  failedJobsThreshold: number;
}

export function createMetricsReporter(deps: MetricsReporterDeps) {
  let lastReportedMinute = Math.floor(deps.now() / 60_000) - 1;
  let lastAlertAt = Number.NEGATIVE_INFINITY;

  function reportHttp() {
    const current = Math.floor(deps.now() / 60_000);
    const from = Math.max(lastReportedMinute + 1, current - MAX_CATCH_UP_MINUTES);
    for (let minute = from; minute < current; minute += 1) {
      const counters = deps.http.minute(minute * 60_000);
      if (counters && counters.status5xx > 0) {
        deps.log('info', 'http minute summary', {
          minute: new Date(minute * 60_000).toISOString(),
          total: counters.total,
          status5xx: counters.status5xx,
          errorRatio: Number((counters.status5xx / counters.total).toFixed(4)),
        });
      }
    }
    lastReportedMinute = Math.max(lastReportedMinute, current - 1);
  }

  async function reportQueue() {
    const now = deps.now();
    if (now - lastAlertAt < QUEUE_ALERT_INTERVAL_MS) return;
    const alert = evaluateQueueAlert(await deps.getJobMetrics(), deps.failedJobsThreshold);
    if (!alert) return;
    lastAlertAt = now;
    deps.log('warn', 'editorial queue alert', { ...alert, threshold: deps.failedJobsThreshold });
  }

  /** Never throws: a failing database must not turn the reporter into a noise source or crash the process. */
  async function tick() {
    try { reportHttp(); } catch { /* ignore */ }
    try { await reportQueue(); } catch { /* the health endpoint and request logs already surface database outages */ }
  }

  return { tick };
}

export type MetricsReporter = ReturnType<typeof createMetricsReporter>;

/** Starts the periodic tick (first run delayed, timers unref'ed). Returns a stop function. */
export function startMetricsReporterTimers(reporter: MetricsReporter): () => void {
  const first = setTimeout(() => void reporter.tick(), REPORT_FIRST_DELAY_MS);
  const interval = setInterval(() => void reporter.tick(), REPORT_INTERVAL_MS);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
