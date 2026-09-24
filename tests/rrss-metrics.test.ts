import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RrssTab } from '../src/components/RrssTab.js';
import type { Client } from '../src/store/useClientStore.js';

test('RRSS keeps the planning table but does not fabricate audience or post performance', () => {
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
  const html = renderToStaticMarkup(createElement(RrssTab, { client }));
  assert.match(html, /Plan RRSS editable/);
  assert.doesNotMatch(html, /Seguidores|Impresiones \(7d\)|Engagement Rate|Rendimiento de Posts|Alcance e Impresiones/);
});
