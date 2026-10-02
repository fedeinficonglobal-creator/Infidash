import type { FastifyInstance } from 'fastify';

/**
 * In-memory HTTP request metrics: per-minute buckets for the last hour with status-class counters and a fixed latency
 * histogram. Only counters are stored (never URLs, ids, headers or bodies), so nothing sensitive can leak and memory
 * stays bounded (at most MAX_MINUTES buckets).
 */

export const MAX_MINUTES = 60;
const MINUTE_MS = 60_000;
// Upper bounds (exclusive) of the latency histogram buckets, in milliseconds; the last bucket is open-ended.
const LATENCY_BOUNDS_MS = [50, 100, 250, 500, 1000, 2500] as const;
const LATENCY_KEYS = ['lt50', 'lt100', 'lt250', 'lt500', 'lt1000', 'lt2500', 'gte2500'] as const;

export type LatencyHistogram = Record<(typeof LATENCY_KEYS)[number], number>;

export interface MinuteCounters {
  total: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  latencyMs: LatencyHistogram;
}

export interface HttpMetricsSnapshot extends MinuteCounters {
  windowMinutes: number;
  status5xxPerMinute: number;
  errorRatio: number;
}

function emptyCounters(): MinuteCounters {
  return { total: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0, latencyMs: { lt50: 0, lt100: 0, lt250: 0, lt500: 0, lt1000: 0, lt2500: 0, gte2500: 0 } };
}

function latencyKey(durationMs: number) {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => durationMs < bound);
  return LATENCY_KEYS[index === -1 ? LATENCY_KEYS.length - 1 : index];
}

export function createHttpMetrics(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const buckets = new Map<number, MinuteCounters>();

  const currentIndex = () => Math.floor(now() / MINUTE_MS);

  function prune(index: number) {
    for (const key of buckets.keys()) {
      if (key <= index - MAX_MINUTES) buckets.delete(key);
    }
  }

  function record(statusCode: number, durationMs: number) {
    const index = currentIndex();
    prune(index);
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = emptyCounters();
      buckets.set(index, bucket);
    }
    bucket.total += 1;
    const statusClass = Math.floor(statusCode / 100);
    if (statusClass === 2) bucket.status2xx += 1;
    else if (statusClass === 3) bucket.status3xx += 1;
    else if (statusClass === 4) bucket.status4xx += 1;
    else if (statusClass === 5) bucket.status5xx += 1;
    bucket.latencyMs[latencyKey(Number.isFinite(durationMs) ? durationMs : 0)] += 1;
  }

  /** Counters of the minute containing `minuteStartMs`, or null when nothing was recorded in it. */
  function minute(minuteStartMs: number): MinuteCounters | null {
    const bucket = buckets.get(Math.floor(minuteStartMs / MINUTE_MS));
    return bucket ? { ...bucket, latencyMs: { ...bucket.latencyMs } } : null;
  }

  function snapshot(options: { windowMinutes: number }): HttpMetricsSnapshot {
    const windowMinutes = Math.min(MAX_MINUTES, Math.max(1, Math.floor(options.windowMinutes)));
    const index = currentIndex();
    const sum = emptyCounters();
    for (let offset = 0; offset < windowMinutes; offset += 1) {
      const bucket = buckets.get(index - offset);
      if (!bucket) continue;
      sum.total += bucket.total;
      sum.status2xx += bucket.status2xx;
      sum.status3xx += bucket.status3xx;
      sum.status4xx += bucket.status4xx;
      sum.status5xx += bucket.status5xx;
      for (const key of LATENCY_KEYS) sum.latencyMs[key] += bucket.latencyMs[key];
    }
    return {
      windowMinutes,
      ...sum,
      status5xxPerMinute: Number((sum.status5xx / windowMinutes).toFixed(3)),
      errorRatio: sum.total ? Number((sum.status5xx / sum.total).toFixed(4)) : 0,
    };
  }

  return { record, minute, snapshot, bucketCount: () => buckets.size };
}

export type HttpMetrics = ReturnType<typeof createHttpMetrics>;

/** Counts every finished response (including health and polling routes) from an onResponse hook. */
export function registerHttpMetrics(app: FastifyInstance, metrics: HttpMetrics) {
  app.addHook('onResponse', (_request, reply, done) => {
    try {
      metrics.record(reply.statusCode, reply.elapsedTime);
    } catch {
      // Metrics must never affect a response.
    }
    done();
  });
}
