import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { EditorialApiRepository } from '../src/server/content/apiRepository.js';
import { buildContentHubImportPlan, importContentHub, parseContentHubExport, sourceHash, stableImportUuid } from '../src/server/content/importContentHub.js';
import { checksumMigration, discoverMigrations } from '../src/server/content/migrations.js';
import { buildPostgresPoolConfig } from '../src/server/content/postgres.js';
import { ContentRepository, type Queryable } from '../src/server/content/repository.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

test('editorial migration declares tenant-safe foreign keys and operational indexes', async () => {
  const migration = await readFile(path.join(repositoryRoot, 'db', 'migrations', '0001_editorial_schema.sql'), 'utf8');
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS editorial/);
  assert.match(migration, /FOREIGN KEY \(client_id, calendar_id\)/);
  assert.match(migration, /FOREIGN KEY \(client_id, content_id\)/);
  assert.match(migration, /UNIQUE \(client_id, idempotency_key\)/);
  assert.match(migration, /publications_client_status_schedule_idx/);
  assert.match(migration, /WHERE postiz_post_id IS NOT NULL/);
});

test('migration discovery is deterministic and checksums detect edits', async () => {
  const directory = path.join(repositoryRoot, 'db', 'migrations');
  assert.deepEqual(await discoverMigrations(directory), ['0001_editorial_schema.sql', '0002_editorial_api.sql']);
  assert.equal(checksumMigration('SELECT 1;'), checksumMigration('SELECT 1;'));
  assert.notEqual(checksumMigration('SELECT 1;'), checksumMigration('SELECT 2;'));
});

test('the supplied Content Hub JSON is accepted as a schema-only dry-run source', async () => {
  const raw = JSON.parse(await readFile(path.join(repositoryRoot, 'tests', 'fixtures', 'content-hub-schema.json'), 'utf8'));
  const parsed = parseContentHubExport(raw);
  assert.equal(parsed.schemaOnly, true);
  assert.equal(parsed.tables.articles.length, 0);
});

test('Content Hub transform is deterministic and requires explicit client/account mappings', () => {
  const tables = parseContentHubExport({
    clients: [{ id: 1, name: 'Cliente' }],
    content_plan: [{ id: 10, client_id: 1, title: 'Plan', status: 'preparado', keywords: 'uno, dos' }],
    articles: [{ id: 20, client_id: 1, content_plan_id: 10, title: 'Artículo', status: 'draft' }],
    article_publications: [{ id: 30, article_id: 20, channel_id: 5, status: 'published' }],
    publication_channels: [{ id: 5, name: 'gmb' }],
  }).tables;

  const missing = buildContentHubImportPlan(tables, { clients: {} });
  assert.ok(missing.conflicts.some((conflict) => conflict.entity === 'client'));

  const mapping = { clients: { '1': 'client-1' }, accounts: { '1:5': 'd57b6271-d925-4f83-a55e-c02e395c6db2' } };
  const first = buildContentHubImportPlan(tables, mapping);
  const second = buildContentHubImportPlan(tables, mapping);
  assert.deepEqual(first, second);
  assert.deepEqual(first.operations.map((item) => item.entity), ['calendar', 'plan_item', 'content', 'publication']);
  assert.equal(first.operations.find((item) => item.entity === 'publication')?.values.status, 'unknown');
  assert.equal(stableImportUuid('content', '20', 'client-1'), stableImportUuid('content', '20', 'client-1'));
  assert.equal(sourceHash({ b: 2, a: 1 }), sourceHash({ a: 1, b: 2 }));
});

test('applying the same Content Hub export twice skips already imported rows', async () => {
  const mappingRows = new Map<string, { target_id: string; source_hash: string }>();
  const fakeClient = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('SELECT target_id, source_hash')) {
        const key = `${values[0]}:${values[1]}:${values[2]}`;
        const row = mappingRows.get(key);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes('INSERT INTO editorial.legacy_mappings')) {
        mappingRows.set(`${values[0]}:${values[1]}:${values[3]}`, {
          target_id: String(values[2]), source_hash: String(values[4]),
        });
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const fakePool = { async connect() { return fakeClient; } } as unknown as Pool;
  const exportData = {
    content_plan: [{ id: 10, client_id: 1, title: 'Plan' }],
    articles: [{ id: 20, client_id: 1, content_plan_id: 10, title: 'Artículo' }],
  };
  const input = { exportData, mappings: { clients: { '1': 'client-1' } }, dryRun: false, pool: fakePool };
  const first = await importContentHub(input);
  const second = await importContentHub(input);
  assert.equal(first.applied, 3);
  assert.equal(second.applied, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.conflicts.length, 0);
});

test('repository sends user values separately from parameterized SQL', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fake: Queryable = {
    async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return {
        command: 'INSERT', rowCount: 1, oid: 0, fields: [],
        rows: [{
          id: values[0], client_id: values[1], title: values[2], start_date: values[3], end_date: values[4],
          summary: values[5], insights: {}, created_by: values[7], version: 1, status: 'draft',
          created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z',
        }] as T[],
      } satisfies QueryResult<T>;
    },
  };
  const repository = new ContentRepository(fake);
  const title = "Título ' con $1 y ; DROP TABLE clients";
  await repository.createCalendar({ clientId: 'client-1', title });
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3/);
  assert.equal(calls[0].values[2], title);
  assert.equal(calls[0].sql.includes(title), false);
});

test('job heartbeat is bound to the authorized client as well as the lease', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fake: Queryable = {
    async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return {
        command: 'UPDATE', rowCount: 1, oid: 0, fields: [],
        rows: [{ id: values[0], client_id: values[1], status: 'running' }] as T[],
      } satisfies QueryResult<T>;
    },
  };
  const repository = new EditorialApiRepository(fake as unknown as Pool);
  await repository.heartbeatJob('40789475-9d0d-47ae-b8f4-44b6761a12fd', 'client-a', '43daf834-6356-4642-9478-b43988c72878', 120);
  assert.match(calls[0].sql, /client_id=\$2/);
  assert.match(calls[0].sql, /lease_token=\$3::uuid/);
  assert.deepEqual(calls[0].values, ['40789475-9d0d-47ae-b8f4-44b6761a12fd', 'client-a', '43daf834-6356-4642-9478-b43988c72878', 120]);
});

test('pool configuration is explicit and bounded', () => {
  const config = buildPostgresPoolConfig({
    DATABASE_URL: 'postgresql://user:pass@db/infidash',
    DATABASE_SSL: 'require',
    EDITORIAL_DB_POOL_MAX: '7',
  });
  assert.equal(config.max, 7);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.throws(() => buildPostgresPoolConfig({}), /DATABASE_URL/);
});
