import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDailyStatsSummary, getHealthLabel, sumRevenueWindow } from '../src/lib/dashboardMetrics.js';

test('agency dashboard distinguishes an unavailable summary from an empty database', () => {
  assert.equal(formatDailyStatsSummary({ loading: true, count: null }), 'Cargando métricas…');
  assert.equal(formatDailyStatsSummary({ loading: false, count: null }), 'No se pudo cargar el resumen de métricas.');
  assert.equal(formatDailyStatsSummary({ loading: false, count: 0 }), 'Aún no hay métricas diarias registradas.');
  assert.equal(formatDailyStatsSummary({ loading: false, count: 12 }), 'Se registraron 12 métricas diarias en la base.');
});

test('agency health summary does not label every portfolio as stable', () => {
  assert.equal(getHealthLabel(90), 'Excelente');
  assert.equal(getHealthLabel(70), 'Estable');
  assert.equal(getHealthLabel(50), 'En riesgo');
  assert.equal(getHealthLabel(20), 'Crítico');
  assert.equal(getHealthLabel(null), 'Sin datos');
});

test('30-day revenue sums only dates in the inclusive UTC window', () => {
  const result = sumRevenueWindow([
    { statDate: '2026-08-24', revenue: 100 },
    { statDate: '2026-08-25', revenue: 25 },
    { statDate: '2026-09-23', revenue: 75 },
    { statDate: '2026-09-24', revenue: 500 },
  ], '2026-09-23');
  assert.deepEqual(result, { total: 100, count: 2, startDate: '2026-08-25', endDate: '2026-09-23' });
});

test('30-day revenue distinguishes a real zero from no reported rows', () => {
  assert.deepEqual(sumRevenueWindow([], '2026-09-23'), {
    total: 0, count: 0, startDate: '2026-08-25', endDate: '2026-09-23',
  });
  assert.equal(sumRevenueWindow([{ statDate: '2026-09-23', revenue: 0 }], '2026-09-23').count, 1);
});
