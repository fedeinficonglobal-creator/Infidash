import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildLeadsCsv } from '../src/lib/leadsExport.js';

test('buildLeadsCsv exports the visible lead rows with Spanish headers', () => {
  const csv = buildLeadsCsv([
    {
      name: 'Laura Pérez',
      source: 'Meta Ads',
      status: 'Nuevo',
      date: 'Hace 2h',
    },
    {
      name: '"Marta", Gómez',
      source: 'Email / Remarketing',
      status: 'En Proceso',
      date: 'Ayer\nTarde',
    },
  ]);

  assert.equal(
    csv,
    [
      'Contacto,Fuente,Estado,Fecha',
      'Laura Pérez,Meta Ads,Nuevo,Hace 2h',
      '"""Marta"", Gómez",Email / Remarketing,En Proceso,"Ayer\nTarde"',
      '',
    ].join('\n'),
  );
});
