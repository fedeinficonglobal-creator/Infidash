import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';

const SECRET = 'TOP-SECRET-OUTSIDE-THE-PUBLIC-ROOT';

// Mirrors how server.ts serves the built SPA: the static plugin on `dist`, with the SPA fallback
// answered by the not-found handler. The files sit in a sandbox so a traversal has something to leak.
async function buildApp() {
  const sandbox = mkdtempSync(join(tmpdir(), 'infidash-static-'));
  const root = join(sandbox, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Infidash</title><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("app");');
  writeFileSync(join(sandbox, 'secret.txt'), SECRET);
  const app = fastify();
  await app.register(fastifyStatic, { root, index: ['index.html'] });
  app.setNotFoundHandler((request, reply) => {
    if (!(request.raw.url ?? '').startsWith('/api/')) return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'Ruta no encontrada', code: 'NOT_FOUND' });
  });
  return { app, cleanup: () => rmSync(sandbox, { recursive: true, force: true }) };
}

test('the built SPA is served at the root and its assets are reachable', async () => {
  const { app, cleanup } = await buildApp();
  try {
    const home = await app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /<div id="root">/);
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    assert.equal(asset.statusCode, 200);
    assert.match(asset.body, /console\.log/);
  } finally { await app.close(); cleanup(); }
});

test('client-side routes fall back to index.html but unknown API routes stay JSON 404s', async () => {
  const { app, cleanup } = await buildApp();
  try {
    const route = await app.inject({ method: 'GET', url: '/clientes/inficon-global/contenidos' });
    assert.equal(route.statusCode, 200);
    assert.match(route.body, /<div id="root">/);
    const api = await app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(api.statusCode, 404);
    assert.equal(api.json().code, 'NOT_FOUND');
  } finally { await app.close(); cleanup(); }
});

test('path traversal and non-canonical URL tricks never reveal files outside the public root', async () => {
  const { app, cleanup } = await buildApp();
  try {
    for (const url of [
      '/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/assets/../../secret.txt',
      '/assets/..%2f..%2fsecret.txt', '//..//secret.txt', '/..\secret.txt', '/%5c..%5csecret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/.%2e/secret.txt',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      assert.ok(!response.body.includes(SECRET), `${url} leaked a file outside the root (status ${response.statusCode})`);
    }
  } finally { await app.close(); cleanup(); }
});
