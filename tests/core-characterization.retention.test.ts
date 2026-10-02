import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreSqlAll, coreSqlGet, coreSqlRun } from './helpers/coreSql.js';
import { getCorePool, withCoreTransaction } from '../src/lib/corePool.js';
import { computeLeadsCutoffs, purgeLeads } from '../src/lib/leadsRetention.js';
import { eraseLeadsByEmail, findLeadIdsByEmail } from '../src/lib/leadErasure.js';

// Data retention (docs/gdpr-retention.md): lead purge, lead erasure and client deletion, against a real PostgreSQL.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

async function makeClient(label: string) {
  const { createClient } = await loadDatabase();
  return await createClient({ name: `${label} ${unique()}` });
}

async function seedLead(clientId: string, email: string, ageDays: number, rawPayload: Record<string, unknown> = { field: 'value' }) {
  const { insertLead } = await loadDatabase();
  const { lead } = await insertLead({
    clientId, integrationId: null, source: 'WordPress', name: 'Test Person', email, phone: '600000000', message: 'hola', rawPayload,
  });
  await coreSqlRun(`UPDATE leads SET received_at = $1::timestamptz WHERE id = $2`, [new Date(Date.now() - ageDays * DAY_MS).toISOString(), lead.id]);
  return lead.id;
}

async function leadRow(id: string) {
  return coreSqlGet<{ id: string; raw_payload_json: string }>(`SELECT id, raw_payload_json FROM leads WHERE id = $1`, [id]);
}

test('purgeLeads deletes only leads older than the retention and blanks only old raw payloads', async () => {
  const client = await makeClient('Retention purge');
  const expired = await seedLead(client.id, 'old@example.test', 800);
  const old = await seedLead(client.id, 'mid@example.test', 200);
  const recent = await seedLead(client.id, 'new@example.test', 5);
  const alreadyBlank = await seedLead(client.id, 'blank@example.test', 200, {});

  const cutoffs = computeLeadsCutoffs(new Date(), { retentionMonths: 24, rawPayloadDays: 90 });
  const result = await purgeLeads(getCorePool(), cutoffs, 2);

  // The database is shared with other suites: other expired rows may exist, ours are at least counted.
  assert.ok(result.deleted >= 1);
  assert.ok(result.payloadsBlanked >= 1);
  assert.equal(await leadRow(expired), undefined);
  assert.equal((await leadRow(old))?.raw_payload_json, '{}');
  assert.equal((await leadRow(recent))?.raw_payload_json, JSON.stringify({ field: 'value' }));
  assert.equal((await leadRow(alreadyBlank))?.raw_payload_json, '{}');

  // Structured columns of a blanked lead are kept until the lead itself expires.
  const kept = await coreSqlGet<{ email: string }>(`SELECT email FROM leads WHERE id = $1`, [old]);
  assert.equal(kept?.email, 'mid@example.test');

  // Idempotent: a second run finds nothing of ours to do.
  const again = await purgeLeads(getCorePool(), cutoffs, 2);
  assert.equal(again.deleted, 0);
  assert.equal(again.payloadsBlanked, 0);
});

test('leads erasure is case-insensitive, exact, atomic and can be scoped to a client', async () => {
  const clientA = await makeClient('Erasure A');
  const clientB = await makeClient('Erasure B');
  const tag = unique();
  const email = `Erase.${tag}@Example.test`;
  const a1 = await seedLead(clientA.id, email, 1);
  const a2 = await seedLead(clientA.id, `erase.${tag}@example.test`, 2);
  const b1 = await seedLead(clientB.id, email, 1);
  const other = await seedLead(clientA.id, `erase.${tag}.other@example.test`, 1);
  const normalized = `erase.${tag}@example.test`;

  assert.deepEqual((await findLeadIdsByEmail(getCorePool(), normalized, null)).sort(), [a1, a2, b1].sort());
  assert.deepEqual((await findLeadIdsByEmail(getCorePool(), normalized, clientB.id)), [b1]);
  assert.ok(await leadRow(a1), 'a dry run deletes nothing');

  const scoped = await withCoreTransaction((tx) => eraseLeadsByEmail(tx, normalized, clientA.id));
  assert.deepEqual(scoped.sort(), [a1, a2].sort());
  assert.ok(await leadRow(b1));
  assert.ok(await leadRow(other));

  const rest = await withCoreTransaction((tx) => eraseLeadsByEmail(tx, normalized, null));
  assert.deepEqual(rest, [b1]);
  assert.equal(await leadRow(b1), undefined);
  assert.ok(await leadRow(other));
});

async function countFor(table: string, clientId: string) {
  const row = await coreSqlGet<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE client_id = $1`, [clientId]);
  return Number(row?.n ?? 0);
}

test('deleteClient removes every internal record of the client (core and editorial) and leaves other clients alone', async () => {
  const { deleteClient, saveClientIntegration, upsertDailyStat } = await loadDatabase();
  const { runEditorialMigrations } = await import('../src/server/content/migrations.js');
  await coreSqlRun('SELECT 1'); // wait for the core schema bootstrap
  await runEditorialMigrations(getCorePool());

  const client = await makeClient('Delete me');
  const bystander = await makeClient('Bystander');
  const bystanderLead = await seedLead(bystander.id, `bystander-${unique()}@example.test`, 1);

  const integration = await saveClientIntegration({
    clientId: client.id, provider: 'wordpress',
    config: { siteUrl: `https://wp-${unique()}.example.test` },
    credentials: { username: 'api-user', applicationPassword: `pw-${unique()}` },
  });
  assert.ok(integration);
  await seedLead(client.id, `delete-${unique()}@example.test`, 1);
  await upsertDailyStat({ clientId: client.id, statDate: '2026-01-15', revenue: 10 });
  await coreSqlRun(
    `INSERT INTO ga4_snapshots (integration_id, property_id, period_from, period_to, sessions_json, traffic_sources_json, top_pages_json, landing_pages_json, synced_at)
     VALUES ($1, 'p1', '2026-01-01', '2026-01-31', '[]', '[]', '[]', '[]', '2026-02-01T00:00:00.000Z')`,
    [integration.id],
  );
  const kpiId = `kpi-${unique()}`;
  await coreSqlRun(
    `INSERT INTO monthly_kpis (id, client_id, department_key, metric_key, month_key, created_at, updated_at)
     VALUES ($1, $2, 'web', 'visits', '2026-01', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
    [kpiId, client.id],
  );
  await coreSqlRun(
    `INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, occurred_at, snapshot_json)
     VALUES ($1, $2, $3, '2026-01', 'closed', '2026-02-01T00:00:00.000Z', '{}')`,
    [`evt-${unique()}`, kpiId, client.id],
  );
  await coreSqlRun(
    `INSERT INTO report_runs (id, client_id, from_date, to_date, generated_at, pdf_base64, bytes)
     VALUES ($1, $2, '2026-01-01', '2026-01-31', '2026-02-01T00:00:00.000Z', 'AAAA', 4)`,
    [`rep-${unique()}`, client.id],
  );

  // Editorial rows, including the ON DELETE RESTRICT chains (contents -> plan_items, publications -> accounts/revisions).
  const cid = client.id;
  await coreSqlRun(`INSERT INTO editorial.client_settings (client_id) VALUES ($1)`, [cid]);
  const calendar = await coreSqlGet<{ id: string }>(`INSERT INTO editorial.calendars (id, client_id, title) VALUES (gen_random_uuid(), $1, 'Cal') RETURNING id`, [cid]);
  const planItem = await coreSqlGet<{ id: string }>(
    `INSERT INTO editorial.plan_items (id, client_id, calendar_id, title) VALUES (gen_random_uuid(), $1, $2, 'Item') RETURNING id`, [cid, calendar!.id]);
  const content = await coreSqlGet<{ id: string }>(
    `INSERT INTO editorial.contents (id, client_id, plan_item_id, title) VALUES (gen_random_uuid(), $1, $2, 'Post') RETURNING id`, [cid, planItem!.id]);
  const revision = await coreSqlGet<{ id: string }>(
    `INSERT INTO editorial.content_revisions (id, client_id, content_id, revision_number, content_snapshot, author_type)
     VALUES (gen_random_uuid(), $1, $2, 1, '{}'::jsonb, 'system') RETURNING id`, [cid, content!.id]);
  await coreSqlRun(`UPDATE editorial.contents SET approved_revision_id = $1 WHERE id = $2`, [revision!.id, content!.id]);
  const account = await coreSqlGet<{ id: string }>(
    `INSERT INTO editorial.publishing_accounts (id, client_id, provider, instance_key, platform, label)
     VALUES (gen_random_uuid(), $1, 'postiz', 'inst-facebook', 'blog', 'FB') RETURNING id`, [cid]);
  const publication = await coreSqlGet<{ id: string }>(
    `INSERT INTO editorial.publications (id, client_id, content_id, account_id, content_revision_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`, [cid, content!.id, account!.id, revision!.id]);
  await coreSqlRun(
    `INSERT INTO editorial.social_posts (id, client_id, plan_item_id, account_id, network, copy, publication_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'facebook', 'copy', $4)`, [cid, planItem!.id, account!.id, publication!.id]);
  await coreSqlRun(
    `INSERT INTO editorial.jobs (id, client_id, kind, idempotency_key, request_hash) VALUES (gen_random_uuid(), $1, 'publish', $2, 'h')`, [cid, `k-${unique()}`]);
  await coreSqlRun(
    `INSERT INTO editorial.events (id, client_id, entity_type, event_type, occurred_at) VALUES (gen_random_uuid(), $1, 'content', 't', now())`, [cid]);
  await coreSqlRun(
    `INSERT INTO editorial.research_snapshots (id, client_id, source, fetched_at, payload) VALUES (gen_random_uuid(), $1, 's', now(), '{}'::jsonb)`, [cid]);

  assert.equal(await deleteClient(client.id), true);

  const coreTables = ['integrations', 'leads', 'daily_stats', 'monthly_kpis', 'monthly_kpi_events', 'report_runs', 'client_memberships', 'rrss_channels', 'ux_snapshots', 'operational_plans', 'monthly_kpi_cycles'];
  for (const table of coreTables) assert.equal(await countFor(table, client.id), 0, `public.${table}`);
  const orphanSnapshots = await coreSqlGet<{ n: string }>(`SELECT count(*)::text AS n FROM ga4_snapshots WHERE integration_id = $1`, [integration.id]);
  assert.equal(orphanSnapshots?.n, '0');

  const editorialTables = ['client_settings', 'calendars', 'plan_items', 'contents', 'content_revisions', 'publishing_accounts', 'publications', 'social_posts', 'jobs', 'events', 'research_snapshots', 'legacy_mappings'];
  for (const table of editorialTables) assert.equal(await countFor(`editorial.${table}`, client.id), 0, `editorial.${table}`);
  assert.equal((await coreSqlAll(`SELECT 1 FROM clients WHERE id = $1`, [client.id])).length, 0);

  assert.ok(await leadRow(bystanderLead), 'another client is untouched');
  assert.equal(await deleteClient(client.id), false);
});
