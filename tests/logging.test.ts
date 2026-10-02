import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import fastify from 'fastify';
import { registerErrorHandling } from '../src/lib/errorHandling.js';
import { buildFastifyLoggingOptions, buildLoggerOptions, registerRequestId, sanitizeLogUrl } from '../src/lib/logger.js';
import { createHealthCheck, registerHealthRoute } from '../src/server/health.js';
import { registerSecurity } from '../src/server/security.js';

function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _enc, done) { chunks.push(String(chunk)); done(); } });
  return {
    stream,
    raw: () => chunks.join(''),
    lines: () => chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const LEAD_TOKEN = 'lead-token-SECRET-1234567890abcdef';
const BEARER = 'bearer-secret-value-777';
const COOKIE = 'infidash_session=cookie-secret-value-888';
const SERVICE_TOKEN = 'service-token-secret-999';
const PASSWORD = 'p4ssw0rd-hunter2-secret';

async function buildApp(extraEnv: Record<string, string> = {}, setup?: (app: ReturnType<typeof fastify>) => void) {
  const capture = captureStream();
  const app = fastify(buildFastifyLoggingOptions({ LOG_LEVEL: 'info', ...extraEnv }, capture.stream));
  registerRequestId(app);
  registerErrorHandling(app);
  app.get('/api/ping', async () => ({ ok: true }));
  app.post('/api/auth/login', async () => ({ ok: true }));
  app.post('/api/public/leads/:token', async () => { throw new Error('database exploded'); });
  app.get('/api/boom', async () => { throw new Error('relation "x" does not exist'); });
  registerHealthRoute(app, createHealthCheck({ pool: { query: async () => ({ rows: [] }) } as never }));
  setup?.(app);
  await app.ready();
  return { app, capture };
}

test('buildLoggerOptions defaults to info, validates LOG_LEVEL and stays silent in tests', () => {
  assert.equal(buildLoggerOptions({}).level, 'info');
  assert.equal(buildLoggerOptions({ LOG_LEVEL: 'debug' }).level, 'debug');
  assert.equal(buildLoggerOptions({ LOG_LEVEL: ' WARN ' }).level, 'warn');
  assert.equal(buildLoggerOptions({ LOG_LEVEL: 'verbose' }).level, 'info');
  assert.equal(buildLoggerOptions({ NODE_ENV: 'test' }).level, 'silent');
  assert.equal(buildLoggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'info' }).level, 'info');
  assert.deepEqual(buildLoggerOptions({}).base, { service: 'infidash' });
});

test('sanitizeLogUrl hides the lead webhook token and secret query params', () => {
  assert.equal(sanitizeLogUrl(`/api/public/leads/${LEAD_TOKEN}`), '/api/public/leads/[redacted]');
  assert.equal(sanitizeLogUrl(`/api/public/leads/${LEAD_TOKEN}/extra?x=1`), '/api/public/leads/[redacted]?x=1');
  assert.equal(sanitizeLogUrl('/api/clients?page=2&token=abc&apiKey=def&Password=x'), '/api/clients?page=2&token=[redacted]&apiKey=[redacted]&Password=[redacted]');
  assert.equal(sanitizeLogUrl('/api/health?deep=1'), '/api/health?deep=1');
  assert.equal(sanitizeLogUrl(undefined), '');
});

test('every request log line carries reqId, a valid incoming x-request-id is kept and echoed', async () => {
  const { app, capture } = await buildApp();
  const response = await app.inject({ url: '/api/ping', headers: { 'x-request-id': 'trace-abc_123.xyz' } });
  assert.equal(response.headers['x-request-id'], 'trace-abc_123.xyz');
  const lines = capture.lines();
  assert.ok(lines.length >= 2, 'incoming request and completed lines');
  for (const line of lines) {
    assert.equal(line.reqId, 'trace-abc_123.xyz');
    assert.equal(line.service, 'infidash');
    assert.equal(typeof line.time, 'string');
    assert.ok(!Number.isNaN(Date.parse(String(line.time))));
  }
  const completed = lines.find((line) => line.msg === 'request completed');
  assert.ok(completed);
  assert.deepEqual(completed.res, { statusCode: 200 });
  assert.equal(typeof completed.responseTime, 'number');
  const incoming = lines.find((line) => line.msg === 'incoming request');
  assert.deepEqual(Object.keys(incoming?.req as object).sort(), ['method', 'remoteAddress', 'url']);
  await app.close();
});

test('an invalid or missing incoming x-request-id is replaced by a generated one', async () => {
  const { app, capture } = await buildApp();
  for (const bad of ['short', 'has space in it!', 'x'.repeat(101), '<script>alert(1)</script>']) {
    const response = await app.inject({ url: '/api/ping', headers: { 'x-request-id': bad } });
    const id = String(response.headers['x-request-id']);
    assert.notEqual(id, bad);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
  const none = await app.inject({ url: '/api/ping' });
  assert.match(String(none.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(capture.raw(), /<script>/);
  await app.close();
});

test('health checks do not log at info level but other requests do', async () => {
  const { app, capture } = await buildApp();
  await app.inject({ url: '/api/health' });
  await app.inject({ url: '/api/health?deep=1' });
  assert.equal(capture.lines().length, 0);
  await app.inject({ url: '/api/ping' });
  assert.ok(capture.lines().length >= 2);
  await app.close();
});

test('the dispatcher claim poll is not logged per request but real errors still are', async () => {
  const { app, capture } = await buildApp({}, (instance) => {
    instance.post('/api/internal/content/jobs/claim', async (_request, reply) => reply.code(204).send());
    instance.post('/api/internal/content/jobs/claim-broken', async () => { throw new Error('claim exploded'); });
  });
  const empty = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/claim' });
  assert.equal(empty.statusCode, 204);
  assert.equal(capture.lines().length, 0);
  // Only the exact polling route is quiet: any other route (even a similarly named one) keeps its request lines.
  await app.inject({ method: 'POST', url: '/api/internal/content/jobs/claim-broken' });
  assert.ok(capture.lines().some((line) => line.msg === 'unhandled error'));
  assert.ok(capture.lines().some((line) => line.msg === 'incoming request'));
  await app.close();
});

test('internal errors are logged with err and reqId while the client gets the generic body', async () => {
  const { app, capture } = await buildApp();
  const response = await app.inject({ url: '/api/boom', headers: { 'x-request-id': 'req-boom-0001' } });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  const entry = capture.lines().find((line) => line.msg === 'unhandled error');
  assert.ok(entry);
  assert.equal(entry.reqId, 'req-boom-0001');
  assert.equal(entry.level, 'error');
  assert.match(String((entry.err as Record<string, unknown>).message), /relation "x" does not exist/);
  await app.close();
});

test('secrets in headers, bodies and URLs never reach the log output, including error logs', async () => {
  const { app, capture } = await buildApp();
  await app.inject({ url: '/api/ping', headers: { authorization: `Bearer ${BEARER}`, cookie: COOKIE, 'x-service-token': SERVICE_TOKEN } });
  await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.es', password: PASSWORD } });
  await app.inject({ url: '/api/boom', headers: { authorization: `Bearer ${BEARER}`, cookie: COOKIE, 'x-service-token': SERVICE_TOKEN } });
  const lead = await app.inject({ method: 'POST', url: `/api/public/leads/${LEAD_TOKEN}?token=${LEAD_TOKEN}`, payload: { email: 'lead@example.com' } });
  assert.equal(lead.statusCode, 500);
  const missing = await app.inject({ url: `/api/public/leads/${LEAD_TOKEN}/nope` });
  assert.equal(missing.statusCode, 404);
  const raw = capture.raw();
  assert.ok(raw.length > 0);
  for (const secret of [LEAD_TOKEN, BEARER, COOKIE, 'cookie-secret-value-888', SERVICE_TOKEN, PASSWORD]) {
    assert.ok(!raw.includes(secret), `log leaked ${secret}`);
  }
  assert.match(raw, /\/api\/public\/leads\/\[redacted\]/);
  for (const line of capture.lines()) assert.equal(typeof line.reqId, 'string');
  await app.close();
});

test('the redact config censors sensitive keys of ad-hoc log objects', async () => {
  const { app, capture } = await buildApp();
  app.log.info({ headers: { authorization: BEARER, cookie: COOKIE, 'x-service-token': SERVICE_TOKEN }, req: { body: { password: PASSWORD } }, res: { headers: { 'set-cookie': COOKIE } } }, 'adhoc');
  const raw = capture.raw();
  for (const secret of [BEARER, COOKIE, SERVICE_TOKEN, PASSWORD]) assert.ok(!raw.includes(secret), `log leaked ${secret}`);
  await app.close();
});

test('error logs mask credentials embedded in connection strings', async () => {
  const { app, capture } = await buildApp({}, (instance) => {
    instance.get('/api/dsn', async () => { throw new Error('connect failed postgresql://infidash:db-password-xyz@db.internal:5432/infidash'); });
  });
  await app.inject({ url: '/api/dsn' });
  assert.ok(!capture.raw().includes('db-password-xyz'));
  assert.match(capture.raw(), /db\.internal/);
  await app.close();
});

test('the trust-proxy warning is logged once through the request logger', async () => {
  const capture = captureStream();
  const app = fastify({ ...buildFastifyLoggingOptions({ LOG_LEVEL: 'warn' }, capture.stream), trustProxy: false });
  await registerSecurity(app, { NODE_ENV: 'test' });
  app.get('/api/ping', async () => ({ ok: true }));
  await app.inject({ url: '/api/ping' });
  assert.equal(capture.lines().length, 0);
  await app.inject({ url: '/api/ping', headers: { 'x-forwarded-for': '203.0.113.1' } });
  await app.inject({ url: '/api/ping', headers: { 'x-forwarded-for': '203.0.113.2' } });
  const warnings = capture.lines().filter((line) => line.level === 'warn');
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0].msg), /INFIDASH_TRUST_PROXY=1/);
  await app.close();
});
