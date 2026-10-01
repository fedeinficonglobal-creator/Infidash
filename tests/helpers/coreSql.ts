// Raw-SQL helpers for the DB-backed tests: they seed or inspect rows through the same core pool the app uses,
// with $1..$n placeholders. They wait for the core schema bootstrap first, so they are safe to call before any
// data-access function has run. Only import this from tests guarded by the isolated-database harness.
import { getCorePool } from '../../src/lib/corePool.js';

async function ready() {
  const { initializeCoreDatabase } = await import('../../src/lib/database.js');
  await initializeCoreDatabase();
  return getCorePool();
}

export async function coreSqlGet<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await (await ready()).query(sql, params)).rows[0] as T | undefined;
}

export async function coreSqlAll<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await (await ready()).query(sql, params)).rows as T[];
}

/** Runs one statement and returns the number of affected rows. */
export async function coreSqlRun(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  return { changes: (await (await ready()).query(sql, params)).rowCount ?? 0 };
}

/** Runs a parameterless statement (or several, separated by semicolons) over the simple query protocol. */
export async function coreSqlExec(sql: string): Promise<void> {
  await (await ready()).query(sql);
}
