// Shared es-ES formatting helpers for the frontend. Each one reproduces, character for character, the
// output of the ad-hoc helper it replaced (see tests/format.test.ts). They pass values straight to Intl,
// so null/NaN/invalid input behaves exactly as before; callers own their own fallback text ('Sin datos', ...).

const LOCALE = 'es-ES';

type NumberFormatOptions = Omit<Intl.NumberFormatOptions, 'style' | 'currency'>;

/** Currency amount. Pass `{ maximumFractionDigits: 0 }` for whole-euro figures. */
export function formatCurrency(value: number, currency = 'EUR', options: NumberFormatOptions = {}) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, ...options }).format(value);
}

/** Plain number with Intl's default fraction digits (up to 3). */
export function formatNumber(value: number, options?: NumberFormatOptions) {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** Whole-euro amount, e.g. "1.235 €". */
export function formatMoney(value: number) {
  return formatCurrency(value, 'EUR', { maximumFractionDigits: 0 });
}

/** Number rounded to a whole value. */
export function formatInteger(value: number) {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** Number with a fixed count of fraction digits (default one, e.g. ROAS "3,5"). */
export function formatDecimal(value: number, fractionDigits = 1) {
  return formatNumber(value, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

/** Local-midnight date from a `YYYY-MM-DD` stat date; "short" is "5 ene", "long" is "05 ene 2026". Throws RangeError on bad input. */
export function formatStatDate(statDate: string, style: 'short' | 'long') {
  const options: Intl.DateTimeFormatOptions =
    style === 'short' ? { day: 'numeric', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(LOCALE, options).format(new Date(`${statDate}T00:00:00`));
}

/**
 * Date and time from an ISO string. "medium" = dateStyle medium + timeStyle short, "compact" = 2-digit day/hour/minute,
 * "default" = Date#toLocaleString. "medium" and "compact" throw RangeError on an invalid date; "default" returns "Invalid Date".
 */
export function formatDateTime(value: string | number | Date, style: 'default' | 'medium' | 'compact' = 'default') {
  const date = new Date(value);
  if (style === 'default') return date.toLocaleString(LOCALE);
  const options: Intl.DateTimeFormatOptions =
    style === 'medium'
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(LOCALE, options).format(date);
}

/** "enero de 2026". */
export function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(date);
}

/** "enero". */
export function formatMonthName(date: Date) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(date);
}
