import { Pool, types as pgTypes, type PoolConfig } from 'pg';
import { logger } from './logger.js';
import { buildPostgresPoolConfig } from '../server/content/postgres.js';

// Async, fully parameterized access to the core (public schema) tables. It shares the connection string, SSL and
// timeout configuration with the editorial pool, but owns a separate pool so core traffic cannot starve editorial
// jobs (and vice versa). Callers use $1..$n placeholders only; values never get inlined into the SQL text.

/** Minimal surface of `pg.Pool` / `pg.PoolClient` used by the helpers, so tests can pass a fake. */
export interface CoreQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

let corePool: Pool | null = null;

const PG_DATE_OID = 1082;
const PG_TIMESTAMPTZ_OID = 1184;

/**
 * pg turns DATE into a JavaScript Date at local midnight, which shifts the day across time zones. The whole API
 * contract uses plain 'YYYY-MM-DD' strings (daily_stats.stat_date is the only DATE column), so the core pool hands
 * DATE values back as the raw text PostgreSQL sends. Scoped to this pool through the per-client `types` option: the
 * editorial pool and the global pg parsers are untouched, and every other type keeps its default parser.
 *
 * TIMESTAMPTZ (sessions.expires_at, leads.received_at) is handed back as the fixed-width UTC string the API always
 * used ('YYYY-MM-DDTHH:mm:ss.sssZ', i.e. Date#toISOString()), whatever offset or microsecond precision PostgreSQL
 * prints. pg's own parser does the text parsing (offsets, fractions); a value it cannot turn into a finite Date
 * (infinity, out-of-range) is passed through untouched rather than throwing while a row is being read.
 */
const parseTimestamptzDefault = pgTypes.getTypeParser(PG_TIMESTAMPTZ_OID, 'text') as unknown as (value: string) => unknown;

export function parseTimestamptzAsIso(value: string): string {
  const parsed = parseTimestamptzDefault(value);
  return parsed instanceof Date && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

export const coreTypeParsers = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === PG_DATE_OID) return (value: string) => value;
    if (oid === PG_TIMESTAMPTZ_OID && format !== 'binary') return parseTimestamptzAsIso;
    return pgTypes.getTypeParser(oid, format as 'text');
  },
} as NonNullable<PoolConfig['types']>;

export function buildCorePoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const base = buildPostgresPoolConfig(env);
  const configuredMax = Number(env.CORE_DB_POOL_MAX);
  return {
    ...base,
    max: Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : base.max,
    application_name: env.CORE_DB_APPLICATION_NAME?.trim() || 'infidash-core',
    // Idle clients must not keep scripts and test processes alive after the last query.
    allowExitOnIdle: true,
    types: coreTypeParsers,
  };
}

export function getCorePool() {
  if (!corePool) {
    corePool = new Pool(buildCorePoolConfig());
    corePool.on('error', (error) => {
      logger.error({ err: error }, 'idle core PostgreSQL client failed');
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
  // Already rewritten (e.g. thrown by a helper inside a transaction callback): never prefix twice.
  if (error.message.startsWith('ERROR:  ')) return error;

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

/** A pooled connection that can be returned to (or, given an error, destroyed by) its pool. */
export interface CoreTransactionClient extends CoreQueryable {
  release(error?: Error | boolean): void;
}

/** Minimal surface of `pg.Pool` needed to run a transaction, so tests can pass a fake. */
export interface CoreTransactionPool {
  connect(): Promise<CoreTransactionClient>;
}

/**
 * Runs `fn` inside one transaction on a single pooled connection: BEGIN, then COMMIT when `fn` resolves or ROLLBACK
 * when it (or the COMMIT) fails. The callback receives a queryable bound to that connection and must use it for every
 * statement that has to be atomic. The connection is always released; if the ROLLBACK itself fails it is destroyed
 * instead of being returned to the pool. Integrity errors are rethrown in the psql-style message shape.
 */
export async function withCoreTransaction<T>(
  fn: (tx: CoreQueryable) => Promise<T>,
  pool: CoreTransactionPool = getCorePool(),
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await runQuery(client, 'BEGIN', []);
    try {
      const result = await fn(client);
      await runQuery(client, 'COMMIT', []);
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw mapCorePgError(error);
    }
  } finally {
    client.release(releaseError);
  }
}
