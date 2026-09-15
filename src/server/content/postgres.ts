import { Pool, type PoolConfig, type PoolClient } from 'pg';

let editorialPool: Pool | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildPostgresPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = (env.DATABASE_URL ?? env.INFIDASH_DATABASE_URL ?? '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the editorial PostgreSQL pool');
  }

  const sslMode = (env.DATABASE_SSL ?? '').trim().toLowerCase();
  const ssl = sslMode && sslMode !== 'disable'
    ? { rejectUnauthorized: sslMode !== 'no-verify' }
    : undefined;

  return {
    connectionString,
    max: parsePositiveInteger(env.EDITORIAL_DB_POOL_MAX, 10),
    idleTimeoutMillis: parsePositiveInteger(env.EDITORIAL_DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parsePositiveInteger(env.EDITORIAL_DB_CONNECTION_TIMEOUT_MS, 5_000),
    application_name: env.EDITORIAL_DB_APPLICATION_NAME?.trim() || 'infidash-editorial',
    ssl,
  };
}

export function getEditorialPool() {
  if (!editorialPool) {
    editorialPool = new Pool(buildPostgresPoolConfig());
    editorialPool.on('error', (error) => {
      console.error('[infidash] idle editorial PostgreSQL client failed', error.message);
    });
  }

  return editorialPool;
}

export async function closeEditorialPool() {
  const pool = editorialPool;
  editorialPool = null;
  if (pool) {
    await pool.end();
  }
}

export async function withEditorialTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  pool: Pool = getEditorialPool(),
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

