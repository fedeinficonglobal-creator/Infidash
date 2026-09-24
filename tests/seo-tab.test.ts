import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeoTab } from '../src/components/SeoTab.js';
import type { Client } from '../src/store/useClientStore.js';

test('SEO does not show mock search queries, positions or unsupported recommendations', () => {
  const client: Client = {
    id: 'client-a', slug: 'client-a', name: 'Cliente A', logo: '', health: 70, industry: 'Moda',
    metrics: {
      revenue: { label: 'Ingresos', value: '1.000 €', change: 0, trend: 'neutral' },
      roas: { label: 'ROAS', value: '2x', change: 0, trend: 'neutral' },
      conversions: { label: 'Conversiones', value: '12', change: 0, trend: 'neutral' },
      cpa: { label: 'CPA', value: '10 €', change: 0, trend: 'neutral' },
    },
    kpiThresholds: {} as Client['kpiThresholds'],
  };
  const html = renderToStaticMarkup(createElement(SeoTab, { client }));
  assert.match(html, /SEO aún no está disponible/);
  assert.doesNotMatch(html, /Clicks Totales|vestidos de fiesta mujer|Posición Media|Canibalización Detectada/);
});
