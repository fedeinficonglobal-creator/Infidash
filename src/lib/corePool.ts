import { Pool, type PoolConfig } from 'pg';
import { buildPostgresPoolConfig } from '../server/content/postgres.js';

// Async, fully parameterized access to the core (public schema) tables. It shares the connection string, SSL and
// timeout configuration with the editorial pool, but owns a separate pool so core traffic cannot starve editorial
// jobs (and vice versa). Callers use $1..$n placeholders only; values never get inlined into the SQL text.

/** Minimal surface of `pg.Pool` / `pg.PoolClient` used by the helpers, so tests can pass a fake. */
export interface CoreQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

let corePool: Pool | null = null;

export function buildCorePoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const base = buildPostgresPoolConfig(env);
  const configuredMax = Number(env.CORE_DB_POOL_MAX);
  return {
    ...base,
    max: Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : base.max,
    application_name: env.CORE_DB_APPLICATION_NAME?.trim() || 'infidash-core',
    // Idle clients must not keep scripts and test processes alive after the last query.
    allowExitOnIdle: true,
  };
}

export function getCorePool() {
  if (!corePool) {
    corePool = new Pool(buildCorePoolConfig());
    corePool.on('error', (error) => {
      console.error('[infidash] idle core PostgreSQL client failed', error.message);
    });
  }

  return corePool;
}

export async function closeCorePool() {
  const pool = corePool;
  corePool = null;
  if (pool) {
    await pool.end();
  }
}

const PSQL_STYLE_ERROR_CODES = new Set(['23502', '23503', '23505', '23514']);

/**
 * The psql shim surfaced Postgres errors as "ERROR:  <message>\nDETAIL:  <detail>". Integrity violations keep that
 * shape (and gain the pg `code`/`constraint`) so callers and tests that match on the message keep working.
 */
export function mapCorePgError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const { code, detail, constraint } = error as Error & { code?: unknown; detail?: unknown; constraint?: unknown };
  if (typeof code !== 'string' || !PSQL_STYLE_ERROR_CODES.has(code)) return error;

  const message = `ERROR:  ${error.message}${typeof detail === 'string' && detail ? `\nDETAIL:  ${detail}` : ''}`;
  return Object.assign(new Error(message, { cause: error }), {
    code,
    constraint: typeof constraint === 'string' ? constraint : undefined,
  });
}

async function runQuery(db: CoreQueryable, sql: string, params: unknown[]) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    throw mapCorePgError(error);
  }
}

export async function coreAll<T = Record<string, any>>(db: CoreQueryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await runQuery(db, sql, params)).rows as T[];
}

export async function coreGet<T = Record<string, any>>(db: CoreQueryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await runQuery(db, sql, params)).rows[0] as T | undefined;
}

export async function coreRun(db: CoreQueryable, sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  return { changes: (await runQuery(db, sql, params)).rowCount ?? 0 };
}
