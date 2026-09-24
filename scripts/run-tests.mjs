import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDirectory = resolve(root, 'tests');
const files = readdirSync(testsDirectory)
  .filter(file => file.endsWith('.test.ts'))
  .sort()
  .map(file => `tests/${file}`);

const databaseFiles = ['tests/monthly-model.test.ts'];
const apiFiles = ['tests/api-regression.test.ts'];
const unitFiles = files.filter(file => !databaseFiles.includes(file) && !apiFiles.includes(file));

function fail(message) {
  console.error(`Test suite refused: ${message}`);
  process.exit(2);
}

function readLocalTestDatabase() {
  const connectionString = process.env.INFIDASH_TEST_DATABASE_URL;
  if (!connectionString) {
    fail('set INFIDASH_TEST_DATABASE_URL to a disposable local PostgreSQL test database');
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    fail('INFIDASH_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    fail('INFIDASH_TEST_DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!localHosts.has(databaseUrl.hostname.toLowerCase())) {
    fail('mutating test suites only accept loopback PostgreSQL hosts');
  }
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(databaseName)) {
    fail('the PostgreSQL database name must contain a separate "test" segment');
  }

  return connectionString;
}

const suite = process.argv[2] ?? 'unit';
if (suite === '--list') {
  process.stdout.write(`${JSON.stringify(unitFiles)}\n`);
  process.exit(0);
}

const allowedSuites = new Set(['unit', 'db', 'api']);
if (!allowedSuites.has(suite) || process.argv.length > 3) {
  console.error('Usage: node scripts/run-tests.mjs [unit|db|api|--list]');
  process.exit(2);
}

let selectedFiles = unitFiles;
const childEnv = { ...process.env };
if (suite === 'db' || suite === 'api') {
  const databaseUrl = readLocalTestDatabase();
  childEnv.DATABASE_URL = databaseUrl;
  childEnv.INFIDASH_TEST_SUITE = suite;

  if (suite === 'db') {
    selectedFiles = databaseFiles;
    childEnv.INFIDASH_SKIP_LEGACY_SQLITE_IMPORT = '1';
  } else {
    const apiUrl = process.env.INFIDASH_TEST_API_BASE_URL;
    if (!apiUrl) {
      fail('set INFIDASH_TEST_API_BASE_URL to a local API backed by the same disposable test database');
    }
    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch {
      fail('INFIDASH_TEST_API_BASE_URL must be a valid URL');
    }
    if (parsedApiUrl.protocol !== 'http:' || !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsedApiUrl.hostname.toLowerCase())) {
      fail('API tests only accept an http:// loopback endpoint');
    }
    if (parsedApiUrl.pathname !== '/' || parsedApiUrl.search || parsedApiUrl.hash) {
      fail('INFIDASH_TEST_API_BASE_URL must be a loopback origin without a path');
    }
    if (!parsedApiUrl.port) {
      fail('INFIDASH_TEST_API_BASE_URL must include an explicit port for the isolated API server');
    }
    const tempDirectory = mkdtempSync(join(tmpdir(), 'infidash-api-test-'));
    const sqlitePath = join(tempDirectory, 'legacy-fixture.sqlite');
    const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
      resolve(root, 'scripts/create-test-sqlite-fixture.py'), sqlitePath,
    ], { cwd: root, encoding: 'utf8' });
    if (python.status !== 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      fail(`could not create the isolated SQLite fixture: ${python.stderr || python.stdout}`);
    }
    childEnv.NODE_ENV = 'test';
    childEnv.INFIDASH_TEST_API_BASE_URL = apiUrl;
    childEnv.API_BASE_URL = apiUrl;
    childEnv.API_PORT = parsedApiUrl.port;
    childEnv.INFIDASH_TEST_RUNNER_MANAGED_API = '1';
    childEnv.INFIDASH_TEST_LEGACY_SQLITE_PATH = sqlitePath;
    childEnv.INFIDASH_BACKUP_DIR = join(tempDirectory, 'backups');
    selectedFiles = apiFiles;

    const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
    });
    const healthUrl = `${apiUrl}/api/health`;
    let ready = false;
    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (server.exitCode !== null) break;
        try {
          const response = await fetch(healthUrl);
          if (response.ok) { ready = true; break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) {
        console.error('Test suite refused: isolated API server did not become healthy on the configured loopback origin');
        process.exitCode = 2;
      } else {
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...selectedFiles], {
          cwd: root, env: childEnv, stdio: 'inherit',
        });
        if (result.error) { console.error(result.error.message); process.exitCode = 1; }
        else process.exitCode = result.status ?? 1;
      }
    } finally {
      server.kill('SIGTERM');
      await new Promise(resolve => {
        if (server.exitCode !== null) return resolve();
        const timeout = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000);
        server.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
      rmSync(tempDirectory, { recursive: true, force: true });
    }
    process.exit(process.exitCode ?? 1);
  }
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...selectedFiles], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
