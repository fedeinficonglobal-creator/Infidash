import assert from 'node:assert/strict';
import test from 'node:test';
import { hasManualIntegrationSync, resolveIntegrationSaveState, statusForIntegrationView } from '../src/lib/integrationState.js';

test('only integrations with a real implemented sync adapter expose manual sync', () => {
  assert.equal(hasManualIntegrationSync('clarity'), true);
  for (const provider of ['wordpress', 'woocommerce', 'meta_ads', 'google_ads']) {
    assert.equal(hasManualIntegrationSync(provider), false);
  }
});

test('saving complete provider fields stays pending until a real probe or sync succeeds', () => {
  assert.deepEqual(resolveIntegrationSaveState({ provider: 'clarity', configurationUnchanged: false, missingFields: [] }), {
    status: 'pending', lastError: 'Configuración guardada; falta una prueba o sincronización real.',
  });
});

test('unsupported providers cannot be presented as connected even when legacy rows say so', () => {
  assert.equal(statusForIntegrationView('woocommerce', 'connected'), 'pending');
  assert.deepEqual(resolveIntegrationSaveState({ provider: 'woocommerce', configurationUnchanged: true, missingFields: [] }), {
    status: 'pending', lastError: 'No hay un adaptador de conexión/sincronización real para este proveedor todavía.',
  });
});

test('unchanged successfully verified adapters retain their status and incomplete setup reports missing fields', () => {
  assert.equal(resolveIntegrationSaveState({
    provider: 'wordpress', existingStatus: 'connected', configurationUnchanged: true, missingFields: [],
  }).status, 'connected');
  assert.deepEqual(resolveIntegrationSaveState({
    provider: 'wordpress', configurationUnchanged: false, missingFields: ['siteUrl'],
  }), { status: 'pending', lastError: 'Faltan campos obligatorios: siteUrl' });
});
