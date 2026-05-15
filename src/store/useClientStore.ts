import { create } from 'zustand';

export interface Metric {
  label: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'neutral';
}

export interface Client {
  id: string;
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
}

interface ClientState {
  activeClientId: string | null;
  activeTabId: string;
  clients: Client[];
  setActiveClient: (id: string | null) => void;
  setActiveTab: (id: string) => void;
  addClient: (client: Omit<Client, 'id' | 'health' | 'metrics'>) => void;
}

export const useClientStore = create<ClientState>((set) => ({
  activeClientId: null,
  activeTabId: 'overview',
  clients: [
    {
      id: '1',
      name: 'Micaela Villa',
      logo: 'https://images.unsplash.com/photo-1523381235312-3a1ec56d99b7?q=80&w=200&h=200&auto=format&fit=crop',
      health: 84,
      industry: 'Moda / Joyería',
      activeTabs: ['overview', 'sales', 'traffic', 'rrss', 'ai', 'reports', 'integrations'],
      metrics: {
        revenue: { label: 'Ventas (30d)', value: '52.430 €', change: 12.5, trend: 'up' },
        roas: { label: 'ROAS Global', value: '4.8x', change: -2.3, trend: 'down' },
        conversions: { label: 'Pedidos Reales', value: '840', change: 8.1, trend: 'up' },
        cpa: { label: 'CPA Medio', value: '12,50 €', change: -5.4, trend: 'up' },
      }
    },
    {
      id: '2',
      name: 'Concha Vega',
      logo: 'https://images.unsplash.com/photo-1581578731522-745d05db9ad2?q=80&w=200&h=200&auto=format&fit=crop',
      health: 32,
      industry: 'Interiorismo / Deco',
      activeTabs: ['overview', 'rrss', 'ai', 'reports', 'integrations'],
      metrics: {
        revenue: { label: 'Impresiones RRSS', value: '2.1M', change: -15.2, trend: 'down' },
        roas: { label: 'Engagement Rate', value: '1.2%', change: -8.3, trend: 'down' },
        conversions: { label: 'Seguidores Ganados', value: '+124', change: -32.5, trend: 'down' },
        cpa: { label: 'Interacciones', value: '14.5K', change: -12.4, trend: 'down' },
      }
    },
    {
      id: '3',
      name: 'Clínica Rocío Vázquez',
      logo: 'https://images.unsplash.com/photo-1550029402-226115b7c579?q=80&w=200&h=200&auto=format&fit=crop',
      health: 92,
      industry: 'Medicina Estética',
      activeTabs: ['overview', 'traffic', 'leads', 'seo', 'ai', 'reports', 'integrations'],
      metrics: {
        revenue: { label: 'Citas Concertadas', value: '342', change: 18.4, trend: 'up' },
        roas: { label: 'Coste por Lead', value: '18,50 €', change: -12.1, trend: 'up' },
        conversions: { label: 'Leads Cualificados', value: '1.240', change: 25.2, trend: 'up' },
        cpa: { label: 'CTR Google Ads', value: '4.5%', change: 0.8, trend: 'up' },
      }
    },
    {
      id: '4',
      name: 'alfran',
      logo: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=200&h=200&auto=format&fit=crop',
      health: 71,
      industry: 'Servicios B2B / Industrial',
      activeTabs: ['overview', 'leads', 'seo', 'ai', 'reports', 'integrations'],
      metrics: {
        revenue: { label: 'Revenue Atribuido', value: '245K €', change: 5.1, trend: 'up' },
        roas: { label: 'Nuevos Contratos', value: '12', change: 0, trend: 'neutral' },
        conversions: { label: 'Propuestas Abiertas', value: '34', change: 2.3, trend: 'up' },
        cpa: { label: 'Valor Medio Ciclo', value: '24K €', change: 4.5, trend: 'up' },
      }
    }
  ],
  setActiveClient: (id) => set({ activeClientId: id }),
  setActiveTab: (id) => set({ activeTabId: id }),
  addClient: (newClientData) => set((state) => {
    const newClient: Client = {
      id: Math.random().toString(36).substring(2, 9),
      health: 80, // Default health for new client
      activeTabs: ['overview', 'rrss', 'ai', 'reports', 'integrations'],
      metrics: {
        revenue: { label: 'Ventas (30d)', value: '0 €', change: 0, trend: 'up' },
        roas: { label: 'ROAS Global', value: '0.0x', change: 0, trend: 'up' },
        conversions: { label: 'Conversiones', value: '0', change: 0, trend: 'up' },
        cpa: { label: 'CPA Medio', value: '0,00 €', change: 0, trend: 'down' },
      },
      ...newClientData
    };
    return { clients: [...state.clients, newClient] };
  })
}));
