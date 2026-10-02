import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createHealthCheck, registerHealthRoute } from '../src/server/health.js';

type Query = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
const poolOf = (query: Query) => ({ query }) as never;
const okQuery: Query = async () => ({ rows: [{ '?column?': 1 }] });

function migrationsDirectory(names: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'infidash-health-'));
  for (const name of names) writeFileSync(join(directory, name), 'SELECT 1;');
  return directory;
}

test('health answers 200 ok when the database responds', async () => {
  const check = createHealthCheck({ pool: poolOf(okQuery) });
  assert.deepEqual(await check(false), { statusCode: 200, body: { status: 'ok' } });
});

test('health answers 503 degraded without internals when the query rejects', async () => {
  const logs: unknown[][] = [];
  const check = createHealthCheck({
    pool: poolOf(async () => { throw new Error('connect ECONNREFUSED db.internal.example:5432 password=hunter2'); }),
    logger: (...args) => logs.push(args),
  });
  const result = await check(false);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { status: 'degraded', checks: { database: 'down' } });
  assert.doesNotMatch(JSON.stringify(result.body), /ECONNREFUSED|db\.internal|hunter2/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[infidash] health check failed');
});

test('health cuts off a hanging query at the timeout', async () => {
  const started = Date.now();
  const check = createHealthCheck({ pool: poolOf(() => new Promise(() => undefined)), timeoutMs: 25, logger: () => undefined });
  const result = await check(false);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { status: 'degraded', checks: { database: 'down' } });
  assert.ok(Date.now() - started < 1000, 'must not wait for the hanging query');
});

test('health never throws, even when the pool itself blows up synchronously', async () => {
  const check = createHealthCheck({ pool: { query: () => { throw new Error('boom'); } } as never, logger: () => undefined });
  assert.equal((await check(true)).statusCode, 503);
});

test('health log is throttled so a failing database does not flood the log', async () => {
  let clock = 1_000_000;
  const logs: unknown[][] = [];
  const check = createHealthCheck({
    pool: poolOf(async () => { throw new Error('down'); }),
    now: () => clock,
    logIntervalMs: 30_000,
    logger: (...args) => logs.push(args),
  });
  await check(false);
  await check(false);
  clock += 29_999;
  await check(false);
  assert.equal(logs.length, 1);
  clock += 1;
  await check(false);
  assert.equal(logs.length, 2);
});

test('deep health reports applied and pending editorial migrations and fails while any is pending', async () => {
  const directory = migrationsDirectory(['0001_init.sql', '0002_jobs.sql', '0003_more.sql', 'README.md']);
  try {
    const pool = (applied: string[]) => poolOf(async (sql) => ({ rows: /schema_migrations/.test(sql) ? applied.map((version) => ({ version })) : [{ '?column?': 1 }] }));
    const pending = await createHealthCheck({ pool: pool(['0001_init.sql', '0002_jobs.sql']), migrationsDirectory: directory })(true);
    assert.equal(pending.statusCode, 503);
    assert.deepEqual(pending.body, { status: 'degraded', checks: { database: 'ok', migrations: { applied: 2, pending: 1 } } });

    const complete = await createHealthCheck({ pool: pool(['0001_init.sql', '0002_jobs.sql', '0003_more.sql']), migrationsDirectory: directory })(true);
    assert.deepEqual(complete, { statusCode: 200, body: { status: 'ok', checks: { database: 'ok', migrations: { applied: 3, pending: 0 } } } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deep health includes the core database check and degrades when it fails', async () => {
  const directory = migrationsDirectory(['0001_init.sql']);
  try {
    const pool = poolOf(async (sql) => ({ rows: /schema_migrations/.test(sql) ? [{ version: '0001_init.sql' }] : [{ '?column?': 1 }] }));
    const good = await createHealthCheck({ pool, migrationsDirectory: directory, coreCheck: () => undefined })(true);
    assert.deepEqual(good.body, { status: 'ok', checks: { database: 'ok', migrations: { applied: 1, pending: 0 }, core: 'ok' } });
    const bad = await createHealthCheck({ pool, migrationsDirectory: directory, coreCheck: () => { throw new Error('psql: could not connect'); }, logger: () => undefined })(true);
    assert.equal(bad.statusCode, 503);
    assert.deepEqual(bad.body, { status: 'degraded', checks: { database: 'ok', migrations: { applied: 1, pending: 0 }, core: 'down' } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deep health degrades without internals when the migrations registry cannot be read', async () => {
  const directory = migrationsDirectory(['0001_init.sql']);
  try {
    const pool = poolOf(async (sql) => { if (/schema_migrations/.test(sql)) throw new Error('relation "public.schema_migrations" does not exist'); return { rows: [{ '?column?': 1 }] }; });
    const result = await createHealthCheck({ pool, migrationsDirectory: directory, logger: () => undefined })(true);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, { status: 'degraded', checks: { database: 'ok', migrations: 'unknown' } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the shallow check never touches migrations or the core database', async () => {
  let queries = 0;
  const check = createHealthCheck({
    pool: poolOf(async () => { queries += 1; return { rows: [] }; }),
    migrationsDirectory: '/does/not/exist',
    coreCheck: () => { throw new Error('must not run'); },
  });
  assert.equal((await check(false)).statusCode, 200);
  assert.equal(queries, 1);
});

test('GET /api/health is unauthenticated and honors the deep flag', async () => {
  const app = Fastify({ logger: false });
  const seen: boolean[] = [];
  registerHealthRoute(app, async (deep) => { seen.push(deep); return deep ? { statusCode: 503, body: { status: 'degraded', checks: { database: 'down' } } } : { statusCode: 200, body: { status: 'ok' } }; });
  const shallow = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(shallow.statusCode, 200);
  assert.deepEqual(shallow.json(), { status: 'ok' });
  const deep = await app.inject({ method: 'GET', url: '/api/health?deep=1' });
  assert.equal(deep.statusCode, 503);
  assert.deepEqual(seen, [false, true]);
  await app.close();
});

test('the health route turns an unexpected failure into the 503 body', async () => {
  const app = Fastify({ logger: false });
  registerHealthRoute(app, async () => { throw new Error('secret internals'); });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'degraded', checks: { database: 'down' } });
  await app.close();
});

test('GET /api/version reports when this process started, so a deploy can tell the new container from the old one', async () => {
  const { default: fastify } = await import('fastify');
  const { registerVersionRoute } = await import('../src/server/health.js');
  const app = fastify();
  registerVersionRoute(app, new Date('2026-10-02T10:00:00.000Z'));
  await app.ready();
  const response = await app.inject({ url: '/api/version' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { startedAt: '2026-10-02T10:00:00.000Z' });
  await app.close();
});
