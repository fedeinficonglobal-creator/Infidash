import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildClientSignals, getHealthBand } from '../src/lib/clientSignals.js';

const clientFixture = {
  id: 'client-1',
  name: 'Cliente Prueba',
  health: 84,
  metrics: {
    revenue: { value: '12.345' },
    roas: { value: '4,7' },
    conversions: { value: '138' },
    cpa: { value: '13' },
  },
} as any;

test('getHealthBand keeps the same thresholds used by the UI', () => {
  assert.equal(getHealthBand(84), 'excellent');
  assert.equal(getHealthBand(70), 'stable');
  assert.equal(getHealthBand(55), 'risk');
  assert.equal(getHealthBand(12), 'critical');
});

test('buildClientSignals derives dynamic guidance from client metrics', () => {
  const signals = buildClientSignals(clientFixture);

  assert.equal(signals.revenue, 12345);
  assert.equal(signals.roas, 4.7);
  assert.equal(signals.conversions, 138);
  assert.equal(signals.cpa, 13);
  assert.equal(signals.healthBand, 'excellent');
  assert.match(signals.primaryMessage, /Cliente Prueba/);
  assert.match(signals.riskMessage, /ROAS/);
  assert.match(signals.actionMessage, /Escalar presupuesto/);
  assert.deepEqual(signals.channelShare, {
    search: 46,
    social: 28,
    direct: 18,
    referral: 8,
  });
});
