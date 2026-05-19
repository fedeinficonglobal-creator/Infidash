import { create } from 'zustand';
import { DEFAULT_KPI_THRESHOLDS, normalizeKpiThresholds, type KpiThresholds } from '../lib/kpiThresholds.js';
import {
  clearStoredSession,
  createClient as apiCreateClient,
  getClients,
  getCurrentSession,
  loadStoredSession,
  login as apiLogin,
  logout as apiLogout,
  saveStoredSession,
  type ApiClient,
  type SessionUser,
} from '../services/infidashApi.js';

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
  dataError: string | null;
  setActiveClient: (id: string | null) => void;
  setActiveTab: (id: string) => void;
  bootstrapSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshClients: () => Promise<void>;
  addClient: (client: Omit<Client, 'id' | 'slug' | 'health' | 'metrics'>) => Promise<void>;
}

const DEFAULT_TABS = ['overview', 'sales', 'traffic', 'rrss', 'ai', 'reports', 'integrations'];

const FALLBACK_CLIENTS: Client[] = [
  {
    id: 'matundy',
    slug: 'matundy',
    name: 'Matundy',
    logo: 'https://images.unsplash.com/photo-1522312346375-d1f5dca6d8d2?q=80&w=200&h=200&auto=format&fit=crop',
    health: 86,
    industry: 'Retail / Ecommerce',
    activeTabs: ['overview', 'sales', 'traffic', 'rrss', 'ai', 'reports', 'integrations'],
    kpiThresholds: DEFAULT_KPI_THRESHOLDS,
    metrics: {
      revenue: { label: 'Ventas (30d)', value: '12.450 €', change: 12.5, trend: 'up' },
      roas: { label: 'ROAS Global', value: '4.8x', change: -2.3, trend: 'down' },
      conversions: { label: 'Pedidos Reales', value: '138', change: 8.1, trend: 'up' },
      cpa: { label: 'CPA Medio', value: '12,50 €', change: -5.4, trend: 'up' },
    },
  },
  {
    id: 'micaela-villa',
    slug: 'micaela-villa',
    name: 'Micaela Villa',
    logo: 'https://images.unsplash.com/photo-1523381235312-3a1ec56d99b7?q=80&w=200&h=200&auto=format&fit=crop',
    health: 84,
    industry: 'Moda / Joyería',
    activeTabs: ['overview', 'sales', 'traffic', 'rrss', 'ai', 'reports', 'integrations'],
    kpiThresholds: DEFAULT_KPI_THRESHOLDS,
    metrics: {
      revenue: { label: 'Ventas (30d)', value: '52.430 €', change: 12.5, trend: 'up' },
      roas: { label: 'ROAS Global', value: '4.8x', change: -2.3, trend: 'down' },
      conversions: { label: 'Pedidos Reales', value: '840', change: 8.1, trend: 'up' },
      cpa: { label: 'CPA Medio', value: '12,50 €', change: -5.4, trend: 'up' },
    },
  },
  {
    id: 'concha-vega',
    slug: 'concha-vega',
    name: 'Concha Vega',
    logo: 'https://images.unsplash.com/photo-1581578731522-745d05db9ad2?q=80&w=200&h=200&auto=format&fit=crop',
    health: 32,
    industry: 'Interiorismo / Deco',
    activeTabs: ['overview', 'rrss', 'ai', 'reports', 'integrations'],
    kpiThresholds: DEFAULT_KPI_THRESHOLDS,
    metrics: {
      revenue: { label: 'Impresiones RRSS', value: '2.1M', change: -15.2, trend: 'down' },
      roas: { label: 'Engagement Rate', value: '1.2%', change: -8.3, trend: 'down' },
      conversions: { label: 'Seguidores Ganados', value: '+124', change: -32.5, trend: 'down' },
      cpa: { label: 'Interacciones', value: '14.5K', change: -12.4, trend: 'down' },
    },
  },
  {
    id: 'alfran',
    slug: 'alfran',
    name: 'alfran',
    logo: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=200&h=200&auto=format&fit=crop',
    health: 71,
    industry: 'Servicios B2B / Industrial',
    activeTabs: ['overview', 'leads', 'seo', 'ai', 'reports', 'integrations'],
    kpiThresholds: DEFAULT_KPI_THRESHOLDS,
    metrics: {
      revenue: { label: 'Revenue Atribuido', value: '245K €', change: 5.1, trend: 'up' },
      roas: { label: 'Nuevos Contratos', value: '12', change: 0, trend: 'neutral' },
      conversions: { label: 'Propuestas Abiertas', value: '34', change: 2.3, trend: 'up' },
      cpa: { label: 'Valor Medio Ciclo', value: '24K €', change: 4.5, trend: 'up' },
    },
  },
];

function getFallbackClient(slug: string) {
  return FALLBACK_CLIENTS.find((client) => client.slug === slug) ?? null;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPlain(value: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value);
}

function mapApiClientToUiClient(client: ApiClient): Client {
  const fallback = getFallbackClient(client.slug);
  const latestStat = client.latestStat;

  const metrics = fallback?.metrics ?? {
    revenue: { label: 'Ventas (30d)', value: '0 €', change: 0, trend: 'neutral' },
    roas: { label: 'ROAS Global', value: '0.0x', change: 0, trend: 'neutral' },
    conversions: { label: 'Conversiones', value: '0', change: 0, trend: 'neutral' },
    cpa: { label: 'CPA Medio', value: '0,00 €', change: 0, trend: 'neutral' },
  };

  if (latestStat) {
    metrics.revenue = {
      ...metrics.revenue,
      value: formatMoney(latestStat.revenue),
    };
    metrics.roas = {
      ...metrics.roas,
      value: `${formatDecimal(latestStat.roas)}x`,
    };
    metrics.conversions = {
      ...metrics.conversions,
      value: formatPlain(latestStat.conversions),
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
    logo: client.logoUrl ?? fallback?.logo ?? 'https://ui-avatars.com/api/?name=Infidash&background=random',
    health: client.healthScore,
    industry: client.industry ?? fallback?.industry ?? 'General',
    activeTabs: fallback?.activeTabs ?? DEFAULT_TABS,
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
  dataError: null,
  setActiveClient: (id) => set({ activeClientId: id, activeTabId: id ? get().activeTabId : 'overview' }),
  setActiveTab: (id) => set({ activeTabId: id }),
  bootstrapSession: async () => {
    set({ isBootstrapping: true, authError: null, dataError: null });
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
        authError: error instanceof Error ? error.message : 'No se pudo restaurar la sesión',
      });
    } finally {
      set({ isBootstrapping: false });
    }
  },
  signIn: async (email, password) => {
    set({ isAuthenticating: true, authError: null });
    try {
      const result = await apiLogin(email, password);
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

    clearStoredSession();
    set({
      sessionToken: null,
      currentUser: null,
      clients: FALLBACK_CLIENTS,
      activeClientId: null,
      activeTabId: 'overview',
      authError: null,
      dataError: null,
    });
  },
  refreshClients: async () => {
    set({ isRefreshingClients: true, dataError: null });
    try {
      const response = await withSession(get, (token) => getClients(token));
      const mapped = response.clients.map(mapApiClientToUiClient);
      set((state) => ({
        clients: mapped.length > 0 ? mapped : FALLBACK_CLIENTS,
        activeClientId: state.activeClientId && mapped.some((client) => client.id === state.activeClientId)
          ? state.activeClientId
          : mapped[0]?.id ?? state.activeClientId,
      }));
    } catch (error) {
      set({
        dataError: error instanceof Error ? error.message : 'No se pudieron cargar los clientes',
        clients: FALLBACK_CLIENTS,
      });
    } finally {
      set({ isRefreshingClients: false });
    }
  },
  addClient: async (clientInput) => {
    const token = get().sessionToken;
    const kpiThresholds = normalizeKpiThresholds(clientInput.kpiThresholds);
    const fallback: Client = {
      id: Math.random().toString(36).substring(2, 9),
      slug: clientInput.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `client-${Date.now()}`,
      name: clientInput.name,
      logo: clientInput.logo,
      health: 80,
      industry: clientInput.industry,
      activeTabs: ['overview', 'rrss', 'ai', 'reports', 'integrations'],
      kpiThresholds,
      metrics: {
        revenue: { label: 'Ventas (30d)', value: '0 €', change: 0, trend: 'neutral' },
        roas: { label: 'ROAS Global', value: '0.0x', change: 0, trend: 'neutral' },
        conversions: { label: 'Conversiones', value: '0', change: 0, trend: 'neutral' },
        cpa: { label: 'CPA Medio', value: '0,00 €', change: 0, trend: 'neutral' },
      },
    };

    if (!token) {
      set((state) => ({ clients: [...state.clients, fallback] }));
      return;
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
    } catch {
      set((state) => ({ clients: [...state.clients, fallback] }));
    }
  },
}));
