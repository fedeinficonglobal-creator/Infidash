import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  getRrssMonthLabel,
  getRrssPlanStorageKey,
  normalizeRrssPlanRow,
  parseRrssPlanRows,
  removeRrssPlanRow,
  upsertRrssPlanRow,
  type RrssPlanRow,
} from '../src/lib/rrssPlan.js';

test('RRSS plan helpers generate stable storage keys and normalize rows', () => {
  assert.equal(getRrssPlanStorageKey('client-123'), 'infidash.rrss-plan:client-123');
  assert.equal(getRrssMonthLabel(new Date('2026-05-15T00:00:00Z')), 'MAYO');

  const row = normalizeRrssPlanRow({
    web: 'https://example.com',
    rrss: 'Facebook, Instagram',
    objetivo: 'Dar visibilidad a la marca',
    inspoIdea: 'Ideas y referencias',
    competidores: 'Competidor A',
  }, '2026-05-15T12:00:00.000Z');

  assert.ok(row.id.length > 0);
  assert.equal(row.createdAt, '2026-05-15T12:00:00.000Z');
  assert.equal(row.updatedAt, '2026-05-15T12:00:00.000Z');
  assert.equal(row.web, 'https://example.com');
});

test('RRSS plan helpers can add, update, remove and parse rows', () => {
  const baseRows: RrssPlanRow[] = [];
  const created = upsertRrssPlanRow(baseRows, {
    web: 'https://es.example.com',
    rrss: 'Facebook, Instagram',
    objetivo: 'Objetivo inicial',
    inspoIdea: 'Inspiración inicial',
    competidores: 'Competidor inicial',
  }, '2026-05-15T12:00:00.000Z');

  assert.equal(created.length, 1);
  assert.equal(created[0].objetivo, 'Objetivo inicial');

  const updated = upsertRrssPlanRow(created, {
    id: created[0].id,
    web: 'https://es.example.com',
    rrss: 'Facebook, Instagram, TikTok',
    objetivo: 'Objetivo actualizado',
    inspoIdea: 'Inspiración actualizada',
    competidores: 'Competidor actualizado',
  }, '2026-05-16T12:00:00.000Z');

  assert.equal(updated.length, 1);
  assert.equal(updated[0].rrss, 'Facebook, Instagram, TikTok');
  assert.equal(updated[0].createdAt, created[0].createdAt);
  assert.equal(updated[0].updatedAt, '2026-05-16T12:00:00.000Z');

  const removed = removeRrssPlanRow(updated, updated[0].id);
  assert.equal(removed.length, 0);

  const parsed = parseRrssPlanRows(JSON.stringify(updated));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].web, 'https://es.example.com');
});
