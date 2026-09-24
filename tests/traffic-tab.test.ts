import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrafficTab } from '../src/components/TrafficTab.js';
import type { Client } from '../src/store/useClientStore.js';

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

test('Traffic does not invent ad spend, ROAS, sessions or campaigns from client revenue', () => {
  const html = renderToStaticMarkup(createElement(TrafficTab, { client }));
  assert.match(html, /Sin datos reales de publicidad/);
  assert.doesNotMatch(html, /Gasto Ads Estimado|ROAS Combinado|Paid Search|Meta - Prospecting|1 May/);
});
