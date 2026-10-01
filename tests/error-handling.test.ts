import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import Fastify from 'fastify';
import { UserFacingError, publicErrorMessage } from '../src/lib/userFacingError.js';
import { registerErrorHandling } from '../src/lib/errorHandling.js';

const previousNodeEnv = process.env.NODE_ENV;
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test-only:test-only@127.0.0.1:1/infidash_test';
const { app } = await import('../server.js');
await app.ready();
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;
if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = previousDatabaseUrl;
after(async () => app.close());

const originalConsoleError = console.error;
afterEach(() => { console.error = originalConsoleError; });

function captureConsoleError() {
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  return lines;
}

const SECRET_MESSAGE = 'connection string postgresql://user:secret@host/db failed; psql: error: relation "x" does not exist';

test('publicErrorMessage only exposes messages from UserFacingError', () => {
  assert.equal(publicErrorMessage(new UserFacingError('El Property ID de GA4 debe ser numérico'), 'fallback'), 'El Property ID de GA4 debe ser numérico');
  assert.equal(publicErrorMessage(new Error(SECRET_MESSAGE), 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(publicErrorMessage('boom', 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(publicErrorMessage(undefined, 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(new UserFacingError('x') instanceof Error, true);
});

test('the global handler hides internal errors and logs them without request secrets', async () => {
  const lines = captureConsoleError();
  const bare = Fastify();
  registerErrorHandling(bare);
  bare.post('/boom', async () => { throw new Error(SECRET_MESSAGE); });
  const response = await bare.inject({
    method: 'POST', url: '/boom?x=1', headers: { authorization: 'Bearer super-secret-token' }, payload: { password: 'hunter2' },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  assert.doesNotMatch(response.body, /postgresql|secret|psql|relation/);
  const log = lines.join('\n');
  assert.match(log, /\[infidash\] unhandled error/);
  assert.match(log, /POST/);
  assert.match(log, /\/boom/);
  assert.match(log, /relation "x" does not exist/);
  assert.doesNotMatch(log, /super-secret-token|hunter2/);
  await bare.close();
});

test('the global handler keeps 4xx statuses with a safe Spanish message', async () => {
  const bare = Fastify({ bodyLimit: 16 });
  registerErrorHandling(bare);
  bare.post('/echo', async () => ({ ok: true }));
  const tooLarge = await bare.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ pad: 'x'.repeat(100) }) });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.json().code, 'PAYLOAD_TOO_LARGE');
  await bare.close();

  const typed = Fastify();
  registerErrorHandling(typed);
  typed.post('/typed', { schema: { body: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } }, async () => ({ ok: true }));
  const invalid = await typed.inject({ method: 'POST', url: '/typed', payload: { b: 1 } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, 'INVALID_REQUEST');
  assert.doesNotMatch(invalid.body, /required property/);
  await typed.close();
});

test('an unexpected database failure on a real route returns the generic 500 and logs the detail', async () => {
  const lines = captureConsoleError();
  // The session lookup shells out to psql against an unreachable database, so it throws.
  const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: 'Bearer some-token' } });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Error interno del servidor', code: 'INTERNAL_ERROR' });
  assert.doesNotMatch(response.body, /psql|postgres|127\.0\.0\.1|spawn/i);
  assert.match(lines.join('\n'), /\[infidash\] unhandled error/);
  assert.doesNotMatch(lines.join('\n'), /some-token/);
});

test('malformed JSON on a real route is a safe 400 in the project error shape', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"email": ' });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.code, 'INVALID_REQUEST');
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(response.body, /JSON|Unexpected|position/);
});

test('an unknown API route returns the JSON 404 in the project error shape', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'Ruta no encontrada', code: 'NOT_FOUND' });
});

test('logout and logout-all require a session', async () => {
  for (const url of ['/api/auth/logout', '/api/auth/logout-all']) {
    const response = await app.inject({ method: 'POST', url });
    assert.equal(response.statusCode, 401, url);
    assert.equal(response.json().code, 'UNAUTHENTICATED');
  }
});
