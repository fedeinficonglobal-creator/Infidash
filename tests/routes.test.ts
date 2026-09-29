import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_SECTIONS,
  DASHBOARD_PATH,
  GLOBAL_CONTENT_PATH,
  PROFILE_PATH,
  USERS_ADMIN_PATH,
  clientPath,
  resolveAppRoute,
  sectionToTabId,
  tabIdToSection,
  type RoutableClient,
} from '../src/lib/routes.js';

const clients: RoutableClient[] = [
  { id: 'client-1', slug: 'acme', activeTabs: ['overview', 'sales', 'content'] },
  { id: 'client-2', slug: 'globex' },
];

const ready = { clients, isAdmin: false, clientsReady: true };

test('global paths use Spanish segments', () => {
  assert.equal(DASHBOARD_PATH, '/');
  assert.equal(GLOBAL_CONTENT_PATH, '/contenidos');
  assert.equal(USERS_ADMIN_PATH, '/usuarios');
  assert.equal(PROFILE_PATH, '/perfil');
});

test('every client section maps to its tab id and round-trips', () => {
  assert.deepEqual(CLIENT_SECTIONS, {
    ventas: 'sales',
    trafico: 'traffic',
    web: 'web',
    seo: 'seo',
    leads: 'leads',
    'redes-sociales': 'rrss',
    contenidos: 'content',
    insights: 'ai',
    reportes: 'reports',
    integraciones: 'integrations',
  });
  for (const [section, tabId] of Object.entries(CLIENT_SECTIONS)) {
    assert.equal(sectionToTabId(section), tabId);
    assert.equal(tabIdToSection(tabId), section);
    assert.equal(clientPath('acme', tabId), `/clientes/acme/${section}`);
  }
});

test('unknown sections and tab ids do not map, and overview has no section', () => {
  assert.equal(sectionToTabId('desconocida'), null);
  assert.equal(sectionToTabId('sales'), null);
  assert.equal(tabIdToSection('overview'), null);
  assert.equal(tabIdToSection('nope'), null);
  assert.equal(clientPath('acme'), '/clientes/acme');
  assert.equal(clientPath('acme', 'overview'), '/clientes/acme');
  assert.equal(clientPath('acme', 'nope'), '/clientes/acme');
  assert.equal(clientPath('mi cliente'), '/clientes/mi%20cliente');
});

test('global routes resolve without a client', () => {
  assert.deepEqual(resolveAppRoute('/', ready), { type: 'view', clientId: null, tabId: 'overview' });
  assert.deepEqual(resolveAppRoute('/contenidos', ready), { type: 'view', clientId: null, tabId: 'content' });
  assert.deepEqual(resolveAppRoute('/perfil', ready), { type: 'view', clientId: null, tabId: 'profile' });
  assert.deepEqual(resolveAppRoute('/perfil/', ready), { type: 'view', clientId: null, tabId: 'profile' });
});

test('users admin is reserved for admins', () => {
  assert.deepEqual(resolveAppRoute('/usuarios', { ...ready, isAdmin: true }), { type: 'view', clientId: null, tabId: 'users-admin' });
  assert.deepEqual(resolveAppRoute('/usuarios', ready), { type: 'redirect', to: '/' });
});

test('client routes resolve by slug and section', () => {
  assert.deepEqual(resolveAppRoute('/clientes/acme', ready), { type: 'view', clientId: 'client-1', tabId: 'overview' });
  assert.deepEqual(resolveAppRoute('/clientes/acme/ventas', ready), { type: 'view', clientId: 'client-1', tabId: 'sales' });
  assert.deepEqual(resolveAppRoute('/clientes/acme/contenidos', ready), { type: 'view', clientId: 'client-1', tabId: 'content' });
  assert.deepEqual(resolveAppRoute('/clientes/globex/integraciones', ready), { type: 'view', clientId: 'client-2', tabId: 'integrations' });
});

test('client route edge cases redirect to a safe page', () => {
  assert.deepEqual(resolveAppRoute('/clientes/nadie', ready), { type: 'redirect', to: '/' });
  assert.deepEqual(resolveAppRoute('/clientes/nadie/ventas', ready), { type: 'redirect', to: '/' });
  assert.deepEqual(resolveAppRoute('/clientes/acme/desconocida', ready), { type: 'redirect', to: '/clientes/acme' });
  assert.deepEqual(resolveAppRoute('/clientes/acme/trafico', ready), { type: 'redirect', to: '/clientes/acme' }, 'a section outside activeTabs goes to the overview');
  assert.deepEqual(resolveAppRoute('/clientes', ready), { type: 'redirect', to: '/' });
  assert.deepEqual(resolveAppRoute('/clientes/acme/ventas/extra', ready), { type: 'redirect', to: '/' });
});

test('client routes wait for real clients instead of redirecting', () => {
  const loading = { clients: [], isAdmin: false, clientsReady: false };
  assert.deepEqual(resolveAppRoute('/clientes/acme/ventas', loading), { type: 'pending' });
  assert.deepEqual(resolveAppRoute('/contenidos', loading), { type: 'view', clientId: null, tabId: 'content' });
});

test('unknown paths redirect to the dashboard', () => {
  assert.deepEqual(resolveAppRoute('/nada', ready), { type: 'redirect', to: '/' });
  assert.deepEqual(resolveAppRoute('/contenidos/extra', ready), { type: 'redirect', to: '/' });
});
