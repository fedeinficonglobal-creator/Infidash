import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { assertPublicHttpUrl, assertResolvesToPublicAddress, privateUrlsAllowed, safeFetch } from '../src/lib/urlSafety.js';
import { UserFacingError } from '../src/lib/userFacingError.js';
import { contentRoutes } from '../src/server/content/routes.js';

const MESSAGE = 'La URL debe ser pública (http o https) y no puede apuntar a la red interna';
const strict = { allowPrivate: false };

const blocked = [
  'http://localhost/', 'http://LOCALHOST:8080/x', 'http://app.localhost/', 'http://printer.local/', 'http://db.internal/',
  'http://host.localdomain/', 'http://intranet/', 'http://localhost./',
  'http://127.0.0.1/', 'http://127.255.255.254/', 'http://0.0.0.0/', 'http://0.1.2.3/',
  'http://10.0.0.5/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/', 'http://169.254.0.1/',
  'http://100.64.0.1/', 'http://100.127.255.255/', 'http://198.18.0.1/', 'http://198.19.255.255/',
  'http://224.0.0.1/', 'http://239.255.255.255/', 'http://240.0.0.1/', 'http://255.255.255.255/',
  'http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[febf::1]/',
  'http://[ff02::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/',
  'http://[::ffff:169.254.169.254]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/',
  'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://0x7f000001/', 'http://127.1/',
  'http://user:pass@example.com/', 'http://user@example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url',
];

const allowed = [
  'https://example.com/', 'http://example.com:8080/path?q=1', 'https://sub.domain.example.co.uk/',
  'http://93.184.216.34/', 'https://8.8.8.8/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://100.63.0.1/', 'http://100.128.0.1/',
  'http://198.17.0.1/', 'http://198.20.0.1/', 'http://223.255.255.255/', 'http://169.253.0.1/',
  'http://[2606:2800:220:1:248:1893:25c8:1946]/', 'http://[::ffff:93.184.216.34]/', 'http://localhost.example.com/',
];

for (const url of blocked) {
  test(`assertPublicHttpUrl rejects ${url}`, () => {
    assert.throws(() => assertPublicHttpUrl(url, strict), (error: unknown) => error instanceof UserFacingError && error.message === MESSAGE);
  });
}

for (const url of allowed) {
  test(`assertPublicHttpUrl accepts ${url}`, () => {
    assert.doesNotThrow(() => assertPublicHttpUrl(url, strict));
  });
}

test('INFIDASH_ALLOW_PRIVATE_URLS=1 disables the host checks but not the scheme check', () => {
  assert.equal(privateUrlsAllowed({ INFIDASH_ALLOW_PRIVATE_URLS: '1' }), true);
  assert.equal(privateUrlsAllowed({ INFIDASH_ALLOW_PRIVATE_URLS: '0' }), false);
  assert.equal(privateUrlsAllowed({}), false);
  const previous = process.env.INFIDASH_ALLOW_PRIVATE_URLS;
  process.env.INFIDASH_ALLOW_PRIVATE_URLS = '1';
  try {
    assert.doesNotThrow(() => assertPublicHttpUrl('http://127.0.0.1:3000/'));
    assert.throws(() => assertPublicHttpUrl('ftp://127.0.0.1/'));
  } finally {
    if (previous === undefined) delete process.env.INFIDASH_ALLOW_PRIVATE_URLS;
    else process.env.INFIDASH_ALLOW_PRIVATE_URLS = previous;
  }
});

test('DNS check rejects a public-looking name that resolves to an internal address', async () => {
  const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(assertResolvesToPublicAddress('totally-public.example.com', { resolve, ...strict }), (error: unknown) => error instanceof UserFacingError && error.message === MESSAGE);
});

test('DNS check rejects when any one of several addresses is internal, including IPv6', async () => {
  await assert.rejects(assertResolvesToPublicAddress('mixed.example.com', { ...strict, resolve: async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }] }));
  await assert.rejects(assertResolvesToPublicAddress('v6.example.com', { ...strict, resolve: async () => [{ address: '::ffff:127.0.0.1' }] }));
});

test('DNS check accepts public answers, skips lookups for IP literals and tolerates lookup failures', async () => {
  let lookups = 0;
  const resolve = async () => { lookups += 1; return [{ address: '93.184.216.34' }]; };
  await assertResolvesToPublicAddress('example.com', { resolve, ...strict });
  assert.equal(lookups, 1);
  await assertResolvesToPublicAddress('93.184.216.34', { resolve, ...strict });
  await assertResolvesToPublicAddress('[2606:2800:220:1::1]', { resolve, ...strict });
  assert.equal(lookups, 1);
  await assert.rejects(assertResolvesToPublicAddress('127.0.0.1', { resolve, ...strict }));
  await assertResolvesToPublicAddress('nxdomain.example.com', { ...strict, resolve: async () => { throw new Error('ENOTFOUND'); } });
});

const publicResolve = async () => [{ address: '93.184.216.34' }];
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const ok = () => new Response('{}', { status: 200 });

test('safeFetch refuses internal targets without issuing any request', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return ok(); }) as typeof fetch;
  for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(safeFetch(url, {}, { fetchImpl, resolve: publicResolve, ...strict }), (error: unknown) => error instanceof UserFacingError && error.message === MESSAGE);
  }
  await assert.rejects(safeFetch('https://rebind.example.com/', {}, { fetchImpl, resolve: async () => [{ address: '10.0.0.5' }], ...strict }));
  assert.equal(calls, 0);
});

test('safeFetch sends manual-redirect requests and returns the response for public URLs', async () => {
  const seen: Array<{ url: string; redirect: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { seen.push({ url: String(url), redirect: init?.redirect }); return ok(); }) as typeof fetch;
  const response = await safeFetch('https://example.com/a', { method: 'GET' }, { fetchImpl, resolve: publicResolve, ...strict });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ url: 'https://example.com/a', redirect: 'manual' }]);
});

test('safeFetch refuses a redirect to an internal address and never requests it', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => { requested.push(String(url)); return redirect('http://127.0.0.1/admin'); }) as typeof fetch;
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl, resolve: publicResolve, ...strict }), (error: unknown) => error instanceof UserFacingError && error.message === MESSAGE);
  assert.deepEqual(requested, ['https://example.com/']);
});

test('safeFetch refuses a redirect whose DNS answer is internal', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => { requested.push(String(url)); return redirect('https://evil.example.org/'); }) as typeof fetch;
  const resolve = async (host: string) => [{ address: host === 'evil.example.org' ? '192.168.0.9' : '93.184.216.34' }];
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl, resolve, ...strict }));
  assert.deepEqual(requested, ['https://example.com/']);
});

test('safeFetch follows a redirect to a public https URL, resolving relative locations and dropping credentials cross-origin', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    if (calls.length === 1) return redirect('/moved');
    if (calls.length === 2) return redirect('https://other.example.net/final');
    return ok();
  }) as typeof fetch;
  const response = await safeFetch('https://example.com/start', { headers: { authorization: 'Bearer secret' } }, { fetchImpl, resolve: publicResolve, ...strict });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    { url: 'https://example.com/start', authorization: 'Bearer secret' },
    { url: 'https://example.com/moved', authorization: 'Bearer secret' },
    { url: 'https://other.example.net/final', authorization: null },
  ]);
});

test('safeFetch stops after the maximum number of redirects', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return redirect(`https://example.com/hop${calls}`); }) as typeof fetch;
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl, resolve: publicResolve, ...strict }), (error: unknown) => error instanceof UserFacingError && /redirige demasiadas veces/.test(error.message));
  assert.equal(calls, 4); // the original request plus three followed redirects
  calls = 0;
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl, resolve: publicResolve, maxRedirects: 0, ...strict }));
  assert.equal(calls, 1);
});

test('safeFetch refuses an https to http downgrade and never requests the http target', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => { requested.push(String(url)); return redirect('http://example.com/plain'); }) as typeof fetch;
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl, resolve: publicResolve, ...strict }), (error: unknown) => error instanceof UserFacingError && /https a http/.test(error.message));
  assert.deepEqual(requested, ['https://example.com/']);
});

test('safeFetch with the dev override reaches loopback hosts', async () => {
  const fetchImpl = (async () => ok()) as typeof fetch;
  const response = await safeFetch('http://127.0.0.1:9/x', {}, { fetchImpl, allowPrivate: true });
  assert.equal(response.status, 200);
});

test('content routes reject an internal externalUrl before touching the repository', async () => {
  const app = Fastify({ logger: false });
  let repositoryCalls = 0;
  const repository = new Proxy({}, { get: () => async () => { repositoryCalls += 1; return {}; } });
  await app.register(contentRoutes, {
    repository: repository as never,
    resolveHumanSession: () => ({ user: { id: 'u1', role: 'admin', clientIds: null } }),
  });
  const previous = process.env.INFIDASH_ALLOW_PRIVATE_URLS;
  delete process.env.INFIDASH_ALLOW_PRIVATE_URLS;
  try {
    const post = (externalUrl: string) => app.inject({
      method: 'POST', url: '/api/content/items/k1/publications', headers: { authorization: 'Bearer token' },
      payload: { clientId: 'c1', expectedVersion: 1, accountId: 'a1', desiredScheduledAt: '2026-10-01T09:00:00.000Z', externalUrl, idempotencyKey: 'i1' },
    });
    for (const externalUrl of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'https://intranet/x']) {
      const response = await post(externalUrl);
      assert.equal(response.statusCode, 400, `${externalUrl} -> ${response.body}`);
      assert.match(response.json().error, /externalUrl/);
    }
    assert.equal(repositoryCalls, 0);
    const accepted = await post('https://example.com/article');
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(repositoryCalls, 1);
  } finally {
    if (previous !== undefined) process.env.INFIDASH_ALLOW_PRIVATE_URLS = previous;
    await app.close();
  }
});

test('WordPress probe refuses internal sites without issuing a request', async () => {
  const { testWordPressConnection } = await import('../src/lib/wordpressProbe.js');
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return ok(); }) as typeof fetch;
  for (const siteUrl of ['http://127.0.0.1', 'http://169.254.169.254/latest/meta-data/', 'http://intranet']) {
    const result = await testWordPressConnection({ config: { siteUrl } }, {}, fetchImpl, strict);
    assert.deepEqual(result, { ok: false, error: MESSAGE });
  }
  assert.equal(calls, 0);
  const rebound = await testWordPressConnection({ config: { siteUrl: 'https://blog.example.com' } }, {}, fetchImpl, { ...strict, resolve: async () => [{ address: '10.0.0.5' }] } as never);
  assert.deepEqual(rebound, { ok: false, error: MESSAGE });
  assert.equal(calls, 0);
});

test('WordPress probe still reaches public sites and reports their status', async () => {
  const { testWordPressConnection } = await import('../src/lib/wordpressProbe.js');
  const fetchImpl = (async () => ok()) as typeof fetch;
  const result = await testWordPressConnection({ config: { siteUrl: 'https://blog.example.com/' } }, {}, fetchImpl, { ...strict, resolve: publicResolve } as never);
  assert.deepEqual(result, { ok: true, error: null });
});

test('Clarity export URLs and WooCommerce stores that point inside the network are refused before any request', async () => {
  const { fetchClaritySnapshots } = await import('../src/lib/claritySync.js');
  const { probeWooCommerceOrders } = await import('../src/lib/woocommerce.js');
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return ok(); }) as typeof fetch;
  const previous = process.env.INFIDASH_ALLOW_PRIVATE_URLS;
  delete process.env.INFIDASH_ALLOW_PRIVATE_URLS;
  try {
    for (const exportUrl of ['http://127.0.0.1/export', 'http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/']) {
      await assert.rejects(fetchClaritySnapshots({ clientId: 'c', integrationId: 'i', exportUrl, accessToken: 't' }, fetchImpl), (error: unknown) => error instanceof UserFacingError && error.message === MESSAGE);
    }
    const woo = await probeWooCommerceOrders({ storeUrl: 'https://169.254.169.254', consumerKey: 'ck', consumerSecret: 'cs' }, fetchImpl);
    assert.equal(woo.ok, false);
    assert.equal(calls, 0);
  } finally {
    if (previous !== undefined) process.env.INFIDASH_ALLOW_PRIVATE_URLS = previous;
  }
});
