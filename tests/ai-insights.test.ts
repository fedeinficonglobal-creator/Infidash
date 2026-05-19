import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Client } from '../src/store/useClientStore.js';
import { buildAiInsightPlan } from '../src/lib/aiInsights.js';

const baseClient = {
  id: 'client-1',
  slug: 'client-1',
  name: 'Cliente Prueba',
  logo: 'https://example.com/logo.png',
  health: 82,
  industry: 'Retail / Ecommerce',
  metrics: {
    revenue: { label: 'Ventas (30d)', value: '12.345 €', change: 12.4, trend: 'up' },
    roas: { label: 'ROAS Global', value: '4.7x', change: 0.8, trend: 'up' },
    conversions: { label: 'Conversiones', value: '138', change: 4.1, trend: 'up' },
    cpa: { label: 'CPA Medio', value: '13 €', change: -2.2, trend: 'down' },
  },
} as Client;

test('buildAiInsightPlan builds an actionable plan for the active client', () => {
  const plan = buildAiInsightPlan(baseClient);

  assert.equal(plan.title, 'Insights prioritarios');
  assert.equal(plan.ctaLabel, 'Abrir Insights IA');
  assert.equal(plan.priorityItems.length, 3);
  assert.ok(plan.priorityItems[0].startsWith('Escalar')); 
  assert.ok(plan.contentPillars.some((pillar) => pillar.toLowerCase().includes('producto')));
  assert.ok(plan.budgetFocus.includes('remarketing'));
});
