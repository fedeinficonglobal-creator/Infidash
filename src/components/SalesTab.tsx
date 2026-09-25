import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShoppingBag } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { getClientIntegrations, getWooCommerceSalesPreview, getWooCommerceSalesSnapshot, syncWooCommerceSales, type ApiIntegration, type WooCommerceSalesPreview } from '../services/infidashApi.js';
import { isValidInclusiveDateRange } from '../lib/dateRange.js';

function defaultWindow() {
  const to = new Date().toISOString().slice(0, 10);
  const start = new Date(`${to}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: start.toISOString().slice(0, 10), to };
}

export function SalesTab({ client }: { client: Client }) {
  const sessionToken = useClientStore((state) => state.sessionToken);
  const isAdmin = useClientStore((state) => state.currentUser?.role === 'admin');
  const setActiveTab = useClientStore((state) => state.setActiveTab);
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [range, setRange] = useState(defaultWindow);
  const [preview, setPreview] = useState<WooCommerceSalesPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(false);
    setIntegrationLoading(true);
    if (!sessionToken) {
      setIntegrations([]);
      setIntegrationLoading(false);
      return () => { cancelled = true; };
    }
    void getClientIntegrations(sessionToken, client.id).then(({ integrations: rows }) => {
      if (!cancelled && id === requestId.current) setIntegrations(rows.filter((item) => item.provider === 'woocommerce'));
    }).catch((cause) => {
      if (!cancelled && id === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las integraciones');
    }).finally(() => {
      if (!cancelled && id === requestId.current) setIntegrationLoading(false);
    });
    return () => { cancelled = true; };
  }, [client.id, sessionToken]);

  const handlePreview = async (event: FormEvent) => {
    event.preventDefault();
    const integration = integrations.find((item) => item.isActive);
    if (!sessionToken || !integration) return;
    if (!isValidInclusiveDateRange(range.from, range.to, 31)) {
      setError('Selecciona un periodo válido de hasta 31 días.');
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = isAdmin
        ? await syncWooCommerceSales(sessionToken, integration.id, range.from, range.to)
        : await getWooCommerceSalesSnapshot(sessionToken, integration.id, range.from, range.to).then((saved) =>
          saved.complete ? saved : getWooCommerceSalesPreview(sessionToken, integration.id, range.from, range.to));
      if (id === requestId.current) setPreview(result);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudo consultar WooCommerce');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const activeIntegration = integrations.find((item) => item.isActive);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Ventas WooCommerce · {client.name}</h2>
        <p className="text-slate-500 font-medium">La sincronizacion completa se guarda por tienda y periodo; los pedidos se atribuyen al dia de compra indicado por WooCommerce.</p>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Consulta de ventas WooCommerce">
        <div className="flex items-start gap-4">
          <ShoppingBag className="mt-1 size-7 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-slate-900">Ventas reales por fecha de compra</h3>
            <p className="mt-1 text-sm text-slate-600">Solo pedidos completados. El total incluye impuestos y envío; los reembolsos {activeIntegration?.config.refundPolicy === 'ignore' ? 'no se restan' : 'se restan por defecto'} según la política de esta integración. No se mezclan monedas.</p>
            {integrationLoading ? <p className="mt-4 text-sm text-slate-500" role="status">Cargando integración…</p> : !activeIntegration ? (
              <div className="mt-4">
                <p className="text-sm text-amber-800">No hay una integración WooCommerce activa para este cliente.</p>
                <button type="button" onClick={() => setActiveTab('integrations')} className="mt-3 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">Ir a Integraciones</button>
              </div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={(event) => void handlePreview(event)}>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="text-xs font-bold text-slate-600">Compra desde<input aria-label="Compra desde" type="date" value={range.from} max={range.to} onChange={(event) => { requestId.current += 1; setLoading(false); setRange((current) => ({ ...current, from: event.target.value })); setPreview(null); setError(null); }} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-bold text-slate-600">Compra hasta<input aria-label="Compra hasta" type="date" value={range.to} min={range.from} onChange={(event) => { requestId.current += 1; setLoading(false); setRange((current) => ({ ...current, to: event.target.value })); setPreview(null); setError(null); }} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <button type="submit" disabled={loading || !isValidInclusiveDateRange(range.from, range.to, 31)} className="rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Consultando…' : isAdmin ? 'Sincronizar pedidos' : 'Consultar pedidos'}</button>
                </div>
                <p className="text-xs text-slate-500">Máximo 31 días y 500 pedidos por periodo. Los administradores guardan sincronizaciones completas; viewers consultan el snapshot y pueden ver una vista previa si aún no existe.</p>
              </form>
            )}
            {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
            {preview && <div className="mt-5 space-y-3" aria-live="polite">
              <p className="text-xs text-slate-500">{preview.persisted ? 'Sincronización guardada' : 'Vista previa sin guardar'} · {preview.orderCount} pedidos revisados · Reembolsos {preview.refundPolicy === 'subtract' ? 'restados' : 'no restados'} · moneda original.</p>
              {preview.sales.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay pedidos completados en el periodo.</p> : <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Compra</th><th className="p-3">Moneda</th><th className="p-3">Pedidos</th><th className="p-3">Bruto</th><th className="p-3">Reembolsos</th><th className="p-3">Ventas</th></tr></thead><tbody>{preview.sales.map((row) => <tr key={`${row.purchaseDate}-${row.currency}`} className="border-t border-slate-100"><td className="p-3">{row.purchaseDate}</td><td className="p-3">{row.currency}</td><td className="p-3">{row.orderCount}</td><td className="p-3">{row.grossTotal}</td><td className="p-3">{row.refundTotal}</td><td className="p-3 font-bold">{row.salesTotal}</td></tr>)}</tbody></table></div>}
            </div>}
          </div>
        </div>
      </section>
    </div>
  );
}
