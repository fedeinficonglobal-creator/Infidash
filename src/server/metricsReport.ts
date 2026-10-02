import type { HttpMetrics } from '../lib/httpMetrics.js';
import type { EditorialJobMetrics } from './content/metrics.js';

const UNAVAILABLE = { error: 'unavailable' } as const;
const MB = 1024 * 1024;

export interface MetricsReportDeps {
  now: () => Date;
  uptimeSeconds: () => number;
  memoryUsage: () => { rss: number; heapUsed: number };
  http: HttpMetrics;
  pingCore: () => Promise<unknown>;
  pingEditorial: () => Promise<unknown>;
  getJobMetrics: () => Promise<EditorialJobMetrics>;
  getBackupLastRun?: () => unknown;
  /** Returns null when the backups directory (or statfs) is not available: the section is then omitted. */
  getDisk?: () => Promise<{ usedPercent: number; freeGb: number } | null>;
  eventLoopLagMs?: () => number | null;
  pingTimeoutMs?: number;
}

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    timer.unref?.();
    let promise: Promise<T>;
    try { promise = operation(); } catch (error) { clearTimeout(timer); reject(error); return; }
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function section<T>(operation: () => T | Promise<T>): Promise<T | typeof UNAVAILABLE> {
  try { return await operation(); } catch { return UNAVAILABLE; }
}

async function probe(ping: () => Promise<unknown>, timeoutMs: number) {
  const started = performance.now();
  try {
    await withTimeout(ping, timeoutMs);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** Assembles the admin metrics payload. Each section degrades to `{ error: 'unavailable' }` on its own; nothing is rethrown. */
export async function buildMetricsReport(deps: MetricsReportDeps) {
  const pingTimeoutMs = deps.pingTimeoutMs ?? 2_000;
  const [db, editorialJobs, disk] = await Promise.all([
    section(async () => {
      const [core, editorial] = await Promise.all([probe(deps.pingCore, pingTimeoutMs), probe(deps.pingEditorial, pingTimeoutMs)]);
      return { coreOk: core.ok, coreLatencyMs: core.latencyMs, editorialOk: editorial.ok, editorialLatencyMs: editorial.latencyMs };
    }),
    section(() => withTimeout(deps.getJobMetrics, 5_000)),
    deps.getDisk ? section(deps.getDisk) : Promise.resolve(null),
  ]);

  const report: Record<string, unknown> = {
    generatedAt: deps.now().toISOString(),
    uptimeSeconds: Math.floor(deps.uptimeSeconds()),
    process: await section(() => {
      const memory = deps.memoryUsage();
      const lag = deps.eventLoopLagMs?.() ?? null;
      return { rssMb: Math.round(memory.rss / MB), heapUsedMb: Math.round(memory.heapUsed / MB), ...(lag === null ? {} : { eventLoopLagMs: lag }) };
    }),
    http: await section(() => ({ last15m: deps.http.snapshot({ windowMinutes: 15 }), last60m: deps.http.snapshot({ windowMinutes: 60 }) })),
    db,
    editorialJobs,
  };
  if (deps.getBackupLastRun) report.backups = await section(() => ({ lastRun: deps.getBackupLastRun!() }));
  if (disk) report.disk = disk;
  return report;
}
