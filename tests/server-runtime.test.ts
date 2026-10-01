import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunEditorialMigrations, shouldServeHttp } from '../src/lib/serverRuntime.js';

test('production server serves HTTP normally', () => {
  assert.equal(shouldServeHttp({ NODE_ENV: 'production' }), true);
});

test('ordinary test imports do not bind an HTTP port', () => {
  assert.equal(shouldServeHttp({ NODE_ENV: 'test' }), false);
});

test('the isolated API test runner may start the server in test mode', () => {
  assert.equal(shouldServeHttp({ NODE_ENV: 'test', INFIDASH_TEST_RUNNER_MANAGED_API: '1' }), true);
  assert.equal(shouldServeHttp({ NODE_ENV: 'test', INFIDASH_TEST_RUNNER_MANAGED_API: 'true' }), false);
});

test('the HTTP server applies pending editorial migrations before listening unless explicitly skipped', () => {
  assert.equal(shouldRunEditorialMigrations({ NODE_ENV: 'production' }), true);
  assert.equal(shouldRunEditorialMigrations({ NODE_ENV: 'production', INFIDASH_SKIP_EDITORIAL_MIGRATIONS: '1' }), false);
  assert.equal(shouldRunEditorialMigrations({ NODE_ENV: 'production', INFIDASH_SKIP_EDITORIAL_MIGRATIONS: 'true' }), true, 'only the exact value 1 skips');
  assert.equal(shouldRunEditorialMigrations({ NODE_ENV: 'test' }), false, 'plain test imports never touch a database');
  assert.equal(shouldRunEditorialMigrations({ NODE_ENV: 'test', INFIDASH_TEST_RUNNER_MANAGED_API: '1' }), true, 'the isolated API runner migrates its disposable database');
});
