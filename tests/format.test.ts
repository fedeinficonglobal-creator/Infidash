import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCurrency,
  formatDateTime,
  formatDecimal,
  formatInteger,
  formatMoney,
  formatMonthName,
  formatMonthYear,
  formatNumber,
  formatStatDate,
} from '../src/lib/format.js';

// Reference implementations: verbatim copies of the helpers that used to live in the components.
const refUtilsCurrency = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
const refUtilsNumber = (v: number) => new Intl.NumberFormat('es-ES').format(v);
const refMoney0 = (v: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
const refDecimal1 = (v: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
const refDecimalN = (v: number, n: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: n, maximumFractionDigits: n }).format(v);
const refInteger = (v: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(v);
const refAdsCost = (v: number, code: string) => v.toLocaleString('es-ES', { style: 'currency', currency: code || 'EUR' });
const refOverviewDate = (s: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(`${s}T00:00:00`));
const refReportsDate = (s: string) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${s}T00:00:00`));
const refMediumShort = (v: string) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
const refCompact = (v: string) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
const refDefault = (v: string) => new Date(v).toLocaleString('es-ES');

const numbers = [0, -0, 1, -1, 7, 999, 1000, 1234, 12345.678, -4321.5, 0.5, 0.05, 1234567.891, 1e9, 2.45, 2.55, NaN, Infinity, -Infinity];
const loose = [null, undefined, '', '12'] as unknown as number[];

test('formatCurrency keeps the EUR default (two decimals) and the zero-decimals option', () => {
  for (const v of [...numbers, ...loose]) {
    assert.equal(formatCurrency(v), refUtilsCurrency(v), String(v));
    assert.equal(formatCurrency(v, 'EUR', { maximumFractionDigits: 0 }), refMoney0(v), String(v));
    assert.equal(formatMoney(v), refMoney0(v), String(v));
  }
});

test('formatCurrency honours another currency code', () => {
  for (const code of ['USD', 'GBP', 'MXN', 'EUR']) {
    for (const v of [0, 12.5, -3, 1234567.891, NaN]) {
      assert.equal(formatCurrency(v, code), refAdsCost(v, code));
    }
  }
});

test('formatNumber, formatInteger and formatDecimal match the original helpers', () => {
  for (const v of [...numbers, ...loose]) {
    assert.equal(formatNumber(v), refUtilsNumber(v), String(v));
    assert.equal(formatInteger(v), refInteger(v), String(v));
    assert.equal(formatDecimal(v), refDecimal1(v), String(v));
    assert.equal(formatDecimal(v, 2), refDecimalN(v, 2), String(v));
    assert.equal(formatDecimal(v, 0), refDecimalN(v, 0), String(v));
  }
});

test('a few concrete es-ES outputs are pinned', () => {
  assert.equal(formatInteger(1234567), '1.234.567');
  assert.equal(formatDecimal(3.456), '3,5');
  assert.equal(formatCurrency(1500.5, 'EUR', { maximumFractionDigits: 0 }), '1501 €');
  assert.equal(formatInteger(NaN), 'NaN');
  assert.equal(formatInteger(null as unknown as number), '0');
});

test('formatStatDate matches the Overview (short) and Reports (long) date helpers', () => {
  for (const s of ['2026-01-05', '2026-12-31', '2024-02-29', '2026-09-01']) {
    assert.equal(formatStatDate(s, 'short'), refOverviewDate(s));
    assert.equal(formatStatDate(s, 'long'), refReportsDate(s));
  }
  assert.throws(() => refOverviewDate('nope'), RangeError);
  assert.throws(() => formatStatDate('nope', 'short'), RangeError);
  assert.throws(() => formatStatDate('nope', 'long'), RangeError);
});

test('formatDateTime matches the three original date-time renderings', () => {
  for (const v of ['2026-03-04T10:15:00Z', '2026-12-31T23:59:59.999Z', '2026-07-01T00:00:00+02:00']) {
    assert.equal(formatDateTime(v, 'medium'), refMediumShort(v));
    assert.equal(formatDateTime(v, 'compact'), refCompact(v));
    assert.equal(formatDateTime(v), refDefault(v));
  }
  assert.equal(formatDateTime('garbage'), refDefault('garbage'));
  assert.throws(() => refMediumShort('garbage'), RangeError);
  assert.throws(() => formatDateTime('garbage', 'medium'), RangeError);
  assert.throws(() => formatDateTime('garbage', 'compact'), RangeError);
});

test('formatMonthYear and formatMonthName match the original month labels', () => {
  for (const key of ['2026-01', '2026-02', '2026-12']) {
    const date = new Date(`${key}-01T12:00:00`);
    assert.equal(formatMonthYear(date), new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date));
    assert.equal(formatMonthName(date), new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date));
  }
});
