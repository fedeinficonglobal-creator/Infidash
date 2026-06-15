import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { useClientStore } from '../src/store/useClientStore.ts';

const originalFetch = globalThis.fetch;

function createClient() {
  return {
    id: 'client-1',
    slug: 'cliente-prueba',
    name: 'Cliente prueba',
    logo: 'https://example.com/logo.png',
    health: 84,
    industry: 'Retail',
    activeTabs: ['overview'],
    metrics: {
      revenue: { label: 'Ventas (30d)', value: '10.000 €', change: 0, trend: 'neutral' as const },
      roas: { label: 'ROAS Global', value: '3.2x', change: 0, trend: 'neutral' as const },
      conversions: { label: 'Conversiones', value: '24', change: 0, trend: 'neutral' as const },
      cpa: { label: 'CPA Medio', value: '12,00 €', change: 0, trend: 'neutral' as const },
    },
    kpiThresholds: {
      revenue: 10000,
      roas: 3,
      conversions: 20,
      cpa: 15,
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  useClientStore.setState({
    activeClientId: null,
    activeTabId: 'overview',
    clients: [],
    sessionToken: null,
    currentUser: null,
    isBootstrapping: false,
    isAuthenticating: false,
    isRefreshingClients: false,
    authError: null,
    dataError: null,
  });
});

test('refreshClients keeps the current client list when the API fails', async () => {
  useClientStore.setState({
    clients: [createClient()],
    activeClientId: 'client-1',
    sessionToken: 'token-123',
    dataError: null,
    isRefreshingClients: false,
  });

  globalThis.fetch = async () => {
    throw new Error('backend temporalmente no disponible');
  };

  await useClientStore.getState().refreshClients();

  const state = useClientStore.getState();
  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].id, 'client-1');
  assert.equal(state.activeClientId, 'client-1');
  assert.equal(state.dataError, 'backend temporalmente no disponible');
});
