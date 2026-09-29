import { useLayoutEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { useClientStore } from '../store/useClientStore.js';
import { resolveAppRoute, type ResolvedRoute } from '../lib/routes.js';

/**
 * The single place that derives activeClientId/activeTabId from the URL.
 * The URL is the source of truth; the store mirrors it for components that read it.
 */
export function useRouteSync(): ResolvedRoute {
  const { pathname } = useLocation();
  const clients = useClientStore((state) => state.clients);
  const isAdmin = useClientStore((state) => state.currentUser?.role === 'admin');
  const clientsReady = useClientStore((state) => !state.isBootstrapping
    && !state.isAuthenticating
    && !(state.isRefreshingClients && state.clients.length === 0));
  const activeClientId = useClientStore((state) => state.activeClientId);
  const activeTabId = useClientStore((state) => state.activeTabId);

  const route = useMemo(
    () => resolveAppRoute(pathname, { clients, isAdmin, clientsReady }),
    [pathname, clients, isAdmin, clientsReady],
  );

  useLayoutEffect(() => {
    if (route.type !== 'view') return;
    if (activeClientId !== route.clientId || activeTabId !== route.tabId) {
      useClientStore.setState({ activeClientId: route.clientId, activeTabId: route.tabId });
    }
  }, [route, activeClientId, activeTabId]);

  return route;
}
