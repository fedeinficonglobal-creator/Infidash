import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useClientStore } from '../store/useClientStore.js';
import { DASHBOARD_PATH, GLOBAL_CONTENT_PATH, PROFILE_PATH, USERS_ADMIN_PATH, clientPath } from '../lib/routes.js';

/** Router-backed navigation. Components use this instead of writing the active client or tab. */
export function useAppNavigation() {
  const navigate = useNavigate();

  const findSlug = useCallback((clientId: string | null) => {
    if (!clientId) return null;
    return useClientStore.getState().clients.find((client) => client.id === clientId)?.slug ?? null;
  }, []);

  const goToClient = useCallback((clientId: string) => {
    const slug = findSlug(clientId);
    void navigate(slug ? clientPath(slug) : DASHBOARD_PATH);
  }, [findSlug, navigate]);

  const goToTab = useCallback((tabId: string) => {
    const slug = findSlug(useClientStore.getState().activeClientId);
    if (slug) {
      void navigate(clientPath(slug, tabId));
    } else {
      void navigate(tabId === 'content' ? GLOBAL_CONTENT_PATH : DASHBOARD_PATH);
    }
  }, [findSlug, navigate]);

  return useMemo(() => ({
    goToDashboard: () => void navigate(DASHBOARD_PATH),
    goToClient,
    goToTab,
    goToGlobalContent: () => void navigate(GLOBAL_CONTENT_PATH),
    goToUsersAdmin: () => void navigate(USERS_ADMIN_PATH),
    goToProfile: () => void navigate(PROFILE_PATH),
  }), [goToClient, goToTab, navigate]);
}
