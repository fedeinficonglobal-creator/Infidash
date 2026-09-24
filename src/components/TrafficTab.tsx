import { BarChart3 } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';

export function TrafficTab({ client }: { client: Client }) {
  const setActiveTab = useClientStore((state) => state.setActiveTab);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Tráfico y Ads · {client.name}</h2>
        <p className="text-slate-500 font-medium">Este espacio mostrará resultados cuando haya una fuente de publicidad conectada.</p>
      </header>
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-amber-950" aria-label="Estado de fuentes de publicidad">
        <BarChart3 className="size-8 mb-4" aria-hidden="true" />
        <h3 className="text-xl font-bold">Sin datos reales de publicidad</h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">
          No se estiman inversión, conversiones, CPA, ROAS, sesiones ni campañas a partir de ingresos u otras métricas del cliente.
          GA4, Meta Ads y Google Ads todavía no tienen sincronización real habilitada.
        </p>
        <button type="button" onClick={() => setActiveTab('integrations')} className="mt-6 rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-800">
          Ir a Integraciones
        </button>
      </section>
    </div>
  );
}
