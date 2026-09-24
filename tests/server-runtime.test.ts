import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldServeHttp } from '../src/lib/serverRuntime.js';

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
