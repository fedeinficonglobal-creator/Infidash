import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Concurrency guarantees of the pooled core data layer (audit plan W2.3).

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

test('parallel upserts of the same client and day never fail and leave exactly one row', async () => {
  const { createClient, listDailyStats, upsertDailyStat } = await loadDatabase();
  const client = await createClient({ name: `Concurrent upsert ${unique()}` });

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => upsertDailyStat({ clientId: client.id, statDate: '2024-09-01', revenue: index + 1 })),
  );

  assert.equal(new Set(results.map((stat) => stat?.id)).size, 1, 'every call resolves to the same row id');
  const rows = await listDailyStats(client.id);
  assert.equal(rows.length, 1);
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8].includes(rows[0].revenue), 'the surviving revenue comes from one of the writers');
});

test('parallel upserts only collide on the exact (client, stat_date) text', async () => {
  const { createClient, listDailyStats, upsertDailyStat } = await loadDatabase();
  const client = await createClient({ name: `Concurrent dates ${unique()}` });

  await Promise.all([
    upsertDailyStat({ clientId: client.id, statDate: '2024-01-31', revenue: 1 }),
    upsertDailyStat({ clientId: client.id, statDate: '2024-01-31', revenue: 2 }),
    upsertDailyStat({ clientId: client.id, statDate: '2024-01-31T00:00:00Z', revenue: 3 }),
    upsertDailyStat({ clientId: client.id, statDate: '2024-01-31T00:00:00Z', revenue: 4 }),
  ]);

  assert.deepEqual((await listDailyStats(client.id)).map((stat) => stat.statDate).sort(), ['2024-01-31', '2024-01-31T00:00:00Z']);
});

test('the grouped 30-day revenue window equals summing listDailyStats per client', async () => {
  const { createClient, listClientsWithRevenueWindow, listDailyStats, upsertDailyStat } = await loadDatabase();
  const { sumRevenueWindow } = await import('../src/lib/dashboardMetrics.js');
  const a = await createClient({ name: `Window A ${unique()}` });
  const b = await createClient({ name: `Window B ${unique()}` });
  const empty = await createClient({ name: `Window none ${unique()}` });
  for (const [client, statDate, revenue] of [
    [a, '2026-09-23', 0.1], [a, '2026-09-01', 20.25], [a, '2026-08-25', 5], [a, '2026-08-24', 1000], [a, '2026-09-24', 999],
    [a, '2026-09-23T00:00:00Z', 7], [b, '2026-09-10', 3.5],
  ] as const) {
    await upsertDailyStat({ clientId: client.id, statDate, revenue });
  }

  const rows = await listClientsWithRevenueWindow({ clientIds: [a.id, b.id, empty.id] }, '2026-09-23', 30);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(row.revenue30d, sumRevenueWindow(await listDailyStats(row.id), '2026-09-23', 30), row.name);
  }
  assert.equal(rows.find((row) => row.id === empty.id)?.revenue30d.count, 0);
});

test('parallel UX snapshot upserts for the same client and date never fail and leave exactly one row', async () => {
  const { createClient, listUxSnapshots, upsertUxSnapshot } = await loadDatabase();
  const client = await createClient({ name: `Concurrent UX ${unique()}` });

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => upsertUxSnapshot({ clientId: client.id, snapshotDate: '2026-05-01', sessions: index + 1 })),
  );

  assert.equal(new Set(results.map((snapshot) => snapshot?.id)).size, 1, 'every call resolves to the same row id');
  const rows = await listUxSnapshots(client.id);
  assert.equal(rows.length, 1);
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8].includes(rows[0].sessions), 'the surviving value comes from one of the writers');
});

test('parallel RRSS channel saves for the same key never fail and leave exactly one row', async () => {
  const { createClient, listRrssChannels, saveRrssChannel } = await loadDatabase();
  const client = await createClient({ name: `Concurrent RRSS ${unique()}` });

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => saveRrssChannel({ clientId: client.id, platformKey: 'instagram', label: 'IG', sortOrder: index })),
  );

  assert.equal(new Set(results.map((channel) => channel?.id)).size, 1, 'every call resolves to the same row id');
  assert.equal((await listRrssChannels(client.id)).length, 1);
});

test('parallel operational plan saves with the same version let exactly one writer win', async () => {
  const { createClient, getOperationalPlan, saveOperationalPlan } = await loadDatabase();
  const client = await createClient({ name: `Concurrent plan ${unique()}` });

  const created = await Promise.all(
    Array.from({ length: 6 }, (_, index) => saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-06', version: 0, rows: [{ id: `r${index}` }] as any[] })),
  );
  assert.equal(created.filter(Boolean).length, 1);
  assert.equal((await getOperationalPlan(client.id, 'web', '2026-06')).version, 1);

  const updated = await Promise.all(
    Array.from({ length: 6 }, (_, index) => saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-06', version: 1, rows: [{ id: `u${index}` }] as any[] })),
  );
  assert.equal(updated.filter(Boolean).length, 1);
  assert.equal((await getOperationalPlan(client.id, 'web', '2026-06')).version, 2);
});

test('parallel closeMonthlyKpiCycle of the same client and month closes once and writes one event per KPI', async () => {
  const { closeMonthlyKpiCycle, createClient, listMonthlyKpiEvents, listMonthlyKpis, saveMonthlyKpi } = await loadDatabase();
  const client = await createClient({ name: `Concurrent KPI close ${unique()}` });
  const first = await saveMonthlyKpi({ clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-03', targetValue: 10 });
  const second = await saveMonthlyKpi({ clientId: client.id, departmentKey: 'rrss', metricKey: 'followers', monthKey: '2026-03' });
  assert.ok(first && second);

  const cycles = await Promise.all([
    closeMonthlyKpiCycle(client.id, '2026-03', 'actor-a', new Date('2026-03-26T10:00:00.000Z')),
    closeMonthlyKpiCycle(client.id, '2026-03', 'actor-b', new Date('2026-03-26T11:00:00.000Z')),
    closeMonthlyKpiCycle(client.id, '2026-03', 'actor-c', new Date('2026-03-26T12:00:00.000Z')),
  ]);

  assert.ok(cycles.every((cycle) => cycle !== null));
  const winner = cycles[0]!;
  assert.ok(['actor-a', 'actor-b', 'actor-c'].includes(winner.closedByUserId ?? ''));
  assert.ok(cycles.every((cycle) => cycle!.closedAt === winner.closedAt && cycle!.closedByUserId === winner.closedByUserId), 'every caller sees the one close that won');

  for (const kpi of [first, second]) {
    const events = await listMonthlyKpiEvents(kpi.id);
    assert.equal(events.length, 1, 'exactly one closed event per KPI');
    assert.equal(events[0].action, 'closed');
    assert.equal(events[0].actor_user_id, winner.closedByUserId);
  }
  assert.ok((await listMonthlyKpis(client.id, '2026-03')).every((kpi) => kpi.closedAt === winner.closedAt));
  assert.equal((await listMonthlyKpis(client.id, '2026-04')).length, 2, 'next month is prepared exactly once per metric');
});
