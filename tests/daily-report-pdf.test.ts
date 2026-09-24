import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyStatsPdf, summarizeDailyStats } from '../src/lib/dailyReportPdf.js';

test('report summary distinguishes missing days from a true zero and retains source labels', () => {
  const summary = summarizeDailyStats([
    { statDate: '2026-09-01', revenue: 0, conversions: 0, source: 'manual' },
    { statDate: '2026-09-03', revenue: 120, conversions: 2, source: 'manual' },
  ], '2026-09-01', '2026-09-03');
  assert.equal(summary.reportedDays, 2);
  assert.equal(summary.expectedDays, 3);
  assert.equal(summary.revenue, 120);
  assert.deepEqual(summary.sources, ['manual']);
});

test('daily report renderer produces a real PDF from selected client and period', async () => {
  const bytes = await buildDailyStatsPdf({ clientName: 'Cliente Prueba', from: '2026-09-01', to: '2026-09-03', generatedAt: '2026-09-23T12:00:00.000Z', stats: [
    { statDate: '2026-09-01', revenue: 120, conversions: 2, source: 'manual' },
  ] });
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(bytes.length > 1000);
});
