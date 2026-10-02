import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import fastify from 'fastify';
import { LoginThrottle } from '../src/lib/loginThrottle.js';
import { registerErrorHandling } from '../src/lib/errorHandling.js';
import { buildFastifyLoggingOptions } from '../src/lib/logger.js';
import {
  buildContentSecurityPolicy,
  leadsRouteConfig,
  loginRouteConfig,
  rateLimitSettings,
  registerSecurity,
  resolveCspMode,
  resolveTrustProxy,
} from '../src/server/security.js';

async function buildApp(env: Record<string, string | undefined>, options: { trustProxy?: any; stream?: Writable } = {}) {
  const app = fastify({ ...(options.stream ? buildFastifyLoggingOptions({ LOG_LEVEL: 'warn' }, options.stream) : { logger: false }), trustProxy: options.trustProxy ?? false });
  registerErrorHandling(app);
  await registerSecurity(app, env);
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ping', async () => ({ ok: true }));
  app.get('/api/boom', async () => {
    throw new Error('secret failure');
  });
  app.post('/api/auth/login', { config: loginRouteConfig(env) }, async () => ({ ok: true }));
  app.post('/api/public/leads/:token', { config: leadsRouteConfig(env) }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

test('resolveTrustProxy handles every accepted form', () => {
  assert.equal(resolveTrustProxy({}), false);
  assert.equal(resolveTrustProxy({ INFIDASH_TRUST_PROXY: '' }), false);
  assert.equal(resolveTrustProxy({ INFIDASH_TRUST_PROXY: '  ' }), false);
  assert.equal(resolveTrustProxy({ INFIDASH_TRUST_PROXY: 'false' }), false);
  assert.equal(resolveTrustProxy({ INFIDASH_TRUST_PROXY: 'true' }), true);
  // Fastify 5 ignores bare numbers (fail closed), so hop counts resolve to a predicate on the hop index.
  const one = resolveTrustProxy({ INFIDASH_TRUST_PROXY: '1' }) as (address: string, hop: number) => boolean;
  assert.equal(typeof one, 'function');
  assert.equal(one('10.0.0.1', 0), true);
  assert.equal(one('10.0.0.1', 1), false);
  const two = resolveTrustProxy({ INFIDASH_TRUST_PROXY: '2' }) as (address: string, hop: number) => boolean;
  assert.equal(two('10.0.0.1', 1), true);
  assert.equal(two('10.0.0.1', 2), false);
  assert.deepEqual(resolveTrustProxy({ INFIDASH_TRUST_PROXY: '10.0.0.1, 172.16.0.0/12' }), ['10.0.0.1', '172.16.0.0/12']);
});

test('resolveTrustProxy rejects invalid hop counts', () => {
  assert.throws(() => resolveTrustProxy({ INFIDASH_TRUST_PROXY: '-1' }), /INFIDASH_TRUST_PROXY/);
  assert.throws(() => resolveTrustProxy({ INFIDASH_TRUST_PROXY: '1.5' }), /INFIDASH_TRUST_PROXY/);
  assert.throws(() => resolveTrustProxy({ INFIDASH_TRUST_PROXY: '0' }), /INFIDASH_TRUST_PROXY/);
});

test('resolveCspMode defaults to report-only and accepts enforce and off', () => {
  assert.equal(resolveCspMode({}), 'report-only');
  assert.equal(resolveCspMode({ INFIDASH_CSP_MODE: 'enforce' }), 'enforce');
  assert.equal(resolveCspMode({ INFIDASH_CSP_MODE: 'OFF' }), 'off');
  assert.equal(resolveCspMode({ INFIDASH_CSP_MODE: 'report-only' }), 'report-only');
  assert.throws(() => resolveCspMode({ INFIDASH_CSP_MODE: 'nope' }), /INFIDASH_CSP_MODE/);
});

test('content security policy covers the SPA without unsafe-eval or inline scripts', () => {
  const csp = buildContentSecurityPolicy();
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['style-src'], ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
  assert.deepEqual(csp['font-src'], ["'self'", 'data:', 'https://fonts.gstatic.com']);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:', 'https:']);
  assert.deepEqual(csp['media-src'], ["'self'", 'blob:', 'https:']);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.ok(!JSON.stringify(csp).includes('unsafe-eval'));
});

test('report-only mode sends only the report-only CSP header', async () => {
  const app = await buildApp({ NODE_ENV: 'test' });
  const response = await app.inject({ url: '/api/ping' });
  assert.equal(response.headers['content-security-policy'], undefined);
  assert.match(String(response.headers['content-security-policy-report-only']), /default-src 'self'/);
  await app.close();
});

test('enforce mode sends only the enforcing CSP header', async () => {
  const app = await buildApp({ NODE_ENV: 'test', INFIDASH_CSP_MODE: 'enforce' });
  const response = await app.inject({ url: '/api/ping' });
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(response.headers['content-security-policy-report-only'], undefined);
  await app.close();
});

test('off mode sends no CSP header but keeps the other security headers', async () => {
  const app = await buildApp({ NODE_ENV: 'test', INFIDASH_CSP_MODE: 'off' });
  const response = await app.inject({ url: '/api/ping' });
  assert.equal(response.headers['content-security-policy'], undefined);
  assert.equal(response.headers['content-security-policy-report-only'], undefined);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  await app.close();
});

test('helmet headers are present on 200, 404 and 500 responses', async () => {
  const app = await buildApp({ NODE_ENV: 'test' });
  for (const [url, status] of [['/api/ping', 200], ['/api/missing', 404], ['/api/boom', 500]] as const) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, status, url);
    assert.ok(response.headers['strict-transport-security'], `${url} hsts`);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', `${url} nosniff`);
    assert.ok(response.headers['x-frame-options'], `${url} x-frame-options`);
    assert.ok(response.headers['referrer-policy'], `${url} referrer-policy`);
    assert.ok(response.headers['content-security-policy-report-only'], `${url} csp`);
  }
  await app.close();
});

test('rateLimitSettings applies defaults and overrides', () => {
  assert.deepEqual(rateLimitSettings({ NODE_ENV: 'production' }), { enabled: true, globalMax: 1500, loginMax: 10, leadsMax: 120 });
  assert.deepEqual(
    rateLimitSettings({ INFIDASH_RATE_LIMIT_MAX: '5', INFIDASH_RATE_LIMIT_LOGIN_MAX: '2', INFIDASH_RATE_LIMIT_LEADS_MAX: '3' }),
    { enabled: true, globalMax: 5, loginMax: 2, leadsMax: 3 },
  );
  assert.equal(rateLimitSettings({ INFIDASH_RATE_LIMIT_MAX: 'abc' }).globalMax, 1500);
  assert.equal(rateLimitSettings({ INFIDASH_RATE_LIMIT_MAX: '0' }).globalMax, 1500);
});

test('rate limiting is off under NODE_ENV=test unless explicitly enabled', () => {
  assert.equal(rateLimitSettings({ NODE_ENV: 'test' }).enabled, false);
  assert.equal(rateLimitSettings({ NODE_ENV: 'test', INFIDASH_RATE_LIMIT_IN_TEST: '1' }).enabled, true);
});

test('global limit returns 429 with Retry-After and the Spanish body, and exempts health', async () => {
  const app = await buildApp({ NODE_ENV: 'production', INFIDASH_RATE_LIMIT_MAX: '3' });
  for (let i = 0; i < 3; i += 1) assert.equal((await app.inject({ url: '/api/ping' })).statusCode, 200);
  const blocked = await app.inject({ url: '/api/ping' });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['retry-after']) >= 1);
  assert.deepEqual(blocked.json(), { error: 'Demasiadas solicitudes. Espera antes de volver a intentarlo.', code: 'RATE_LIMITED' });
  for (let i = 0; i < 10; i += 1) assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200);
  await app.close();
});

test('login limit is stricter than the global limit', async () => {
  const app = await buildApp({ NODE_ENV: 'production', INFIDASH_RATE_LIMIT_MAX: '100', INFIDASH_RATE_LIMIT_LOGIN_MAX: '2' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 200);
  const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
  assert.equal((await app.inject({ url: '/api/ping' })).statusCode, 200);
  await app.close();
});

test('leads webhook limit is keyed per token', async () => {
  const app = await buildApp({ NODE_ENV: 'production', INFIDASH_RATE_LIMIT_MAX: '100', INFIDASH_RATE_LIMIT_LEADS_MAX: '2' });
  const post = (token: string) => app.inject({ method: 'POST', url: `/api/public/leads/${token}`, payload: {} });
  assert.equal((await post('aaa')).statusCode, 200);
  assert.equal((await post('aaa')).statusCode, 200);
  const blocked = await post('aaa');
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
  assert.equal((await post('bbb')).statusCode, 200);
  await app.close();
});

test('rate limiting is not applied under NODE_ENV=test by default and is with INFIDASH_RATE_LIMIT_IN_TEST=1', async () => {
  const off = await buildApp({ NODE_ENV: 'test', INFIDASH_RATE_LIMIT_MAX: '1', INFIDASH_RATE_LIMIT_LOGIN_MAX: '1' });
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await off.inject({ url: '/api/ping' })).statusCode, 200);
    assert.equal((await off.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 200);
  }
  await off.close();
  const on = await buildApp({ NODE_ENV: 'test', INFIDASH_RATE_LIMIT_IN_TEST: '1', INFIDASH_RATE_LIMIT_MAX: '1' });
  assert.equal((await on.inject({ url: '/api/ping' })).statusCode, 200);
  assert.equal((await on.inject({ url: '/api/ping' })).statusCode, 429);
  await on.close();
});

test('with trustProxy the forwarded address drives req.ip and login throttle counters', async () => {
  const app = fastify({ logger: false, trustProxy: resolveTrustProxy({ INFIDASH_TRUST_PROXY: '1' }) });
  const throttle = new LoginThrottle({ maxAttempts: 2 });
  app.get('/ip', async (req) => ({ ip: req.ip, blocked: throttle.check(req.ip).blocked }));
  app.post('/fail', async (req) => {
    throttle.recordFailure(req.ip);
    return { ip: req.ip };
  });
  await app.ready();
  const hit = (url: string, ip: string, method: 'GET' | 'POST' = 'GET') =>
    app.inject({ method, url, remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip } });
  assert.equal((await hit('/ip', '203.0.113.1')).json().ip, '203.0.113.1');
  assert.equal((await hit('/ip', '203.0.113.2')).json().ip, '203.0.113.2');
  await hit('/fail', '203.0.113.1', 'POST');
  await hit('/fail', '203.0.113.1', 'POST');
  assert.equal((await hit('/ip', '203.0.113.1')).json().blocked, true);
  assert.equal((await hit('/ip', '203.0.113.2')).json().blocked, false);
  await app.close();
});

test('without trustProxy the forwarded header is ignored', async () => {
  const app = fastify({ logger: false, trustProxy: false });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  await app.ready();
  const a = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': '203.0.113.1' } });
  const b = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.equal(a.json().ip, b.json().ip);
  assert.notEqual(a.json().ip, '203.0.113.1');
  await app.close();
});

test('proxy warning fires once, only with X-Forwarded-For and trust disabled', async () => {
  // The warning goes through the request logger now; capture it with an in-memory stream.
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done(); } });
  const warnings = () => chunks.join('').split(String.fromCharCode(10)).filter((line) => line.includes('"level":"warn"'));
  const untrusted = await buildApp({ NODE_ENV: 'test' }, { stream });
  await untrusted.inject({ url: '/api/ping' });
  assert.equal(warnings().length, 0);
  await untrusted.inject({ url: '/api/ping', headers: { 'x-forwarded-for': '203.0.113.1' } });
  await untrusted.inject({ url: '/api/ping', headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.equal(warnings().length, 1);
  assert.match(warnings()[0], /INFIDASH_TRUST_PROXY=1/);
  await untrusted.close();

  chunks.length = 0;
  const trusted = await buildApp({ NODE_ENV: 'test', INFIDASH_TRUST_PROXY: '1' }, { trustProxy: resolveTrustProxy({ INFIDASH_TRUST_PROXY: '1' }), stream });
  await trusted.inject({ url: '/api/ping', headers: { 'x-forwarded-for': '203.0.113.1' } });
  assert.equal(warnings().length, 0);
  await trusted.close();
});
