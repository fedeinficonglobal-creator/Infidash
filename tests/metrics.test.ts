import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createHttpMetrics, registerHttpMetrics } from '../src/lib/httpMetrics.js';
import { evaluateQueueAlert, getEditorialJobMetrics, FROZEN_ATTEMPT_COUNT } from '../src/server/content/metrics.js';
import { createMetricsReporter, parseFailedJobsThreshold } from '../src/lib/metricsReporter.js';
import { buildMetricsReport } from '../src/server/metricsReport.js';

const MIN = 60_000;
const T0 = Date.parse('2026-10-02T10:00:30.000Z');

test('http metrics bucket statuses and latency per minute and stay bounded', () => {
  let now = T0;
  const metrics = createHttpMetrics({ now: () => now });
  metrics.record(200, 10);
  metrics.record(302, 60);
  metrics.record(404, 300);
  metrics.record(500, 3000);
  const snap = metrics.snapshot({ windowMinutes: 15 });
  assert.equal(snap.total, 4);
  assert.equal(snap.status2xx, 1);
  assert.equal(snap.status3xx, 1);
  assert.equal(snap.status4xx, 1);
  assert.equal(snap.status5xx, 1);
  assert.equal(snap.errorRatio, 0.25);
  assert.equal(snap.status5xxPerMinute, Number((1 / 15).toFixed(3)));
  assert.deepEqual(snap.latencyMs, { lt50: 1, lt100: 1, lt250: 0, lt500: 1, lt1000: 0, lt2500: 0, gte2500: 1 });

  now += 20 * MIN;
  assert.equal(metrics.snapshot({ windowMinutes: 15 }).total, 0);
  assert.equal(metrics.snapshot({ windowMinutes: 60 }).total, 4);
  now += 45 * MIN;
  metrics.record(200, 1);
  assert.equal(metrics.snapshot({ windowMinutes: 60 }).total, 1);
  assert.ok(metrics.bucketCount() <= 60);
  assert.equal(metrics.snapshot({ windowMinutes: 15 }).errorRatio, 0);
});

test('http metrics expose a single minute and never keep request data', () => {
  const metrics = createHttpMetrics({ now: () => T0 });
  metrics.record(503, 5);
  const minute = Math.floor(T0 / MIN) * MIN;
  assert.equal(metrics.minute(minute)?.status5xx, 1);
  assert.equal(metrics.minute(minute - MIN), null);
  assert.doesNotMatch(JSON.stringify(metrics.snapshot({ windowMinutes: 60 })), /http|token|\//i);
});

test('http metrics hook counts every response without keeping URLs', async () => {
  const metrics = createHttpMetrics();
  const app = Fastify();
  registerHttpMetrics(app, metrics);
  app.get('/ok/:secret', async () => ({ ok: true }));
  app.get('/boom', async () => { throw new Error('x'); });
  await app.inject('/ok/abc');
  await app.inject('/boom');
  await app.inject('/missing');
  const snap = metrics.snapshot({ windowMinutes: 15 });
  assert.equal(snap.total, 3);
  assert.equal(snap.status5xx, 1);
  assert.equal(snap.status4xx, 1);
  assert.doesNotMatch(JSON.stringify(snap), /abc|boom/);
  await app.close();
});

function fakePool(responses: Array<{ rows: any[] }>) {
  const calls: string[] = [];
  return {
    calls,
    pool: { query: async (sql: string) => { calls.push(sql); return responses[calls.length - 1] ?? { rows: [] }; } } as never,
  };
}

test('editorial job metrics map aggregates, retrying vs frozen and sanitized recent failures', async () => {
  const updatedAt = new Date('2026-10-02T09:00:00.000Z');
  const { pool, calls } = fakePool([
    { rows: [
      { status: 'pending', kind: 'publish', total: 2, last24h: 1, frozen: 0 },
      { status: 'failed', kind: 'publish', total: 4, last24h: 3, frozen: 1 },
      { status: 'failed', kind: 'generate_content', total: 2, last24h: 0, frozen: 2 },
      { status: 'running', kind: 'publish', total: 1, last24h: 1, frozen: 0 },
    ] },
    { rows: [{ oldest_pending_seconds: '125', expired_leases: 3 }] },
    { rows: [{ id: 'j1', kind: 'publish', client_id: 'c1', attempt_count: 8, updated_at: updatedAt, last_error: `Bearer abc.def ${'x'.repeat(400)}` }] },
  ]);
  const metrics = await getEditorialJobMetrics(pool);
  assert.equal(calls.length, 3);
  assert.deepEqual(metrics.byStatus, { pending: 2, failed: 6, running: 1 });
  assert.deepEqual(metrics.last24hByStatus, { pending: 1, failed: 3, running: 1 });
  assert.deepEqual(metrics.failedByKind, { publish: { retrying: 3, frozen: 1 }, generate_content: { retrying: 0, frozen: 2 } });
  assert.equal(metrics.failedLast24h, 3);
  assert.equal(metrics.failedRetrying, 3);
  assert.equal(metrics.failedFrozen, 3);
  assert.equal(metrics.oldestPendingAgeSeconds, 125);
  assert.equal(metrics.expiredLeases, 3);
  assert.equal(metrics.recentFailures.length, 1);
  const failure = metrics.recentFailures[0];
  assert.equal(failure.clientId, 'c1');
  assert.equal(failure.attemptCount, 8);
  assert.equal(failure.updatedAt, updatedAt.toISOString());
  assert.ok((failure.lastError ?? '').length <= 200);
  assert.doesNotMatch(failure.lastError ?? '', /abc\.def/);
  assert.equal(FROZEN_ATTEMPT_COUNT, 8);
  assert.ok(calls.every((sql) => sql.includes('editorial.jobs')));
});

test('editorial job metrics handle an empty queue', async () => {
  const { pool } = fakePool([{ rows: [] }, { rows: [{ oldest_pending_seconds: null, expired_leases: 0 }] }, { rows: [] }]);
  const metrics = await getEditorialJobMetrics(pool);
  assert.equal(metrics.oldestPendingAgeSeconds, null);
  assert.equal(metrics.failedRetrying + metrics.failedFrozen, 0);
  assert.deepEqual(metrics.recentFailures, []);
});

test('queue alert counts only failures from the last 24h', () => {
  assert.equal(evaluateQueueAlert({ failedLast24h: 0, failedRetrying: 0, failedFrozen: 0 }, 1), null);
  // Old frozen failures only: all-time totals are high but nothing failed recently.
  assert.equal(evaluateQueueAlert({ failedLast24h: 0, failedRetrying: 0, failedFrozen: 12 }, 1), null);
  assert.deepEqual(
    evaluateQueueAlert({ failedLast24h: 1, failedRetrying: 0, failedFrozen: 12 }, 1),
    { failedLast24h: 1, failedRetrying: 0, failedFrozen: 12 },
  );
  assert.equal(evaluateQueueAlert({ failedLast24h: 1, failedRetrying: 1, failedFrozen: 0 }, 2), null);
});

test('threshold parsing falls back to 1', () => {
  assert.equal(parseFailedJobsThreshold(undefined), 1);
  assert.equal(parseFailedJobsThreshold('5'), 5);
  assert.equal(parseFailedJobsThreshold('0'), 1);
  assert.equal(parseFailedJobsThreshold('abc'), 1);
});

function reporterHarness(options: { recent?: number; failed?: number; frozen?: number; threshold?: number } = {}) {
  let now = T0;
  const http = createHttpMetrics({ now: () => now });
  const logs: Array<[string, string, Record<string, unknown>]> = [];
  const reporter = createMetricsReporter({
    now: () => now,
    http,
    getJobMetrics: async () => ({ failedLast24h: options.recent ?? 0, failedRetrying: options.failed ?? 0, failedFrozen: options.frozen ?? 0 }),
    log: (level, message, meta) => logs.push([level, message, meta]),
    failedJobsThreshold: options.threshold ?? 1,
  });
  return { http, logs, reporter, advance: (ms: number) => { now += ms; } };
}

test('reporter is silent when healthy', async () => {
  const h = reporterHarness();
  h.http.record(200, 5);
  h.advance(MIN);
  await h.reporter.tick();
  assert.deepEqual(h.logs, []);
});

test('reporter logs one summary for a minute with 5xx and never repeats it', async () => {
  const h = reporterHarness();
  h.http.record(200, 5);
  h.http.record(500, 5);
  await h.reporter.tick();
  assert.deepEqual(h.logs, []);
  h.advance(MIN);
  await h.reporter.tick();
  await h.reporter.tick();
  assert.equal(h.logs.length, 1);
  const [level, message, meta] = h.logs[0];
  assert.equal(level, 'info');
  assert.equal(message, 'http minute summary');
  assert.equal(meta.total, 2);
  assert.equal(meta.status5xx, 1);
  assert.equal(meta.errorRatio, 0.5);
  assert.equal(meta.minute, new Date(Math.floor(T0 / MIN) * MIN).toISOString());
});

test('reporter rate-limits the queue alert to once per 10 minutes', async () => {
  const h = reporterHarness({ recent: 2, failed: 2, frozen: 1 });
  await h.reporter.tick();
  assert.equal(h.logs.length, 1);
  assert.deepEqual(h.logs[0].slice(0, 2), ['warn', 'editorial queue alert']);
  assert.equal(h.logs[0][2].failedRetrying, 2);
  assert.equal(h.logs[0][2].failedLast24h, 2);
  h.advance(9 * MIN);
  await h.reporter.tick();
  assert.equal(h.logs.length, 1);
  h.advance(MIN);
  await h.reporter.tick();
  assert.equal(h.logs.length, 2);
});

test('reporter stays silent for old frozen failures only', async () => {
  const h = reporterHarness({ recent: 0, failed: 0, frozen: 9 });
  await h.reporter.tick();
  h.advance(11 * MIN);
  await h.reporter.tick();
  assert.deepEqual(h.logs, []);
});

test('reporter survives a failing job query', async () => {
  const now = T0;
  const logs: unknown[] = [];
  const reporter = createMetricsReporter({
    now: () => now, http: createHttpMetrics({ now: () => now }),
    getJobMetrics: async () => { throw new Error('db down'); },
    log: (...args) => logs.push(args), failedJobsThreshold: 1,
  });
  await reporter.tick();
  assert.equal(logs.length, 0);
});

test('metrics report degrades each failing section without failing the whole', async () => {
  const http = createHttpMetrics({ now: () => T0 });
  http.record(500, 10);
  const report = await buildMetricsReport({
    now: () => new Date(T0),
    uptimeSeconds: () => 42.7,
    memoryUsage: () => ({ rss: 100 * 1024 * 1024, heapUsed: 50 * 1024 * 1024 }),
    http,
    pingCore: async () => { throw new Error('postgres://u:pw@host/db'); },
    pingEditorial: async () => undefined,
    getJobMetrics: async () => { throw new Error('boom'); },
    getBackupLastRun: () => ({ at: 'x', ok: true, name: 'a.sql.gz' }),
    getDisk: async () => null,
  });
  assert.equal(report.generatedAt, new Date(T0).toISOString());
  assert.equal(report.uptimeSeconds, 42);
  assert.deepEqual(report.process, { rssMb: 100, heapUsedMb: 50 });
  assert.equal((report.http as any).last15m.status5xx, 1);
  assert.equal((report.http as any).last60m.status5xx, 1);
  assert.equal((report.db as any).coreOk, false);
  assert.equal((report.db as any).editorialOk, true);
  assert.equal(typeof (report.db as any).editorialLatencyMs, 'number');
  assert.deepEqual(report.editorialJobs, { error: 'unavailable' });
  assert.deepEqual(report.backups, { lastRun: { at: 'x', ok: true, name: 'a.sql.gz' } });
  assert.equal('disk' in report, false);
  assert.doesNotMatch(JSON.stringify(report), /postgres:|pw@/);
});

test('metrics report cuts a hanging ping at the timeout', async () => {
  const report = await buildMetricsReport({
    now: () => new Date(T0), uptimeSeconds: () => 1, memoryUsage: () => ({ rss: 0, heapUsed: 0 }),
    http: createHttpMetrics({ now: () => T0 }),
    pingCore: () => new Promise(() => undefined), pingEditorial: async () => undefined,
    getJobMetrics: async () => ({}) as never, pingTimeoutMs: 20,
  });
  assert.equal((report.db as any).coreOk, false);
  assert.equal((report.db as any).editorialOk, true);
});
