import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateMonthlyKpiComparison, shouldCloseMonthlyKpis } from '../src/lib/kpiThresholds.js';

test('monthly KPI comparison marks success, warning, fail and computes deltas', () => {
  const success = evaluateMonthlyKpiComparison(10, 5, 4);
  assert.equal(success.status, 'success');
  assert.equal(success.difference, 5);
  assert.equal(success.differencePct, 150);

  const warning = evaluateMonthlyKpiComparison(8, 10, 6);
  assert.equal(warning.status, 'warning');
  assert.equal(warning.difference, -2);
  assert.equal(Math.round((warning.differencePct ?? 0) * 10) / 10, 33.3);

  const fail = evaluateMonthlyKpiComparison(3, 10, 4);
  assert.equal(fail.status, 'fail');
  assert.equal(fail.difference, -7);
  assert.equal(fail.differencePct, -25);
});

test('monthly KPI comparison returns unknown when there is no valid target', () => {
  const unknown = evaluateMonthlyKpiComparison(10, 0, null);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.difference, 10);
  assert.equal(unknown.differencePct, null);
});

test('monthly close day is the 25th', () => {
  assert.equal(shouldCloseMonthlyKpis(new Date('2026-05-25T10:00:00Z')), true);
  assert.equal(shouldCloseMonthlyKpis(new Date('2026-05-24T10:00:00Z')), false);
});
