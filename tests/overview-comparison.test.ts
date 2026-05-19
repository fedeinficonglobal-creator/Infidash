import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildComparisonPeriod } from '../src/lib/overviewComparison.js';

function makeStat(statDate: string, seed: number) {
  return {
    id: `stat-${statDate}`,
    clientId: 'client-1',
    statDate,
    revenue: seed * 100,
    roas: seed / 2,
    clicks: seed * 10,
    conversions: seed * 3,
    cpa: seed * 5,
    leads: seed * 8,
    traffic: seed * 100,
    notes: null,
    source: 'manual',
    createdAt: `${statDate}T08:00:00.000Z`,
    updatedAt: `${statDate}T08:00:00.000Z`,
  } as any;
}

test('buildComparisonPeriod compares the latest window with the previous one', () => {
  const stats = Array.from({ length: 14 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return makeStat(`2026-01-${day}`, index + 1);
  });

  const comparison = buildComparisonPeriod(stats, 7);
  assert.ok(comparison);
  assert.equal(comparison?.currentCount, 7);
  assert.equal(comparison?.previousCount, 7);

  const currentRevenue = stats.slice(-7).reduce((sum, stat) => sum + stat.revenue, 0);
  const previousRevenue = stats.slice(-14, -7).reduce((sum, stat) => sum + stat.revenue, 0);
  assert.equal(comparison?.metrics[0].current, currentRevenue);
  assert.equal(comparison?.metrics[0].previous, previousRevenue);
  assert.ok((comparison?.metrics[0].percentDelta ?? 0) > 0);

  const currentRoas = stats.slice(-7).reduce((sum, stat) => sum + stat.roas, 0) / 7;
  assert.equal(comparison?.metrics[1].current, currentRoas);
});

test('buildComparisonPeriod returns partial windows when there is not enough data', () => {
  const stats = [makeStat('2026-01-01', 1), makeStat('2026-01-02', 2), makeStat('2026-01-03', 3)];
  const comparison = buildComparisonPeriod(stats, 7);

  assert.ok(comparison);
  assert.equal(comparison?.currentCount, 3);
  assert.equal(comparison?.previousCount, 0);
  assert.equal(comparison?.metrics[0].percentDelta, null);
});
