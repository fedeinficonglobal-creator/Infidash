const suite = process.env.INFIDASH_TEST_SUITE;
if (!['db', 'api'].includes(suite)) {
  throw new Error('Set up the dedicated test harness with npm run test:db or npm run test:api.');
}

const databaseUrl = process.env.INFIDASH_TEST_DATABASE_URL;
if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) {
  throw new Error('Mutating tests require DATABASE_URL to match INFIDASH_TEST_DATABASE_URL.');
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)
  || !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsedDatabaseUrl.hostname.toLowerCase())
  || !/(?:^|[_-])test(?:$|[_-])/i.test(databaseName)) {
  throw new Error('Mutating tests require a loopback PostgreSQL database with a separate "test" name segment.');
}

if (suite === 'api') {
  if (process.env.INFIDASH_TEST_RUNNER_MANAGED_API !== '1') {
    throw new Error('API tests must be launched by npm run test:api so their server is bound to the isolated test database.');
  }
  const apiUrl = process.env.INFIDASH_TEST_API_BASE_URL;
  if (!apiUrl || process.env.API_BASE_URL !== apiUrl) {
    throw new Error('API tests require API_BASE_URL to match INFIDASH_TEST_API_BASE_URL.');
  }
  const parsedApiUrl = new URL(apiUrl);
  if (parsedApiUrl.protocol !== 'http:'
    || !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsedApiUrl.hostname.toLowerCase())) {
    throw new Error('API tests require an http:// loopback API target.');
  }
  if (!parsedApiUrl.port || parsedApiUrl.port !== process.env.API_PORT) {
    throw new Error('API tests require the runner-managed API port to match the loopback URL.');
  }
  const sqlitePath = process.env.INFIDASH_TEST_LEGACY_SQLITE_PATH;
  const tempRoot = resolve(tmpdir());
  const fixturePath = sqlitePath ? resolve(sqlitePath) : '';
  if (!fixturePath.startsWith(`${tempRoot}${process.platform === 'win32' ? '\\' : '/'}`)
    || !dirname(fixturePath).split(/[\\/]/).at(-1)?.startsWith('infidash-api-test-')
    || fixturePath.split(/[\\/]/).at(-1) !== 'legacy-fixture.sqlite'
    || !existsSync(fixturePath)) {
    throw new Error('API tests require the generated legacy SQLite fixture under an infidash-api-test temp directory.');
  }
}
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
