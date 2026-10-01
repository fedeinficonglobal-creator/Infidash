import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorePoolConfig,
  coreAll,
  coreGet,
  coreRun,
  mapCorePgError,
  type CoreQueryable,
} from '../src/lib/corePool.js';

function fakePool(result: { rows?: unknown[]; rowCount?: number | null } | Error) {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const pool: CoreQueryable = {
    async query(text, values) {
      calls.push({ text, values });
      if (result instanceof Error) throw result;
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? null };
    },
  };
  return { pool, calls };
}

function pgError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

test('buildCorePoolConfig reuses the editorial SSL and timeout settings and identifies the core pool', () => {
  const config = buildCorePoolConfig({
    DATABASE_URL: 'postgres://u:p@localhost:5432/infidash',
    DATABASE_SSL: 'no-verify',
    EDITORIAL_DB_IDLE_TIMEOUT_MS: '1234',
    EDITORIAL_DB_CONNECTION_TIMEOUT_MS: '4321',
  });
  assert.equal(config.connectionString, 'postgres://u:p@localhost:5432/infidash');
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(config.idleTimeoutMillis, 1234);
  assert.equal(config.connectionTimeoutMillis, 4321);
  assert.equal(config.application_name, 'infidash-core');
  assert.equal(config.allowExitOnIdle, true);
  assert.equal(config.max, 10);
});

test('buildCorePoolConfig honours CORE_DB_POOL_MAX and rejects a missing DATABASE_URL', () => {
  assert.equal(buildCorePoolConfig({ DATABASE_URL: 'postgres://x/y', CORE_DB_POOL_MAX: '3' }).max, 3);
  assert.equal(buildCorePoolConfig({ DATABASE_URL: 'postgres://x/y', CORE_DB_POOL_MAX: 'abc' }).max, 10);
  assert.throws(() => buildCorePoolConfig({}), /DATABASE_URL/);
});

test('coreAll and coreGet pass SQL and positional parameters through untouched', async () => {
  const { pool, calls } = fakePool({ rows: [{ id: 'a' }, { id: 'b' }] });
  assert.deepEqual(await coreAll(pool, 'SELECT * FROM users WHERE email = $1', ["o'brien; DROP TABLE users"]), [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(await coreGet(pool, 'SELECT * FROM users WHERE id = $1', ['a']), { id: 'a' });
  assert.deepEqual(calls[0], { text: 'SELECT * FROM users WHERE email = $1', values: ["o'brien; DROP TABLE users"] });
  assert.deepEqual(calls[1].values, ['a']);
});

test('coreGet returns undefined when there are no rows and coreRun reports the affected row count', async () => {
  assert.equal(await coreGet(fakePool({ rows: [] }).pool, 'SELECT 1 WHERE FALSE'), undefined);
  assert.deepEqual(await coreRun(fakePool({ rowCount: 3 }).pool, 'DELETE FROM sessions WHERE user_id = $1', ['u']), { changes: 3 });
  assert.deepEqual(await coreRun(fakePool({ rowCount: null }).pool, 'DELETE FROM sessions'), { changes: 0 });
});

test('mapCorePgError rewrites constraint violations in the psql message style and keeps the pg code', () => {
  const duplicate = mapCorePgError(pgError('23505', 'duplicate key value violates unique constraint "users_email_key"', {
    detail: 'Key (email)=(a@b.c) already exists.',
    constraint: 'users_email_key',
  })) as Error & { code?: string; constraint?: string };
  assert.match(duplicate.message, /^ERROR: {2}duplicate key value violates unique constraint/);
  assert.match(duplicate.message, /\nDETAIL: {2}Key \(email\)=\(a@b\.c\) already exists\./);
  assert.equal(duplicate.code, '23505');
  assert.equal(duplicate.constraint, 'users_email_key');

  assert.match((mapCorePgError(pgError('23503', 'insert or update on table "x" violates foreign key constraint "y"')) as Error).message, /foreign key/i);
  assert.match((mapCorePgError(pgError('23514', 'new row for relation "users" violates check constraint "c"')) as Error).message, /check constraint/i);
  assert.match((mapCorePgError(pgError('23502', 'null value in column "name" violates not-null constraint')) as Error).message, /not-null/i);
});

test('mapCorePgError leaves unrelated errors untouched', () => {
  const other = pgError('42P01', 'relation "nope" does not exist');
  assert.equal(mapCorePgError(other), other);
  const plain = new Error('boom');
  assert.equal(mapCorePgError(plain), plain);
  assert.equal(mapCorePgError('text'), 'text');
});

test('query helpers translate constraint violations from the pool', async () => {
  const { pool } = fakePool(pgError('23505', 'duplicate key value violates unique constraint "k"'));
  await assert.rejects(() => coreRun(pool, 'INSERT INTO users VALUES ($1)', ['x']), /duplicate key/i);
  await assert.rejects(() => coreAll(pool, 'SELECT 1'), /duplicate key/i);
  await assert.rejects(() => coreGet(pool, 'SELECT 1'), /duplicate key/i);
});
