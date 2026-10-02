import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { logger as structuredLogger } from '../lib/logger.js';
import { discoverMigrations } from './content/migrations.js';

export interface HealthResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export type HealthCheck = (deep: boolean) => Promise<HealthResult>;

interface Queryable {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface HealthCheckOptions {
  /** The editorial pg.Pool: an async SELECT 1 proves reachability and credentials of the shared database. */
  pool: Queryable;
  migrationsDirectory?: string;
  timeoutMs?: number;
  now?: () => number;
  /** Minimum time between two failure log lines. */
  logIntervalMs?: number;
  logger?: (...args: unknown[]) => void;
  /**
   * Optional core-layer probe, only used by `?deep=1`: an async SELECT 1 on the core pool (bounded by the same
   * timeout). It is kept off the shallow check that orchestrators poll so that probe stays a single query.
   */
  coreCheck?: () => void | Promise<void>;
}

const DEGRADED: HealthResult = { statusCode: 503, body: { status: 'degraded', checks: { database: 'down' } } };

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`health check timed out after ${timeoutMs}ms`)), timeoutMs);
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createHealthCheck(options: HealthCheckOptions): HealthCheck {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const now = options.now ?? Date.now;
  const logIntervalMs = options.logIntervalMs ?? 30_000;
  const logger = options.logger ?? ((message: unknown, error?: unknown) => structuredLogger.error({ err: error }, String(message).replace(/^\[infidash\] /, '')));
  const migrationsDirectory = options.migrationsDirectory ?? path.resolve(process.cwd(), 'db', 'migrations');
  let lastLogAt = Number.NEGATIVE_INFINITY;

  function logFailure(error: unknown) {
    const at = now();
    if (at - lastLogAt < logIntervalMs) return;
    lastLogAt = at;
    logger('[infidash] health check failed', error);
  }

  async function run(deep: boolean): Promise<HealthResult> {
    try {
      await withTimeout(() => options.pool.query('SELECT 1'), timeoutMs);
    } catch (error) {
      logFailure(error);
      return DEGRADED;
    }
    if (!deep) return { statusCode: 200, body: { status: 'ok' } };

    const checks: Record<string, unknown> = { database: 'ok' };
    let healthy = true;
    try {
      const files = await discoverMigrations(migrationsDirectory);
      const registry = await withTimeout(() => options.pool.query('SELECT version FROM public.schema_migrations'), timeoutMs);
      const applied = new Set(registry.rows.map((row) => String(row.version)));
      const pending = files.filter((file) => !applied.has(file)).length;
      checks.migrations = { applied: files.length - pending, pending };
      if (pending > 0) healthy = false;
    } catch (error) {
      logFailure(error);
      checks.migrations = 'unknown';
      healthy = false;
    }
    if (options.coreCheck) {
      try {
        const coreCheck = options.coreCheck;
        await withTimeout(async () => coreCheck(), timeoutMs);
        checks.core = 'ok';
      } catch (error) {
        logFailure(error);
        checks.core = 'down';
        healthy = false;
      }
    }
    return { statusCode: healthy ? 200 : 503, body: { status: healthy ? 'ok' : 'degraded', checks } };
  }

  return async (deep) => {
    try {
      return await run(deep);
    } catch (error) {
      logFailure(error);
      return DEGRADED;
    }
  };
}

/** Public, unauthenticated and exempt from rate limiting (see security.ts). Never throws. */
export function registerHealthRoute(app: FastifyInstance, check: HealthCheck) {
  app.get('/api/health', async (request, reply) => {
    const deep = (request.query as Record<string, unknown> | undefined)?.deep === '1';
    let result: HealthResult;
    try {
      result = await check(deep);
    } catch {
      result = DEGRADED;
    }
    return reply.code(result.statusCode).send(result.body);
  });
}
