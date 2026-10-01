import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('lead pagination reaches records beyond 200 and counts filtered rows without exposing raw payloads', async () => {
  const { createClient, getDatabase, listLeadsByClient } = await import('../src/lib/database.js');
  const client = await createClient({ name: `Leads paginados ${Date.now()}` });
  const values = Array.from({ length: 205 }, (_, index) =>
    `('${randomUUID()}', '${client.id}', 'WordPress', 'Lead ${index}', 'new', '{"private":"hidden"}', '2026-05-18T12:00:00.000Z', '2026-05-18T12:00:00.000Z', '2026-05-18T12:00:00.000Z')`
  ).join(',');
  getDatabase().exec(`INSERT INTO leads (id, client_id, source, name, status, raw_payload_json, received_at, created_at, updated_at) VALUES ${values}`);
  const page = await listLeadsByClient(client.id, { limit: 50, offset: 200, status: null, source: 'WordPress' });
  assert.equal(page.total, 205);
  assert.equal(page.openCount, 205);
  assert.equal(page.leads.length, 5);
  assert.ok(page.leads.every((lead) => !('rawPayload' in lead)));
  const firstPage = await listLeadsByClient(client.id, { limit: 50, offset: 0, status: null, source: 'WordPress' });
  assert.equal(new Set([...firstPage.leads, ...page.leads].map((lead) => lead.id)).size, 55);
});

test('lead delivery identity is atomically unique within an integration', async () => {
  const { createClient, deleteClientIntegration, insertLead, listLeadsByClient, saveClientIntegration } = await import('../src/lib/database.js');
  const client = await createClient({ name: `Lead entrega ${Date.now()}` });
  const integration = await saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { siteUrl: 'https://example.test' } });
  assert.ok(integration);
  const input = {
    clientId: client.id, integrationId: integration.id, source: 'WordPress', name: 'Ana',
    email: null, phone: null, message: null, rawPayload: { name: 'Ana' }, dedupeKey: 'same-delivery',
  };
  const first = await insertLead(input);
  const replay = await insertLead({ ...input, name: 'Cambio ignorado' });
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.lead.id, first.lead.id);
  assert.equal((await listLeadsByClient(client.id, { limit: 50, offset: 0, status: null, source: null })).total, 1);
  assert.equal(await deleteClientIntegration(integration.id), true, 'DML changes must report actual deleted rows');
});

test('RRSS channels and monthly KPIs round trip through the database layer', async () => {
  const {
    createClient,
    closeMonthlyKpi,
    listMonthlyKpiEvents,
    reopenMonthlyKpi,
    listMonthlyKpis,
    listRrssChannels,
    saveMonthlyKpi,
    saveRrssChannel,
  } = await import('../src/lib/database.js');

  const client = await createClient({
    name: `Cliente modelo ${Date.now()}`,
    industry: 'Servicios',
    healthScore: 75,
  });

  const channel = await saveRrssChannel({
    clientId: client.id,
    platformKey: 'instagram',
    label: 'Instagram',
    sortOrder: 1,
    isActive: true,
  });

  assert.equal(channel.clientId, client.id);
  assert.equal(channel.platformKey, 'instagram');
  assert.equal(channel.label, 'Instagram');
  assert.equal(channel.isActive, true);

  const channelList = await listRrssChannels(client.id);
  assert.equal(channelList.length, 1);
  assert.equal(channelList[0]?.id, channel.id);

  const kpi = await saveMonthlyKpi({
    clientId: client.id,
    departmentKey: 'rrss',
    metricKey: 'instagram_followers',
    monthKey: '2026-05',
    targetText: '500 seguidores',
    actualText: '480 seguidores',
    status: 'warning',
    notes: 'Cierre de ejemplo',
  });

  assert.equal(kpi.clientId, client.id);
  assert.equal(kpi.departmentKey, 'rrss');
  assert.equal(kpi.metricKey, 'instagram_followers');
  assert.equal(kpi.monthKey, '2026-05');
  assert.equal(kpi.status, 'warning');
  assert.equal(kpi.closedAt, null);

  const listBeforeClose = await listMonthlyKpis(client.id, '2026-05');
  assert.equal(listBeforeClose.length, 1);
  assert.equal(listBeforeClose[0]?.id, kpi.id);

  const closed = await closeMonthlyKpi(kpi.id);
  assert.equal(closed?.id, kpi.id);
  assert.ok(closed?.closedAt);
  assert.equal(closed?.status, 'warning');
  assert.equal((await closeMonthlyKpi(kpi.id))?.closedAt, closed?.closedAt, 'manual close must be idempotent');
  await assert.rejects(async () => saveMonthlyKpi({
    id: kpi.id, clientId: client.id, departmentKey: 'rrss', metricKey: 'instagram_followers',
    monthKey: '2026-05', actualText: '999 seguidores',
  }), /cerrado/i);
  const reopened = await reopenMonthlyKpi(kpi.id, 'admin-test', 'Corrección de datos');
  assert.equal(reopened?.closedAt, null);
  const events = await listMonthlyKpiEvents(kpi.id);
  assert.deepEqual(events.map((event) => event.action).sort(), ['closed', 'reopened']);
  assert.equal(events.find((event) => event.action === 'reopened')?.reason, 'Corrección de datos');
  assert.equal((await saveMonthlyKpi({
    id: kpi.id, clientId: client.id, departmentKey: 'rrss', metricKey: 'instagram_followers',
    monthKey: '2026-05', actualText: '500 seguidores',
  }))?.actualText, '500 seguidores');
});

test('Madrid day-25 cycle close catches up once, freezes values, prepares next month, and respects admin reopen', async () => {
  const {
    closeDueMonthlyKpiCycles, closeMonthlyKpiCycle, createClient, listMonthlyKpiCycles,
    listMonthlyKpis, reopenMonthlyKpiCycle, saveMonthlyKpi,
  } = await import('../src/lib/database.js');
  const client = await createClient({ name: `Ciclo KPI ${Date.now()}` });
  const row = await saveMonthlyKpi({
    clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-09',
    targetValue: 1000, actualValue: 900, status: 'warning', notes: 'Dato septiembre',
  });
  assert.ok(row);
  assert.equal((await closeDueMonthlyKpiCycles(new Date('2026-09-24T21:59:59.999Z'), client.id)).closed, 0);
  assert.equal((await closeDueMonthlyKpiCycles(new Date('2026-09-24T22:00:00.000Z'), client.id)).closed, 1);
  assert.equal((await listMonthlyKpis(client.id, '2026-09'))[0]?.closedAt !== null, true);
  const october = await listMonthlyKpis(client.id, '2026-10');
  assert.equal(october.length, 1);
  assert.equal(october[0]?.targetValue, 1000);
  assert.equal(october[0]?.actualValue, null);
  assert.equal(october[0]?.status, 'unknown');
  await assert.rejects(async () => saveMonthlyKpi({
    clientId: client.id, departmentKey: 'rrss', metricKey: 'followers', monthKey: '2026-09',
  }), /cerrado/i);
  assert.equal((await closeDueMonthlyKpiCycles(new Date('2026-09-25T10:00:00Z'), client.id)).closed, 0);
  assert.equal((await listMonthlyKpiCycles(client.id)).filter((cycle) => cycle.monthKey === '2026-09').length, 1);
  await reopenMonthlyKpiCycle(client.id, '2026-09', 'admin-test', 'Corrección de septiembre');
  assert.equal((await listMonthlyKpis(client.id, '2026-09'))[0]?.closedAt, null);
  assert.equal((await closeDueMonthlyKpiCycles(new Date('2026-09-26T10:00:00Z'), client.id)).closed, 0);
  assert.equal((await listMonthlyKpis(client.id, '2026-09'))[0]?.closedAt, null);
  await closeMonthlyKpiCycle(client.id, '2026-09', 'admin-test', new Date('2026-09-26T12:00:00Z'));
  assert.ok((await listMonthlyKpis(client.id, '2026-09'))[0]?.closedAt);
});
