import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClient,
  closeMonthlyKpi,
  listMonthlyKpis,
  listRrssChannels,
  saveMonthlyKpi,
  saveRrssChannel,
} from '../src/lib/database.js';

test('RRSS channels and monthly KPIs round trip through the database layer', () => {
  const client = createClient({
    name: `Cliente modelo ${Date.now()}`,
    industry: 'Servicios',
    healthScore: 75,
  });

  const channel = saveRrssChannel({
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

  const channelList = listRrssChannels(client.id);
  assert.equal(channelList.length, 1);
  assert.equal(channelList[0]?.id, channel.id);

  const kpi = saveMonthlyKpi({
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

  const listBeforeClose = listMonthlyKpis(client.id, '2026-05');
  assert.equal(listBeforeClose.length, 1);
  assert.equal(listBeforeClose[0]?.id, kpi.id);

  const closed = closeMonthlyKpi(kpi.id);
  assert.equal(closed?.id, kpi.id);
  assert.ok(closed?.closedAt);
  assert.equal(closed?.status, 'warning');
});
