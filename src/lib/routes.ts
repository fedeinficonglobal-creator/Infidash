export const DASHBOARD_PATH = '/';
export const GLOBAL_CONTENT_PATH = '/contenidos';
export const USERS_ADMIN_PATH = '/usuarios';
export const PROFILE_PATH = '/perfil';

const CLIENTS_SEGMENT = 'clientes';

/** URL section segment -> per-client tab id. The overview has no section. */
export const CLIENT_SECTIONS: Readonly<Record<string, string>> = Object.freeze({
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

const SECTIONS_BY_TAB_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(CLIENT_SECTIONS).map(([section, tabId]) => [tabId, section])),
);

export function sectionToTabId(section: string): string | null {
  return Object.hasOwn(CLIENT_SECTIONS, section) ? CLIENT_SECTIONS[section] : null;
}

export function tabIdToSection(tabId: string): string | null {
  return Object.hasOwn(SECTIONS_BY_TAB_ID, tabId) ? SECTIONS_BY_TAB_ID[tabId] : null;
}

export function clientPath(slug: string, tabId = 'overview') {
  const base = `/${CLIENTS_SEGMENT}/${encodeURIComponent(slug)}`;
  const section = tabIdToSection(tabId);
  return section ? `${base}/${section}` : base;
}

export interface RoutableClient {
  id: string;
  slug: string;
  activeTabs?: string[];
}

export interface RouteContext {
  clients: RoutableClient[];
  isAdmin: boolean;
  /** False while the real client list is still loading; client routes then wait instead of redirecting. */
  clientsReady: boolean;
}

export type ResolvedRoute =
  | { type: 'view'; clientId: string | null; tabId: string }
  | { type: 'redirect'; to: string }
  | { type: 'pending' };

function view(clientId: string | null, tabId: string): ResolvedRoute {
  return { type: 'view', clientId, tabId };
}

function redirect(to: string): ResolvedRoute {
  return { type: 'redirect', to };
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Maps a pathname to the view it renders, or to the redirect that makes it valid. */
export function resolveAppRoute(pathname: string, context: RouteContext): ResolvedRoute {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return view(null, 'overview');

  if (segments.length === 1) {
    const path = `/${segments[0]}`;
    if (path === GLOBAL_CONTENT_PATH) return view(null, 'content');
    if (path === PROFILE_PATH) return view(null, 'profile');
    if (path === USERS_ADMIN_PATH) return context.isAdmin ? view(null, 'users-admin') : redirect(DASHBOARD_PATH);
  }

  if (segments[0] !== CLIENTS_SEGMENT || segments.length < 2 || segments.length > 3) {
    return redirect(DASHBOARD_PATH);
  }

  if (!context.clientsReady) return { type: 'pending' };

  const slug = decodeSegment(segments[1]);
  const client = slug === null ? undefined : context.clients.find((candidate) => candidate.slug === slug);
  if (!client) return redirect(DASHBOARD_PATH);

  if (segments.length === 2) return view(client.id, 'overview');

  const tabId = sectionToTabId(segments[2]);
  if (!tabId || (client.activeTabs && !client.activeTabs.includes(tabId))) {
    return redirect(clientPath(client.slug));
  }
  return view(client.id, tabId);
}
