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
      assert.equal(actual.get(`${table}.${column}`), dataType, `${table}.${column}`);
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
    const registry = await pool.query(`SELECT version FROM public.schema_migrations WHERE version IN ('0004_core_baseline.sql', '0005_core_drop_ai_insights.sql')`);
    assert.equal(registry.rows.length, 2);
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
