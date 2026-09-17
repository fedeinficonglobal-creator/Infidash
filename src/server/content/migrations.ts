import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Pool, PoolClient } from 'pg';

const MIGRATION_LOCK_ID = 4_790_321_771;
const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function discoverMigrations(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && MIGRATION_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function checksumMigration(sql: string) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function ensureMigrationRegistry(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runEditorialMigrations(
  pool: Pool,
  directory = path.resolve(process.cwd(), 'db', 'migrations'),
): Promise<MigrationResult> {
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureMigrationRegistry(client);

    for (const version of await discoverMigrations(directory)) {
      const sql = await fs.readFile(path.join(directory, version), 'utf8');
      const checksum = checksumMigration(sql);
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM public.schema_migrations WHERE version = $1',
        [version],
      );

      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${version} changed after it was applied`);
        }
        result.alreadyApplied.push(version);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)',
          [version, checksum],
        );
        await client.query('COMMIT');
        result.applied.push(version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return result;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

