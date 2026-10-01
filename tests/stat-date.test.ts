import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanonicalStatDate, INVALID_STAT_DATE_MESSAGE, isCanonicalStatDate } from '../src/lib/statDate.js';
import { UserFacingError } from '../src/lib/userFacingError.js';

test('isCanonicalStatDate accepts real calendar days written as YYYY-MM-DD', () => {
  for (const value of ['2024-01-31', '2024-02-29', '2000-02-29', '2023-12-31', '0001-01-01', '9999-12-31', '0004-02-29']) {
    assert.equal(isCanonicalStatDate(value), true, value);
  }
});

test('isCanonicalStatDate rejects impossible days, other spellings and non-strings', () => {
  const rejected: unknown[] = [
    '2024-02-30', '2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-10', '2024-01-00', '0000-01-01',
    'not-a-date', '', ' 2024-01-31', '2024-01-31 ', '2024-01-31T00:00:00Z', '2024-01-31T00:00:00', '2024-1-5', '24-01-31',
    '2024/01/31', '31/01/2024', '20240131', '+2024-01-31', '2024-01-31\n',
    null, undefined, 20240131, new Date('2024-01-31'), {},
  ];
  for (const value of rejected) {
    assert.equal(isCanonicalStatDate(value), false, String(value));
  }
});

test('assertCanonicalStatDate returns the date or throws the Spanish user-facing message', () => {
  assert.equal(assertCanonicalStatDate('2024-02-29'), '2024-02-29');
  assert.throws(() => assertCanonicalStatDate('2024-02-30'), (error: unknown) => error instanceof UserFacingError && error.message === INVALID_STAT_DATE_MESSAGE);
  assert.equal(INVALID_STAT_DATE_MESSAGE, 'La fecha debe tener el formato AAAA-MM-DD');
});
