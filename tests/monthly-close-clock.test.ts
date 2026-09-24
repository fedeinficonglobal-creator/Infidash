import assert from 'node:assert/strict';
import test from 'node:test';
import { dueMonthlyKpiMonth, nextMadridCloseInstant, nextMonthKey } from '../src/lib/monthlyCloseClock.js';

test('Madrid close starts at local midnight on the 25th, including winter and summer offsets', () => {
  assert.equal(dueMonthlyKpiMonth(new Date('2026-03-24T22:59:59.999Z')), '2026-02');
  assert.equal(dueMonthlyKpiMonth(new Date('2026-03-24T23:00:00.000Z')), '2026-03');
  assert.equal(dueMonthlyKpiMonth(new Date('2026-06-24T21:59:59.999Z')), '2026-05');
  assert.equal(dueMonthlyKpiMonth(new Date('2026-06-24T22:00:00.000Z')), '2026-06');
});

test('the next Madrid cutover handles DST and year boundaries', () => {
  assert.equal(nextMadridCloseInstant(new Date('2026-10-24T00:00:00Z')).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(nextMadridCloseInstant(new Date('2026-12-25T00:00:00Z')).toISOString(), '2027-01-24T23:00:00.000Z');
  assert.equal(nextMonthKey('2026-12'), '2027-01');
});
