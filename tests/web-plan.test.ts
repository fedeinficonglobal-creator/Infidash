import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  getWebMonthLabel,
  getWebPlanStorageKey,
  normalizeWebPlanRow,
  parseWebPlanRows,
  removeWebPlanRow,
  upsertWebPlanRow,
  type WebPlanRow,
} from '../src/lib/webPlan.js';

test('web plan helpers generate stable storage keys and normalize rows', () => {
  assert.equal(getWebPlanStorageKey('client-123'), 'infidash.web-plan:client-123');
  assert.equal(getWebMonthLabel(new Date('2026-05-15T00:00:00Z')), 'MAYO');

  const row = normalizeWebPlanRow({
    cliente: 'CRV',
    web: 'https://crv.es',
    kpi: 'Formularios web - Citas',
    umbralLeads: '335 FORMS',
    leadsAbril: '270 FORMS',
    accionMayo: 'Markdown Elementor para IA',
    leadsMayo: '324 FORMS',
    wpoMayo: '96',
  }, '2026-05-15T12:00:00.000Z');

  assert.ok(row.id.length > 0);
  assert.equal(row.cliente, 'CRV');
  assert.equal(row.createdAt, '2026-05-15T12:00:00.000Z');
});

test('web plan helpers can add, update, remove and parse rows', () => {
  const baseRows: WebPlanRow[] = [];
  const created = upsertWebPlanRow(baseRows, {
    cliente: 'CRV',
    web: 'https://crv.es',
    kpi: 'Formularios web - Citas',
    umbralLeads: '335 FORMS',
    leadsAbril: '270 FORMS',
    accionMayo: 'Markdown Elementor para IA',
    leadsMayo: '324 FORMS',
    wpoMayo: '96',
  }, '2026-05-15T12:00:00.000Z');

  assert.equal(created.length, 1);
  assert.equal(created[0].wpoMayo, '96');

  const updated = upsertWebPlanRow(created, {
    id: created[0].id,
    cliente: 'CRV',
    web: 'https://crv.es',
    kpi: 'Formularios web - Citas',
    umbralLeads: '340 FORMS',
    leadsAbril: '270 FORMS',
    accionMayo: 'Markdown Elementor para IA',
    leadsMayo: '324 FORMS',
    wpoMayo: '95',
  }, '2026-05-16T12:00:00.000Z');

  assert.equal(updated.length, 1);
  assert.equal(updated[0].umbralLeads, '340 FORMS');
  assert.equal(updated[0].createdAt, created[0].createdAt);

  const removed = removeWebPlanRow(updated, updated[0].id);
  assert.equal(removed.length, 0);

  const parsed = parseWebPlanRows(JSON.stringify(updated));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].cliente, 'CRV');
});
