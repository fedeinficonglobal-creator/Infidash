import { UserFacingError } from './userFacingError.js';

export const INVALID_STAT_DATE_MESSAGE = 'La fecha debe tener el formato AAAA-MM-DD';

/**
 * True only for a real calendar day written exactly as YYYY-MM-DD (year 0001-9999). Rejects other spellings of the
 * same day (timestamps, surrounding whitespace, slashes) and impossible days such as 2024-02-30.
 */
export function isCanonicalStatDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one. Date.UTC maps years 0-99 to 1900-1999, hence the setUTCFullYear.
  const probe = new Date(Date.UTC(2000, month, 0));
  probe.setUTCFullYear(year, month, 0);
  return day <= probe.getUTCDate();
}

export function assertCanonicalStatDate(value: unknown): string {
  if (!isCanonicalStatDate(value)) throw new UserFacingError(INVALID_STAT_DATE_MESSAGE);
  return value;
}
