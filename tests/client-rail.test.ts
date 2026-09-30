import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { CLIENT_AVATAR_PALETTE, clientColor, clientInitials, clientLogoUrl, filterClients } from '../src/lib/clientAvatar.js';
import { clientPath } from '../src/lib/routes.js';
import { SidebarView } from '../src/components/Sidebar.js';
import type { Client } from '../src/store/useClientStore.js';

test('clientInitials takes up to two letters from the first two words, uppercase and without accents', () => {
  assert.equal(clientInitials('Inficon Global'), 'IG');
  assert.equal(clientInitials('C Rocio Vazquez'), 'CR');
  assert.equal(clientInitials('Óptica Ñandú'), 'ON');
  assert.equal(clientInitials('ésika'), 'ES');
});

test('clientInitials uses the first two letters of a single-word name', () => {
  assert.equal(clientInitials('matundy'), 'MA');
  assert.equal(clientInitials('  x  '), 'X');
});

test('clientInitials ignores punctuation and never returns an empty string', () => {
  assert.equal(clientInitials('& Co. Tienda'), 'CT');
  assert.equal(clientInitials('   '), '?');
});

test('clientColor is deterministic and always from the palette', () => {
  for (const slug of ['inficon-global', 'matundy', 'c-rocio-vazquez', '', 'a', 'z'.repeat(80)]) {
    const color = clientColor(slug);
    assert.equal(clientColor(slug), color);
    assert.ok(CLIENT_AVATAR_PALETTE.includes(color), `${slug} -> ${color}`);
  }
  const used = new Set(Array.from({ length: 40 }, (_, index) => clientColor(`cliente-${index}`)));
  assert.ok(used.size > 1, 'different slugs should spread over the palette');
});

test('filterClients is case- and accent-insensitive and returns everything for an empty query', () => {
  const clients = [{ name: 'Óptica Ñandú' }, { name: 'Inficon Global' }, { name: 'matundy' }];
  assert.deepEqual(filterClients(clients, ''), clients);
  assert.deepEqual(filterClients(clients, '   '), clients);
  assert.deepEqual(filterClients(clients, 'OPTICA'), [clients[0]]);
  assert.deepEqual(filterClients(clients, 'nandu'), [clients[0]]);
  assert.deepEqual(filterClients(clients, 'glo'), [clients[1]]);
  assert.deepEqual(filterClients(clients, 'zzz'), []);
});

test('clientLogoUrl treats empty and generated placeholder logos as missing', () => {
  assert.equal(clientLogoUrl(''), null);
  assert.equal(clientLogoUrl('https://ui-avatars.com/api/?name=Infidash&background=random'), null);
  assert.equal(clientLogoUrl('https://example.com/logo.png'), 'https://example.com/logo.png');
});

function makeClient(id: string, slug: string, name: string, logo = ''): Client {
  return {
    id, slug, name, logo, health: 80, industry: 'Retail',
    metrics: {
      revenue: { label: 'Ventas (30d)', value: '0 €', change: 0, trend: 'neutral' },
      roas: { label: 'ROAS', value: '0x', change: 0, trend: 'neutral' },
      conversions: { label: 'Conversiones', value: '0', change: 0, trend: 'neutral' },
      cpa: { label: 'CPA', value: '0 €', change: 0, trend: 'neutral' },
    },
    kpiThresholds: {} as Client['kpiThresholds'],
  };
}

// Zustand serves its initial state during server rendering, so the store-free view is rendered with explicit props.
function renderSidebar(pathname: string, props: { clients: Client[]; activeClientId: string | null; activeTabId: string }) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(SidebarView, props)),
  );
}

test('the sidebar renders a client rail with one avatar link per client and highlights the active one', () => {
  const clients = [
    makeClient('c1', 'inficon-global', 'Inficon Global'),
    makeClient('c2', 'matundy', 'matundy', 'https://example.com/matundy.png'),
    { ...makeClient('c3', 'c-rocio-vazquez', 'C Rocio Vazquez'), activeTabs: ['overview', 'sales'] },
  ];
  const html = renderSidebar(clientPath('c-rocio-vazquez', 'sales'), { clients, activeClientId: 'c3', activeTabId: 'sales' });

  assert.match(html, /<nav[^>]*aria-label="Clientes"/);
  for (const client of clients) {
    const link = html.match(new RegExp(`<a[^>]*aria-label="${client.name}"[^>]*>`))?.[0] ?? '';
    assert.match(link, new RegExp(`href="${clientPath(client.slug)}"`), `rail link for ${client.name}`);
  }
  const activeLink = html.match(/<a[^>]*aria-label="C Rocio Vazquez"[^>]*>/)?.[0] ?? '';
  assert.match(activeLink, /aria-current="page"/);
  const inactiveLink = html.match(/<a[^>]*aria-label="Inficon Global"[^>]*>/)?.[0] ?? '';
  assert.doesNotMatch(inactiveLink, /aria-current/);

  assert.match(html, />CR</);
  assert.match(html, /src="https:\/\/example.com\/matundy.png"/);
  assert.match(html, /aria-label="Buscar cliente"/);

  // Main sidebar: only the active client's sections.
  assert.match(html, /<nav[^>]*aria-label="Menú de cliente"/);
  assert.match(html, new RegExp(`href="${clientPath('c-rocio-vazquez', 'sales')}"`));
  assert.match(html, />Ventas \(Woo\)</);
  assert.doesNotMatch(html, />Redes Sociales</);

  // Rail tiles show the client's name under its avatar (Postiz-style), with a hidden scrollbar.
  const rail = html.match(/<nav[^>]*aria-label="Clientes"[\s\S]*?<\/nav>/)?.[0] ?? '';
  for (const client of clients) assert.match(rail, new RegExp(`>${client.name}</span>`), `rail label for ${client.name}`);
  assert.match(rail, />Inicio</);
  assert.match(rail, />Buscar</);
  assert.match(rail, /\[scrollbar-width:none\]/, 'the client list scrolls without a visible scrollbar');

  // The old long client list is gone: outside the rail only the active client's name appears.
  const main = html.replace(rail, '');
  assert.doesNotMatch(main, />Clientes</);
  assert.doesNotMatch(main, />Inficon Global</);
  assert.doesNotMatch(main, />matundy</);
  assert.match(main, />C Rocio Vazquez</);
});

test('without an active client the home button is current and no client menu is shown', () => {
  const html = renderSidebar('/', {
    clients: [makeClient('c1', 'inficon-global', 'Inficon Global')],
    activeClientId: null,
    activeTabId: 'overview',
  });
  const homeLink = html.match(/<a[^>]*aria-label="Dashboard de la agencia"[^>]*>/)?.[0] ?? '';
  assert.match(homeLink, /href="\/"/);
  assert.match(homeLink, /aria-current="page"/);
  assert.match(html, />Infidash</);
  assert.doesNotMatch(html, /aria-label="Menú de cliente"/);
  assert.doesNotMatch(html, /aria-current="page"[^>]*aria-label="Inficon Global"|aria-label="Inficon Global"[^>]*aria-current="page"/);
});
