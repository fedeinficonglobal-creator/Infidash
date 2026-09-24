import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidInclusiveDateRange } from '../src/lib/dateRange.js';

test('inclusive date range accepts exactly the configured maximum days', () => {
  assert.equal(isValidInclusiveDateRange('2026-09-01', '2026-10-01', 31), true);
  assert.equal(isValidInclusiveDateRange('2026-09-01', '2026-10-02', 31), false);
});

test('inclusive date range rejects reversed, malformed and impossible dates', () => {
  assert.equal(isValidInclusiveDateRange('2026-09-02', '2026-09-01', 31), false);
  assert.equal(isValidInclusiveDateRange('2026-02-31', '2026-03-01', 31), false);
  assert.equal(isValidInclusiveDateRange('2026/09/01', '2026-09-01', 31), false);
});
