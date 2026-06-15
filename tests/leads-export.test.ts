import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildLeadsCsv } from '../src/lib/leadsExport.js';

test('buildLeadsCsv exports the visible lead rows with Spanish headers', () => {
  const csv = buildLeadsCsv([
    {
      name: 'Laura Pérez',
      source: 'Meta Ads',
      status: 'Nuevo',
      value: '1.234 €',
      date: 'Hace 2h',
    },
    {
      name: '"Marta", Gómez',
      source: 'Email / Remarketing',
      status: 'En Proceso',
      value: '987,50 €',
      date: 'Ayer\nTarde',
    },
  ]);

  assert.equal(
    csv,
    [
      'Contacto,Fuente,Estado,Valor Est.,Fecha',
      'Laura Pérez,Meta Ads,Nuevo,1.234 €,Hace 2h',
      '"""Marta"", Gómez",Email / Remarketing,En Proceso,"987,50 €","Ayer\nTarde"',
      '',
    ].join('\n'),
  );
});
