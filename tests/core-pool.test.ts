import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorePoolConfig,
  coreAll,
  coreGet,
  coreRun,
  mapCorePgError,
  withCoreTransaction,
  type CoreQueryable,
  type CoreTransactionPool,
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

function fakeTransactionPool(failOn: { text: string; error: Error } | null = null) {
  const log: string[] = [];
  const releases: Array<Error | boolean | undefined> = [];
  const pool: CoreTransactionPool = {
    async connect() {
      return {
        async query(text: string) {
          log.push(text);
          if (failOn && text === failOn.text) throw failOn.error;
          return { rows: [], rowCount: 0 };
        },
        release(error?: Error | boolean) {
          releases.push(error);
        },
      };
    },
  };
  return { pool, log, releases };
}

test('withCoreTransaction commits on success, returns the callback result and releases the client once', async () => {
  const { pool, log, releases } = fakeTransactionPool();
  const result = await withCoreTransaction(async (tx) => {
    await coreRun(tx, 'INSERT INTO users VALUES ($1)', ['a']);
    return 'done';
  }, pool);
  assert.equal(result, 'done');
  assert.deepEqual(log, ['BEGIN', 'INSERT INTO users VALUES ($1)', 'COMMIT']);
  assert.deepEqual(releases, [undefined]);
});

test('withCoreTransaction rolls back, releases and rethrows when the callback fails', async () => {
  const { pool, log, releases } = fakeTransactionPool({
    text: 'INSERT INTO client_memberships VALUES ($1)',
    error: pgError('23503', 'insert or update on table "client_memberships" violates foreign key constraint "k"'),
  });
  await assert.rejects(
    () => withCoreTransaction(async (tx) => {
      await coreRun(tx, 'INSERT INTO users VALUES ($1)', ['a']);
      await coreRun(tx, 'INSERT INTO client_memberships VALUES ($1)', ['x']);
    }, pool),
    (error: Error) => /^ERROR: {2}insert or update/.test(error.message) && !/ERROR: {2}ERROR/.test(error.message) && /foreign key/i.test(error.message),
  );
  assert.deepEqual(log, ['BEGIN', 'INSERT INTO users VALUES ($1)', 'INSERT INTO client_memberships VALUES ($1)', 'ROLLBACK']);
  assert.equal(releases.length, 1);
});

test('withCoreTransaction maps constraint errors raised by the callback itself', async () => {
  const { pool, log } = fakeTransactionPool();
  await assert.rejects(
    () => withCoreTransaction(async () => {
      throw pgError('23505', 'duplicate key value violates unique constraint "k"');
    }, pool),
    /^Error: ERROR: {2}duplicate key/,
  );
  assert.deepEqual(log, ['BEGIN', 'ROLLBACK']);
});

test('withCoreTransaction maps a failing COMMIT, rolls back and releases the client', async () => {
  const { pool, log, releases } = fakeTransactionPool({
    text: 'COMMIT',
    error: pgError('23503', 'deferred foreign key constraint violated'),
  });
  await assert.rejects(() => withCoreTransaction(async () => 'x', pool), /foreign key/i);
  assert.deepEqual(log, ['BEGIN', 'COMMIT', 'ROLLBACK']);
  assert.equal(releases.length, 1);
});

test('withCoreTransaction destroys the client when ROLLBACK itself fails and still surfaces the original error', async () => {
  const { pool, releases } = fakeTransactionPool({ text: 'ROLLBACK', error: new Error('connection lost') });
  await assert.rejects(
    () => withCoreTransaction(async () => {
      throw new Error('original failure');
    }, pool),
    /original failure/,
  );
  assert.equal(releases.length, 1);
  assert.ok(releases[0] instanceof Error);
});

test('withCoreTransaction releases the client when BEGIN fails', async () => {
  const { pool, log, releases } = fakeTransactionPool({ text: 'BEGIN', error: new Error('cannot begin') });
  await assert.rejects(() => withCoreTransaction(async () => 'x', pool), /cannot begin/);
  assert.deepEqual(log, ['BEGIN']);
  assert.equal(releases.length, 1);
});

test('mapCorePgError is idempotent for errors it already rewrote', () => {
  const once = mapCorePgError(pgError('23505', 'duplicate key value', { detail: 'Key (a)=(b) exists.' })) as Error;
  assert.equal(mapCorePgError(once), once);
});
