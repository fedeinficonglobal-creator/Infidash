import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalesTab } from '../src/components/SalesTab.js';
import type { Client } from '../src/store/useClientStore.js';

test('Sales does not present manual metrics or fabricated charts as WooCommerce orders', () => {
  const client: Client = {
    id: 'client-a', slug: 'client-a', name: 'Cliente A', logo: '', health: 70, industry: 'Moda',
    metrics: {
      revenue: { label: 'Ventas (30d)', value: '1.000 €', change: 0, trend: 'neutral' },
      roas: { label: 'ROAS', value: '2x', change: 0, trend: 'neutral' },
      conversions: { label: 'Conversiones', value: '12', change: 0, trend: 'neutral' },
      cpa: { label: 'CPA', value: '10 €', change: 0, trend: 'neutral' },
    },
    kpiThresholds: {} as Client['kpiThresholds'],
    revenue30d: { total: 1000, count: 1, startDate: '2026-09-01', endDate: '2026-09-30' },
  };
  const html = renderToStaticMarkup(createElement(SalesTab, { client }));
  assert.match(html, /sincronizacion completa se guarda por tienda y periodo/);
  assert.doesNotMatch(html, /Categorías Top|Potencial recuperable|Ventas por Día|Pedidos.*12|Ingresos Totales/);
});
