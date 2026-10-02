import './helpers/isolated-harness-required.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Expected core objects, derived from the DDL frozen in db/migrations/0004_core_baseline.sql
// (CREATE TABLE columns plus the guarded ADD COLUMN statements: integrations.webhook_secret is only added there).
const EXPECTED_COLUMNS: Record<string, Array<[string, string]>> = {
  users: [['id', 'text'], ['email', 'text'], ['name', 'text'], ['password_hash', 'text'], ['role', 'text'], ['active', 'integer'], ['created_at', 'text'], ['updated_at', 'text']],
  sessions: [['id', 'text'], ['user_id', 'text'], ['token_hash', 'text'], ['created_at', 'text'], ['expires_at', 'text']],
  organizations: [['id', 'text'], ['name', 'text'], ['slug', 'text'], ['created_at', 'text']],
  clients: [['id', 'text'], ['org_id', 'text'], ['name', 'text'], ['slug', 'text'], ['logo_url', 'text'], ['industry', 'text'], ['health_score', 'integer'], ['kpi_thresholds_json', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  client_memberships: [['id', 'text'], ['user_id', 'text'], ['client_id', 'text'], ['created_at', 'text']],
  schema_backfills: [['key', 'text'], ['completed_at', 'text']],
  integrations: [['id', 'text'], ['client_id', 'text'], ['provider', 'text'], ['label', 'text'], ['status', 'text'], ['config_json', 'text'], ['credentials_json', 'text'], ['is_active', 'integer'], ['last_sync', 'text'], ['last_error', 'text'], ['created_at', 'text'], ['updated_at', 'text'], ['webhook_secret', 'text']],
  woocommerce_sales_snapshots: [['integration_id', 'text'], ['source_key', 'text'], ['purchase_from', 'text'], ['purchase_to', 'text'], ['orders_json', 'jsonb'], ['synced_at', 'text']],
  ga4_snapshots: [['integration_id', 'text'], ['property_id', 'text'], ['period_from', 'text'], ['period_to', 'text'], ['sessions_json', 'jsonb'], ['traffic_sources_json', 'jsonb'], ['top_pages_json', 'jsonb'], ['landing_pages_json', 'jsonb'], ['synced_at', 'text']],
  google_ads_snapshots: [['integration_id', 'text'], ['customer_id', 'text'], ['period_from', 'text'], ['period_to', 'text'], ['campaigns_json', 'jsonb'], ['currency_code', 'text'], ['synced_at', 'text']],
  daily_stats: [['id', 'text'], ['client_id', 'text'], ['stat_date', 'text'], ['revenue', 'real'], ['roas', 'real'], ['clicks', 'integer'], ['conversions', 'integer'], ['cpa', 'real'], ['leads', 'integer'], ['traffic', 'integer'], ['notes', 'text'], ['source', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  ux_snapshots: [['id', 'text'], ['client_id', 'text'], ['snapshot_date', 'text'], ['sessions', 'integer'], ['page_views', 'integer'], ['rage_clicks', 'integer'], ['dead_clicks', 'integer'], ['scroll_depth_avg', 'real'], ['engaged_sessions', 'integer'], ['conversions', 'integer'], ['conversion_rate', 'real'], ['notes', 'text'], ['source', 'text'], ['payload_json', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  operational_plans: [['id', 'text'], ['client_id', 'text'], ['domain', 'text'], ['period_key', 'text'], ['version', 'integer'], ['rows_json', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  report_runs: [['id', 'text'], ['client_id', 'text'], ['from_date', 'text'], ['to_date', 'text'], ['generated_at', 'text'], ['created_by_user_id', 'text'], ['pdf_base64', 'text'], ['bytes', 'integer'], ['last_sent_at', 'text'], ['last_sent_to', 'text'], ['last_send_error', 'text']],
  rrss_channels: [['id', 'text'], ['client_id', 'text'], ['platform_key', 'text'], ['label', 'text'], ['is_active', 'integer'], ['sort_order', 'integer'], ['created_at', 'text'], ['updated_at', 'text']],
  monthly_kpis: [['id', 'text'], ['client_id', 'text'], ['department_key', 'text'], ['metric_key', 'text'], ['month_key', 'text'], ['target_value', 'real'], ['target_text', 'text'], ['actual_value', 'real'], ['actual_text', 'text'], ['status', 'text'], ['difference_value', 'real'], ['difference_pct', 'real'], ['notes', 'text'], ['closed_at', 'text'], ['created_by_user_id', 'text'], ['updated_by_user_id', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  monthly_kpi_cycles: [['client_id', 'text'], ['month_key', 'text'], ['closed_at', 'text'], ['closed_by_user_id', 'text'], ['close_token', 'text'], ['reopened_at', 'text'], ['reopened_by_user_id', 'text'], ['reopen_reason', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
  monthly_kpi_events: [['id', 'text'], ['kpi_id', 'text'], ['client_id', 'text'], ['month_key', 'text'], ['action', 'text'], ['actor_user_id', 'text'], ['reason', 'text'], ['occurred_at', 'text'], ['snapshot_json', 'text']],
  leads: [['id', 'text'], ['client_id', 'text'], ['integration_id', 'text'], ['source', 'text'], ['name', 'text'], ['email', 'text'], ['phone', 'text'], ['message', 'text'], ['status', 'text'], ['dedupe_key', 'text'], ['raw_payload_json', 'text'], ['received_at', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
};

// Created by 0004 and dropped again by 0005: only present in a schema where the baseline alone was applied.
const AI_INSIGHTS_COLUMNS: Array<[string, string]> = [['id', 'text'], ['client_id', 'text'], ['insight_json', 'text'], ['created_at', 'text']];

const EXPECTED_INDEXES = ['idx_client_memberships_user', 'idx_report_runs_client_generated', 'idx_monthly_kpi_events_kpi_time', 'idx_leads_client_received_id', 'idx_leads_integration_delivery'];

const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');

type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

async function assertCoreSchema(db: Queryable, schema: string, options: { baselineOnly: boolean }) {
  const columns = await db.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1`,
    [schema],
  );
  const actual = new Map<string, string>(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    for (const [column, dataType] of expected) {
      // 0006 converts daily_stats.stat_date from the baseline's TEXT to a native DATE.
      // 0007 converts sessions.expires_at and leads.received_at to TIMESTAMPTZ.
      const converted = !options.baselineOnly && (
        (table === 'daily_stats' && column === 'stat_date' && 'date')
        || (table === 'sessions' && column === 'expires_at' && 'timestamp with time zone')
        || (table === 'leads' && column === 'received_at' && 'timestamp with time zone')
      );
      const expectedType = converted || dataType;
      assert.equal(actual.get(`${table}.${column}`), expectedType, `${table}.${column}`);
    }
  }

  for (const [column, dataType] of AI_INSIGHTS_COLUMNS) {
    if (options.baselineOnly) assert.equal(actual.get(`ai_insights.${column}`), dataType, `ai_insights.${column}`);
    else assert.equal(actual.get(`ai_insights.${column}`), undefined, `ai_insights.${column} must be dropped by 0005`);
  }

  const indexes = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [schema]);
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const name of EXPECTED_INDEXES) {
    assert.ok(indexNames.has(name), `missing index ${name}`);
  }
  // 0007 adds the index that supports the hourly expired-session purge.
  assert.equal(indexNames.has('idx_sessions_expires_at'), !options.baselineOnly, 'idx_sessions_expires_at exists only after 0007');
}

test('the core migration is applied by the runner, twice, and creates every core table, column and index', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  const { runCoreMigrations, runEditorialMigrations } = await import('../src/server/content/migrations.js');
  try {
    const pool = getCorePool();
    await runCoreMigrations(pool);
    const second = await runEditorialMigrations(pool);
    assert.deepEqual(second.applied.filter((version) => version.includes('_core_')), []);
    assert.ok(second.alreadyApplied.includes('0004_core_baseline.sql'));
    const third = await runEditorialMigrations(pool);
    assert.deepEqual(third.applied, []);

    const schema = (await pool.query('SELECT current_schema() AS schema')).rows[0].schema;
    await assertCoreSchema(pool, schema, { baselineOnly: false });
    const registry = await pool.query(`SELECT version FROM public.schema_migrations WHERE version IN ('0004_core_baseline.sql', '0005_core_drop_ai_insights.sql', '0006_core_daily_stats_date.sql', '0007_core_timestamptz_sessions_leads.sql', '0008_editorial_media_cleanup_log.sql')`);
    assert.equal(registry.rows.length, 5);
  } finally {
    await closeCorePool();
  }
});

test('the baseline SQL builds the full schema on an empty schema and is a no-op when run again', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  const sql = await readFile(path.join(migrationsDirectory, '0004_core_baseline.sql'), 'utf8');
  const schema = `core_baseline_test_${process.pid}`;
  const client = await getCorePool().connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(sql);
    await assertCoreSchema(client, schema, { baselineOnly: true });
    await client.query(sql);
    await assertCoreSchema(client, schema, { baselineOnly: true });

    // A legacy ux_snapshots table (created before most columns existed) is upgraded in place, not recreated.
    await client.query(`DROP TABLE ux_snapshots CASCADE`);
    await client.query(`CREATE TABLE ux_snapshots (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE)`);
    await client.query(sql);
    await assertCoreSchema(client, schema, { baselineOnly: true });
  } finally {
    try {
      await client.query('SET search_path TO DEFAULT');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      client.release();
      await closeCorePool();
    }
  }
});

const STAT_COLUMNS = 'id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at';

test('0006 converts daily_stats.stat_date to DATE: one row per day (latest update), invalid values quarantined, idempotent', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  const baseline = await readFile(path.join(migrationsDirectory, '0004_core_baseline.sql'), 'utf8');
  const migration = await readFile(path.join(migrationsDirectory, '0006_core_daily_stats_date.sql'), 'utf8');
  const schema = `core_stat_date_test_${process.pid}`;
  const client = await getCorePool().connect();
  const statDateType = async () =>
    (await client.query(`SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'daily_stats' AND column_name = 'stat_date'`, [schema])).rows[0].data_type;
  const insertStat = (id: string, clientId: string, statDate: string, revenue: number, updatedAt: string) =>
    client.query(
      `INSERT INTO daily_stats (${STAT_COLUMNS}) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, 0, $5, 'manual', '2024-01-01T00:00:00.000Z', $6)`,
      [id, clientId, statDate, revenue, `note ${id}`, updatedAt],
    );
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(baseline);
    assert.equal(await statDateType(), 'text');

    for (const id of ['a', 'b']) {
      await client.query(`INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES ($1, $1, $1, '2024-01-01', '2024-01-01')`, [id]);
    }
    // Client a, 2024-01-31 spelled three ways: the timestamp spelling was updated last and must survive.
    await insertStat('a-plain', 'a', '2024-01-31', 1, '2024-02-01T10:00:00.000Z');
    await insertStat('a-zulu', 'a', '2024-01-31T00:00:00Z', 2, '2024-03-01T10:00:00.000Z');
    await insertStat('a-space', 'a', ' 2024-01-31 10:00:00+02', 3, '2024-02-15T10:00:00.000Z');
    // The same day for another client is NOT a duplicate.
    await insertStat('b-plain', 'b', '2024-01-31', 4, '2024-02-01T10:00:00.000Z');
    // A normal single row (leap day).
    await insertStat('a-feb', 'a', '2024-02-29', 5, '2024-02-29T10:00:00.000Z');
    // Unparseable or ambiguous values are quarantined verbatim, never converted or lost.
    await insertStat('a-garbage', 'a', 'not-a-date', 6, '2024-02-01T10:00:00.000Z');
    await insertStat('a-impossible', 'a', '2024-02-30', 7, '2024-02-01T10:00:00.000Z');
    await insertStat('b-slashes', 'b', '31/01/2024', 8, '2024-02-01T10:00:00.000Z');
    await insertStat('b-empty', 'b', '', 9, '2024-02-01T10:00:00.000Z');

    await client.query(migration);

    assert.equal(await statDateType(), 'date');
    const helper = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'daily_stats' AND column_name = 'stat_date_canonical'`, [schema]);
    assert.equal(helper.rowCount, 0, 'the temporary helper column is gone');

    const kept = await client.query(`SELECT id, client_id, stat_date::text AS stat_date FROM daily_stats ORDER BY id`);
    assert.deepEqual(kept.rows, [
      { id: 'a-feb', client_id: 'a', stat_date: '2024-02-29' },
      { id: 'a-zulu', client_id: 'a', stat_date: '2024-01-31' },
      { id: 'b-plain', client_id: 'b', stat_date: '2024-01-31' },
    ]);

    const quarantine = await client.query(`SELECT id, stat_date, revenue, notes, quarantined_at IS NOT NULL AS stamped FROM daily_stats_invalid_dates ORDER BY id`);
    assert.deepEqual(quarantine.rows, [
      { id: 'a-garbage', stat_date: 'not-a-date', revenue: 6, notes: 'note a-garbage', stamped: true },
      { id: 'a-impossible', stat_date: '2024-02-30', revenue: 7, notes: 'note a-impossible', stamped: true },
      { id: 'b-empty', stat_date: '', revenue: 9, notes: 'note b-empty', stamped: true },
      { id: 'b-slashes', stat_date: '31/01/2024', revenue: 8, notes: 'note b-slashes', stamped: true },
    ]);

    // UNIQUE(client_id, stat_date) still exists over the DATE column and ON CONFLICT can infer it.
    const unique = await client.query(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'daily_stats' AND i.indisunique AND NOT i.indisprimary`,
      [schema],
    );
    assert.equal(unique.rows.length, 1);
    assert.match(unique.rows[0].definition, /\(client_id, stat_date\)/);
    await client.query(
      `INSERT INTO daily_stats (${STAT_COLUMNS}) VALUES ('a-new', 'a', '2024-01-31', 10, 0, 0, 0, 0, 0, 0, NULL, 'manual', 'x', 'x')
       ON CONFLICT (client_id, stat_date) DO UPDATE SET revenue = EXCLUDED.revenue`,
    );
    assert.equal((await client.query(`SELECT revenue FROM daily_stats WHERE client_id = 'a' AND stat_date = DATE '2024-01-31'`)).rows[0].revenue, 10);
    await assert.rejects(
      () => client.query(`INSERT INTO daily_stats (${STAT_COLUMNS}) VALUES ('a-bad', 'a', '2024-02-30', 0, 0, 0, 0, 0, 0, 0, NULL, 'manual', 'x', 'x')`),
      /out of range/i,
    );

    // Rerunning is a no-op: nothing is moved, deleted or converted a second time.
    await client.query(migration);
    assert.equal((await client.query(`SELECT count(*)::int AS total FROM daily_stats`)).rows[0].total, 3);
    assert.equal((await client.query(`SELECT count(*)::int AS total FROM daily_stats_invalid_dates`)).rows[0].total, 4);
    assert.equal(await statDateType(), 'date');
  } finally {
    try {
      await client.query('SET search_path TO DEFAULT');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      client.release();
      await closeCorePool();
    }
  }
});

test('the core pool reads a DATE column back as a YYYY-MM-DD string, never a Date', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  try {
    const { rows } = await getCorePool().query(`SELECT DATE '2024-01-31' AS day, DATE '0001-01-01' AS first_day, $1::date AS param_day`, ['2024-02-29']);
    assert.deepEqual(rows[0], { day: '2024-01-31', first_day: '0001-01-01', param_day: '2024-02-29' });
  } finally {
    await closeCorePool();
  }
});

test('0007 converts sessions.expires_at and leads.received_at to TIMESTAMPTZ: garbage sessions deleted, leads kept with a fallback, indexes kept, idempotent', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  const baseline = await readFile(path.join(migrationsDirectory, '0004_core_baseline.sql'), 'utf8');
  const migration = await readFile(path.join(migrationsDirectory, '0007_core_timestamptz_sessions_leads.sql'), 'utf8');
  const schema = `core_timestamptz_test_${process.pid}`;
  const client = await getCorePool().connect();
  const columnType = async (table: string, column: string) =>
    (await client.query(`SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, table, column])).rows[0].data_type;
  const insertLead = (id: string, receivedAt: string, createdAt: string) =>
    client.query(
      `INSERT INTO leads (id, client_id, source, status, raw_payload_json, received_at, created_at, updated_at) VALUES ($1, 'c', 'wordpress', 'new', '{}', $2, $3, $3)`,
      [id, receivedAt, createdAt],
    );
  const insertSession = (id: string, expiresAt: string) =>
    client.query(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ($1, 'u', $2, '2024-01-01T00:00:00.000Z', $3)`, [id, `hash-${id}`, expiresAt]);
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(baseline);
    assert.equal(await columnType('sessions', 'expires_at'), 'text');
    assert.equal(await columnType('leads', 'received_at'), 'text');

    await client.query(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES ('u', 'u@x.test', 'U', 'h', 'admin', '2024-01-01', '2024-01-01')`);
    await client.query(`INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES ('c', 'C', 'c', '2024-01-01', '2024-01-01')`);

    await insertSession('s-live', '2030-01-01T00:00:00.000Z');
    await insertSession('s-offset', '2030-06-01 10:00:00+02');
    await insertSession('s-garbage', 'soon');
    await insertSession('s-impossible', '2030-02-30T00:00:00.000Z');
    await insertSession('s-empty', '');
    await insertSession('s-special', 'infinity');

    // l1 and l2 share an instant (id is the tiebreaker); lg1 and lg2 carry unparseable received_at values.
    await insertLead('l1', '2024-03-01T10:00:00.000Z', '2024-03-01T10:00:00.000Z');
    await insertLead('l2', '2024-03-01T10:00:00.000Z', '2024-03-01T10:00:00.000Z');
    await insertLead('l3', '2024-03-02T09:00:00.000Z', '2024-03-02T09:00:00.000Z');
    await insertLead('l4', '2024-02-01 10:00:00+02', '2024-02-01T08:00:00.000Z');
    await insertLead('lg1', 'garbage', '2024-01-15T08:00:00.000Z');
    await insertLead('lg2', '2024-02-30T00:00:00Z', 'also garbage');

    // Order of the canonical ISO rows under the old TEXT comparison.
    const orderBefore = (await client.query(`SELECT id FROM leads WHERE id IN ('l1', 'l2', 'l3') ORDER BY received_at DESC, id DESC`)).rows.map((row) => row.id);
    assert.deepEqual(orderBefore, ['l3', 'l2', 'l1']);

    await client.query(migration);

    assert.equal(await columnType('sessions', 'expires_at'), 'timestamp with time zone');
    assert.equal(await columnType('leads', 'received_at'), 'timestamp with time zone');
    for (const [table, column] of [['sessions', 'expires_at_ts'], ['leads', 'received_at_ts']]) {
      const helper = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, table, column]);
      assert.equal(helper.rowCount, 0, `the temporary helper column ${table}.${column} is gone`);
    }

    // Unreadable sessions are deleted; readable ones keep their instant (read back through the core pool parser).
    const sessions = await client.query(`SELECT id, expires_at FROM sessions ORDER BY id`);
    assert.deepEqual(sessions.rows, [
      { id: 's-live', expires_at: '2030-01-01T00:00:00.000Z' },
      { id: 's-offset', expires_at: '2030-06-01T08:00:00.000Z' },
    ]);

    // No lead is ever deleted; unparseable dates fall back to created_at, then to now(), with the original kept.
    const leads = await client.query(`SELECT id, received_at FROM leads ORDER BY id`);
    assert.equal(leads.rows.length, 6);
    const byId = new Map<string, string>(leads.rows.map((row) => [row.id, row.received_at]));
    assert.equal(byId.get('l1'), '2024-03-01T10:00:00.000Z');
    assert.equal(byId.get('l4'), '2024-02-01T08:00:00.000Z');
    assert.equal(byId.get('lg1'), '2024-01-15T08:00:00.000Z');
    assert.ok(Math.abs(Date.parse(byId.get('lg2') as string) - Date.now()) < 10 * 60_000, 'lg2 falls back to now()');

    const fallbacks = await client.query(`SELECT lead_id, original_received_at, replacement_received_at FROM leads_received_at_fallbacks ORDER BY lead_id`);
    assert.deepEqual(fallbacks.rows.map((row) => [row.lead_id, row.original_received_at]), [['lg1', 'garbage'], ['lg2', '2024-02-30T00:00:00Z']]);
    assert.equal(fallbacks.rows[0].replacement_received_at, '2024-01-15T08:00:00.000Z');
    assert.equal(fallbacks.rows[1].replacement_received_at, byId.get('lg2'));

    // The listing order of the untouched rows is unchanged, and the full order is newest first with id as tiebreaker.
    const orderAfter = (await client.query(`SELECT id FROM leads WHERE id IN ('l1', 'l2', 'l3') ORDER BY received_at DESC, id DESC`)).rows.map((row) => row.id);
    assert.deepEqual(orderAfter, orderBefore);
    const fullOrder = (await client.query(`SELECT id FROM leads ORDER BY received_at DESC, id DESC`)).rows.map((row) => row.id);
    assert.deepEqual(fullOrder, ['lg2', 'l3', 'l2', 'l1', 'l4', 'lg1']);

    // The listing index survived the type change and the purge index exists.
    const indexes = await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename IN ('leads', 'sessions')`, [schema]);
    const definition = (name: string) => indexes.rows.find((row) => row.indexname === name)?.indexdef as string | undefined;
    assert.match(definition('idx_leads_client_received_id') ?? '', /\(client_id, received_at DESC, id DESC\)/);
    assert.match(definition('idx_sessions_expires_at') ?? '', /\(expires_at\)/);

    // Native comparisons work with ISO strings bound as timestamptz.
    const expired = await client.query(`SELECT count(*)::int AS total FROM sessions WHERE expires_at <= $1::timestamptz`, ['2030-03-01T00:00:00.000Z']);
    assert.equal(expired.rows[0].total, 1);

    // Rerunning is a no-op: nothing is deleted, moved or converted a second time.
    await client.query(migration);
    assert.equal((await client.query(`SELECT count(*)::int AS total FROM sessions`)).rows[0].total, 2);
    assert.equal((await client.query(`SELECT count(*)::int AS total FROM leads`)).rows[0].total, 6);
    assert.equal((await client.query(`SELECT count(*)::int AS total FROM leads_received_at_fallbacks`)).rows[0].total, 2);
    assert.equal(await columnType('sessions', 'expires_at'), 'timestamp with time zone');
  } finally {
    try {
      await client.query('SET search_path TO DEFAULT');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      client.release();
      await closeCorePool();
    }
  }
});

test('the core pool reads a TIMESTAMPTZ column back as a fixed-width UTC ISO string in any session time zone', async () => {
  const { getCorePool, closeCorePool } = await import('../src/lib/corePool.js');
  const client = await getCorePool().connect();
  try {
    await client.query(`SET TIME ZONE 'Europe/Madrid'`);
    const { rows } = await client.query(`SELECT TIMESTAMPTZ '2024-07-01 12:00:00.123456+02' AS summer, $1::timestamptz AS param`, ['2030-01-01T00:00:03.007Z']);
    assert.deepEqual(rows[0], { summer: '2024-07-01T10:00:00.123Z', param: '2030-01-01T00:00:03.007Z' });
  } finally {
    try {
      await client.query('RESET TIME ZONE');
    } finally {
      client.release();
      await closeCorePool();
    }
  }
});
