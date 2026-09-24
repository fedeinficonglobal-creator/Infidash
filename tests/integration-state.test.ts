import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIntegrationSaveState, statusForIntegrationView } from '../src/lib/integrationState.js';

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
