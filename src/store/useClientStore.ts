import { create } from 'zustand';
import { useContentStore } from './useContentStore.js';
import { DEFAULT_KPI_THRESHOLDS, normalizeKpiThresholds, type KpiThresholds } from '../lib/kpiThresholds.js';
import {
  clearStoredSession,
  createClient as apiCreateClient,
  deleteClient as apiDeleteClient,
  getClients,
  updateClient as apiUpdateClient,
  getCurrentSession,
  loadStoredSession,
  login as apiLogin,
  logout as apiLogout,
  saveStoredSession,
  type ApiClient,
  type SessionUser,
} from '../services/infidashApi.js';
import { isAbortError, isUnauthorizedError, resetUnauthorizedLatch, setUnauthorizedHandler } from '../services/sessionExpiry.js';
import { formatDecimal, formatInteger, formatMoney } from '../lib/format.js';

export interface Metric {
  label: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'neutral';
}

export interface Client {
  id: string;
  slug: string;
  name: string;
  logo: string;
  health: number;
  revenue30d?: { total: number; count: number; startDate: string; endDate: string };
  industry: string;
  activeTabs?: string[];
  metrics: {
    revenue: Metric;
    roas: Metric;
    conversions: Metric;
    cpa: Metric;
  };
  kpiThresholds: KpiThresholds;
}

interface ClientState {
  activeClientId: string | null;
  activeTabId: string;
  clients: Client[];
  sessionToken: string | null;
  currentUser: SessionUser | null;
  isBootstrapping: boolean;
  isAuthenticating: boolean;
  isRefreshingClients: boolean;
  authError: string | null;
  sessionExpiredMessage: string | null;
  dataError: string | null;
  setActiveClient: (id: string | null) => void;
  setActiveTab: (id: string) => void;
  bootstrapSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshClients: () => Promise<void>;
  addClient: (client: Omit<Client, 'id' | 'slug' | 'health' | 'metrics'>) => Promise<void>;
  updateClient: (clientId: string, input: { name?: string; industry?: string | null; logo?: string | null; kpiThresholds?: KpiThresholds | Partial<KpiThresholds> | null }) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
}

export const DEFAULT_TABS = ['overview', 'sales', 'traffic', 'web', 'leads', 'rrss', 'content', 'ai', 'reports', 'integrations'];

const FALLBACK_CLIENTS: Client[] = [];

function getFallbackClient(slug: string) {
  return FALLBACK_CLIENTS.find((client) => client.slug === slug) ?? null;
}

function mapApiClientToUiClient(client: ApiClient): Client {
  const fallback = getFallbackClient(client.slug);
  const latestStat = client.latestStat;

  const metrics = fallback?.metrics ?? {
    revenue: { label: 'Ventas (30d)', value: '0 €', change: 0, trend: 'neutral' },
    roas: { label: 'ROAS (último dato)', value: 'Sin datos', change: 0, trend: 'neutral' },
    conversions: { label: 'Conversiones (último dato)', value: 'Sin datos', change: 0, trend: 'neutral' },
    cpa: { label: 'CPA Medio', value: '0,00 €', change: 0, trend: 'neutral' },
  };

  metrics.revenue = {
    ...metrics.revenue,
    label: 'Ventas (30d)',
    value: client.revenue30d?.count ? formatMoney(client.revenue30d.total) : 'Sin datos',
    change: 0,
    trend: 'neutral',
  };

  if (latestStat) {
    metrics.roas = {
      ...metrics.roas,
      value: `${formatDecimal(latestStat.roas)}x`,
    };
    metrics.conversions = {
      ...metrics.conversions,
      value: formatInteger(latestStat.conversions),
    };
    metrics.cpa = {
      ...metrics.cpa,
      value: formatMoney(latestStat.cpa),
    };
  }

  return {
    id: client.id,
    slug: client.slug,
    name: client.name,
    logo: client.logoUrl ?? fallback?.logo ?? '',
    health: client.healthScore,
    revenue30d: client.revenue30d,
    industry: client.industry ?? fallback?.industry ?? 'General',
    activeTabs: client.activeTabs ?? fallback?.activeTabs ?? DEFAULT_TABS,
    kpiThresholds: client.kpiThresholds ?? fallback?.kpiThresholds ?? DEFAULT_KPI_THRESHOLDS,
    metrics,
  };
}

async function withSession<T>(getState: () => ClientState, fn: (token: string) => Promise<T>) {
  const token = getState().sessionToken;
  if (!token) {
    throw new Error('No hay una sesión activa');
  }
  return fn(token);
}

export const SESSION_EXPIRED_MESSAGE = 'Tu sesión ha caducado. Inicia sesión de nuevo.';

// Abort scopes. The session scope covers requests that live as long as the login; the client
// scope covers requests tied to the active client and is replaced on every client switch.
let sessionController = new AbortController();
let clientController = new AbortController();

/** Signal aborted when the active client changes or the session ends; for client-scoped loaders. */
export function getActiveClientSignal(): AbortSignal {
  return clientController.signal;
}

function abortSessionScopes() {
  sessionController.abort();
  clientController.abort();
  sessionController = new AbortController();
  clientController = new AbortController();
}

export const useClientStore = create<ClientState>((set, get) => ({
  activeClientId: null,
  activeTabId: 'overview',
  clients: FALLBACK_CLIENTS,
  sessionToken: null,
  currentUser: null,
  isBootstrapping: true,
  isAuthenticating: false,
  isRefreshingClients: false,
  authError: null,
  sessionExpiredMessage: null,
  dataError: null,
  setActiveClient: (id) => set({ activeClientId: id, activeTabId: id ? get().activeTabId : 'overview' }),
  setActiveTab: (id) => set({ activeTabId: id }),
  bootstrapSession: async () => {
    set({ isBootstrapping: true, authError: null, dataError: null });
    resetUnauthorizedLatch();
    try {
      const stored = loadStoredSession();
      if (!stored) {
        set({ isBootstrapping: false, sessionToken: null, currentUser: null, clients: FALLBACK_CLIENTS });
        return;
      }

      const session = await getCurrentSession(stored.token);
      saveStoredSession({ token: stored.token, user: session.user });
      set({ sessionToken: stored.token, currentUser: session.user });
      await get().refreshClients();
    } catch (error) {
      clearStoredSession();
      set({
        sessionToken: null,
        currentUser: null,
        clients: FALLBACK_CLIENTS,
        // A 401 already surfaces through the session-expired notice.
        authError: isUnauthorizedError(error) ? null : error instanceof Error ? error.message : 'No se pudo restaurar la sesión',
      });
    } finally {
      set({ isBootstrapping: false });
    }
  },
  signIn: async (email, password) => {
    set({ isAuthenticating: true, authError: null, sessionExpiredMessage: null });
    try {
      const result = await apiLogin(email, password);
      resetUnauthorizedLatch();
      saveStoredSession({ token: result.token, user: result.user });
      set({ sessionToken: result.token, currentUser: result.user });
      await get().refreshClients();
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : 'No se pudo iniciar sesión' });
      throw error;
    } finally {
      set({ isAuthenticating: false });
    }
  },
  signOut: async () => {
    const token = get().sessionToken;
    if (token) {
      try {
        await apiLogout(token);
      } catch {
        // No bloquear el cierre local si el backend ya invalidó la sesión.
      }
    }

    endSession(set, null);
  },
  refreshClients: async () => {
    set({ isRefreshingClients: true, dataError: null });
    const token = get().sessionToken;
    const signal = sessionController.signal;
    try {
      const response = await withSession(get, (sessionToken) => getClients(sessionToken, signal));
      // A logout/expiry or a different session finished while the request was in flight.
      if (signal.aborted || get().sessionToken !== token) return;
      const mapped = response.clients.map(mapApiClientToUiClient);
      set((state) => {
        const currentActiveClient = mapped.find((client) => client.id === state.activeClientId) ?? null;
        const currentHasRealData = Boolean(
          currentActiveClient && (
            currentActiveClient.metrics.revenue.value !== '0 €'
            || currentActiveClient.metrics.conversions.value !== '0'
            || currentActiveClient.metrics.cpa.value !== '0,00 €'
          )
        );

        const preferredClient = mapped.find((client) => client.metrics.revenue.value !== '0 €')
          ?? mapped.find((client) => client.metrics.conversions.value !== '0')
          ?? mapped[0]
          ?? null;

        const nextActiveClientId = currentHasRealData
          ? currentActiveClient?.id ?? preferredClient?.id ?? state.activeClientId
          : preferredClient?.id ?? state.activeClientId;

        return {
          clients: mapped.length > 0 ? mapped : FALLBACK_CLIENTS,
          activeClientId: nextActiveClientId,
        };
      });
    } catch (error) {
      if (isAbortError(error) || signal.aborted || get().sessionToken !== token) return;
      set({
        dataError: error instanceof Error ? error.message : 'No se pudieron cargar los clientes',
      });
    } finally {
      if (!signal.aborted) set({ isRefreshingClients: false });
    }
  },
  addClient: async (clientInput) => {
    const token = get().sessionToken;
    const kpiThresholds = normalizeKpiThresholds(clientInput.kpiThresholds);

    if (!token) {
      const error = new Error('Necesitas una sesión activa para crear un cliente real');
      set({ dataError: error.message });
      throw error;
    }

    try {
      const response = await apiCreateClient(token, {
        name: clientInput.name,
        industry: clientInput.industry,
        logoUrl: clientInput.logo,
        healthScore: 80,
        kpiThresholds,
      });
      set((state) => ({
        clients: [...state.clients.filter((item) => item.slug !== response.client.slug), mapApiClientToUiClient(response.client)],
        activeClientId: response.client.id,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el cliente';
      set({ dataError: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
  updateClient: async (clientId, input) => {
    const token = get().sessionToken;
    if (!token) {
      const error = new Error('Necesitas una sesión activa para editar un cliente real');
      set({ dataError: error.message });
      throw error;
    }

    try {
      const response = await apiUpdateClient(token, clientId, {
        name: input.name,
        industry: input.industry,
        logoUrl: input.logo,
        kpiThresholds: input.kpiThresholds ? normalizeKpiThresholds(input.kpiThresholds) : undefined,
      });
      const mapped = mapApiClientToUiClient(response.client);
      set((state) => ({
        clients: state.clients.map((client) => (client.id === clientId ? mapped : client)),
        activeClientId: state.activeClientId === clientId ? clientId : state.activeClientId,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo editar el cliente';
      set({ dataError: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
  deleteClient: async (clientId) => {
    const token = get().sessionToken;
    if (!token) {
      const error = new Error('Necesitas una sesión activa para eliminar un cliente real');
      set({ dataError: error.message });
      throw error;
    }

    try {
      await apiDeleteClient(token, clientId);
      set((state) => {
        const clients = state.clients.filter((client) => client.id !== clientId);
        const nextActiveClientId = state.activeClientId === clientId ? (clients[0]?.id ?? null) : state.activeClientId;
        return {
          clients,
          activeClientId: nextActiveClientId,
          activeTabId: nextActiveClientId ? state.activeTabId : 'overview',
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el cliente';
      set({ dataError: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
}));

/** Clears every piece of per-user state; used by explicit logout and by session expiry. */
function endSession(set: (partial: Partial<ClientState>) => void, sessionExpiredMessage: string | null) {
  abortSessionScopes();
  clearStoredSession();
  useContentStore.getState().reset();
  set({
    sessionToken: null,
    currentUser: null,
    clients: FALLBACK_CLIENTS,
    activeClientId: null,
    activeTabId: 'overview',
    authError: null,
    dataError: null,
    isRefreshingClients: false,
    sessionExpiredMessage,
  });
}

// A client switch cancels whatever the previous client had in flight.
useClientStore.subscribe((state, previous) => {
  if (state.activeClientId !== previous.activeClientId) {
    clientController.abort();
    clientController = new AbortController();
  }
});

// The token is already invalid on a 401, so the server logout endpoint is not called.
export function registerSessionExpiryHandler() {
  setUnauthorizedHandler((token) => {
    const current = useClientStore.getState().sessionToken;
    if (current && current !== token) return; // stale response from a previous session
    endSession(useClientStore.setState, SESSION_EXPIRED_MESSAGE);
  });
}

registerSessionExpiryHandler();
