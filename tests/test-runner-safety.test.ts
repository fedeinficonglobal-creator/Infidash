import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runSuite(suite: 'db' | 'api', overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  delete env.INFIDASH_TEST_DATABASE_URL;
  delete env.INFIDASH_TEST_API_BASE_URL;
  delete env.INFIDASH_TEST_SUITE;
  delete env.API_BASE_URL;
  delete env.DATABASE_URL;
  Object.assign(env, overrides);

  return spawnSync(process.execPath, ['scripts/run-tests.mjs', suite], {
    encoding: 'utf8',
    env,
  });
}

test('database suite refuses to run without a dedicated local test database', () => {
  const result = runSuite('db');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INFIDASH_TEST_DATABASE_URL/);
});

test('API suite refuses to run without a dedicated test database and API URL', () => {
  const result = runSuite('api');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INFIDASH_TEST_DATABASE_URL/);
});

test('mutating suites reject remote and non-test databases', () => {
  const remote = runSuite('db', {
    INFIDASH_TEST_DATABASE_URL: 'postgresql://test:test@db.example.com/infidash_test',
  });
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /loopback PostgreSQL hosts/);

  const nonTestName = runSuite('db', {
    INFIDASH_TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1/infidash',
  });
  assert.notEqual(nonTestName.status, 0);
  assert.match(nonTestName.stderr, /separate "test" segment/);
});

test('API suite rejects non-loopback endpoints', () => {
  const result = runSuite('api', {
    INFIDASH_TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1/infidash_test',
    INFIDASH_TEST_API_BASE_URL: 'https://api.example.com',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /http:\/\/ loopback endpoint/);
});
