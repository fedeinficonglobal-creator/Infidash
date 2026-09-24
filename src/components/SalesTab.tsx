import { ShoppingBag } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';

export function SalesTab({ client }: { client: Client }) {
  const setActiveTab = useClientStore((state) => state.setActiveTab);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Ventas WooCommerce · {client.name}</h2>
        <p className="text-slate-500 font-medium">Los importes de esta sección solo aparecerán cuando exista una sincronización completa y conciliada.</p>
      </header>

      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-amber-950" aria-label="Estado de ventas WooCommerce">
        <ShoppingBag className="size-8 mb-4" aria-hidden="true" />
        <h3 className="text-xl font-bold">No hay ventas WooCommerce sincronizadas</h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">
          No se muestran pedidos, ingresos, ticket medio, categorías ni oportunidades estimadas sin una fuente completa.
          Las métricas diarias introducidas manualmente permanecen en Resumen e Informes; no se presentan como pedidos de WooCommerce.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">
          Un administrador puede comprobar la conexión y consultar una vista previa acotada en Integraciones.
          Esa consulta no guarda pedidos ni activa esta pestaña.
        </p>
        <button type="button" onClick={() => setActiveTab('integrations')} className="mt-6 rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-800">
          Ir a Integraciones
        </button>
      </section>
    </div>
  );
}
