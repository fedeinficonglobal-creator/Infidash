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
