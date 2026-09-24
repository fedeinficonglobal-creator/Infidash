import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const previousNodeEnv = process.env.NODE_ENV;
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test-only:test-only@127.0.0.1:5432/infidash_test';
const { app } = await import('../server.js');
await app.ready();
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;
if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = previousDatabaseUrl;

after(async () => app.close());

test('public health route returns liveness only, not business counts', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('dashboard diagnostics require an authenticated session', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
  assert.equal(response.statusCode, 401);
});

test('PDF report download requires an authenticated session', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/clients/client-a/reports/daily.pdf?from=2026-09-01&to=2026-09-30' });
  assert.equal(response.statusCode, 401);
});

test('WooCommerce sales preview requires an authenticated admin session', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/integrations/example/woocommerce/sales-preview?from=2026-09-01&to=2026-09-07' });
  assert.equal(response.statusCode, 401);
});
