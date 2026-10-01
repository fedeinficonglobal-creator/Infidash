import test from 'node:test';
import assert from 'node:assert/strict';
import type { CoreQueryable } from '../src/lib/corePool.js';
import { listClientsWithRevenueWindow, upsertDailyStat } from '../src/lib/database.js';
import { UserFacingError } from '../src/lib/userFacingError.js';

// Unit tests (no PostgreSQL needed) for the pooled clients/daily-stats queries. They drive the data layer with a
// fake CoreQueryable that answers by SQL shape and records every call.

function clientRow(index: number) {
  return {
    id: `client-${index}`,
    name: `Client ${String(index).padStart(3, '0')}`,
    slug: `client-${index}`,
    logo_url: null,
    industry: null,
    health_score: 80,
    kpi_thresholds_json: '{}',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function statRow(index: number, statDate: string) {
  return {
    id: `stat-${index}`,
    client_id: `client-${index}`,
    stat_date: statDate,
    revenue: 10,
    roas: 0,
    clicks: 0,
    conversions: 0,
    cpa: 0,
    leads: 0,
    traffic: 0,
    notes: null,
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function fakeCore(clientCount: number) {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const db: CoreQueryable = {
    async query(text, values) {
      calls.push({ text, values });
      if (/array_agg/i.test(text)) {
        return {
          rows: Array.from({ length: clientCount }, (_, index) => ({ client_id: `client-${index}`, revenues: [1.5, 2.5] })),
          rowCount: clientCount,
        };
      }
      if (/FROM daily_stats/i.test(text)) {
        return { rows: Array.from({ length: clientCount }, (_, index) => statRow(index, '2026-09-20')), rowCount: clientCount };
      }
      if (/FROM clients/i.test(text)) {
        return { rows: Array.from({ length: clientCount }, (_, index) => clientRow(index)), rowCount: clientCount };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, calls };
}

test('the clients overview issues a constant number of queries regardless of how many clients exist', async () => {
  const counts: number[] = [];
  for (const clientCount of [0, 1, 5, 60]) {
    const { db, calls } = fakeCore(clientCount);
    const clients = await listClientsWithRevenueWindow({ clientIds: undefined }, '2026-09-23', 30, db);
    assert.equal(clients.length, clientCount);
    counts.push(calls.length);
  }
  assert.deepEqual(counts, [counts[0], counts[0], counts[0], counts[0]]);
  assert.ok(counts[0] <= 3, `expected at most 3 queries, got ${counts[0]}`);
});

test('the clients overview keeps the response shape: client fields, latestStat and the revenue30d window', async () => {
  const { db } = fakeCore(2);
  const clients = await listClientsWithRevenueWindow({}, '2026-09-23', 30, db);
  assert.deepEqual(Object.keys(clients[0]).sort(), [
    'createdAt', 'healthScore', 'id', 'industry', 'kpiThresholds', 'latestStat', 'logoUrl', 'name', 'revenue30d', 'slug', 'updatedAt',
  ]);
  assert.deepEqual(clients[0].revenue30d, { total: 4, count: 2, startDate: '2026-08-25', endDate: '2026-09-23' });
  assert.equal(clients[0].latestStat?.statDate, '2026-09-20');
});

test('a client without stats in the window gets an explicit zero window and a null latestStat', async () => {
  const db: CoreQueryable = {
    async query(text) {
      if (/array_agg/i.test(text) || /FROM daily_stats/i.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [clientRow(1)], rowCount: 1 };
    },
  };
  const [client] = await listClientsWithRevenueWindow({}, '2026-09-23', 30, db);
  assert.equal(client.latestStat, null);
  assert.deepEqual(client.revenue30d, { total: 0, count: 0, startDate: '2026-08-25', endDate: '2026-09-23' });
});

test('scope ids and window bounds are bound as parameters, never inlined into the SQL text', async () => {
  const { db, calls } = fakeCore(1);
  const hostile = `x') OR 1=1 --`;
  await listClientsWithRevenueWindow({ clientIds: [hostile] }, '2026-09-23', 30, db);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok(!call.text.includes(hostile), call.text);
    assert.ok(call.values?.some((value) => Array.isArray(value) && value.includes(hostile)), call.text);
  }
  const windowCall = calls.find((call) => /array_agg/i.test(call.text));
  assert.ok(windowCall);
  assert.ok(windowCall.values?.includes('2026-08-25') && windowCall.values?.includes('2026-09-23'));
  assert.match(windowCall.text, /GROUP BY client_id/i);
  // stat_date is a native DATE: the window compares as dates, with no text collation left.
  assert.match(windowCall.text, /stat_date >= \$1::date AND stat_date <= \$2::date/);
  assert.doesNotMatch(windowCall.text, /COLLATE/i);
});

test('upsertDailyStat is one atomic INSERT ... ON CONFLICT statement, not a select followed by insert/update', async () => {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const db: CoreQueryable = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [statRow(1, '2024-01-31')], rowCount: 1 };
    },
  };
  const stat = await upsertDailyStat({ clientId: 'client-1', statDate: '2024-01-31', revenue: Number.NaN, clicks: 12.7 }, db);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO daily_stats/i);
  assert.match(calls[0].text, /ON CONFLICT \(client_id, stat_date\) DO UPDATE/i);
  assert.match(calls[0].text, /RETURNING \*/i);
  assert.equal(stat?.statDate, '2024-01-31');
  // Non-finite numbers are bound as NULL (the old inliner did the same), so NOT NULL still rejects them.
  assert.ok(calls[0].values?.includes(null));
  assert.ok(!calls[0].values?.some((value) => typeof value === 'number' && Number.isNaN(value)));
});

test('upsertDailyStat rejects non-canonical dates before touching the database and binds the date as ::date', async () => {
  const calls: unknown[] = [];
  const db: CoreQueryable = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [statRow(1, '2024-01-31')], rowCount: 1 };
    },
  };
  for (const statDate of ['2024-02-30', 'not-a-date', '2024-01-31T00:00:00Z', ' 2024-01-31', '', '31/01/2024']) {
    await assert.rejects(
      () => upsertDailyStat({ clientId: 'client-1', statDate }, db),
      (error: unknown) => error instanceof UserFacingError && error.message === 'La fecha debe tener el formato AAAA-MM-DD',
      statDate,
    );
  }
  assert.equal(calls.length, 0);
  await upsertDailyStat({ clientId: 'client-1', statDate: '2024-01-31' }, db);
  assert.match((calls[0] as { text: string }).text, /VALUES \(\$1, \$2, \$3::date,/);
});
