import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Compass } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { getClientIntegrations, getGa4TrafficPreview, getGa4TrafficSnapshot, syncGa4Traffic, type ApiIntegration, type Ga4TrafficReport } from '../services/infidashApi.js';
import { isValidInclusiveDateRange } from '../lib/dateRange.js';

function defaultWindow() {
  const to = new Date().toISOString().slice(0, 10);
  const start = new Date(`${to}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: start.toISOString().slice(0, 10), to };
}

export function TrafficTab({ client }: { client: Client }) {
  const sessionToken = useClientStore((state) => state.sessionToken);
  const isAdmin = useClientStore((state) => state.currentUser?.role === 'admin');
  const setActiveTab = useClientStore((state) => state.setActiveTab);
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [range, setRange] = useState(defaultWindow);
  const [report, setReport] = useState<Ga4TrafficReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    setReport(null);
    setError(null);
    setLoading(false);
    setIntegrationLoading(true);
    if (!sessionToken) {
      setIntegrations([]);
      setIntegrationLoading(false);
      return () => { cancelled = true; };
    }
    void getClientIntegrations(sessionToken, client.id).then(({ integrations: rows }) => {
      if (!cancelled && id === requestId.current) setIntegrations(rows.filter((item) => item.provider === 'ga4'));
    }).catch((cause) => {
      if (!cancelled && id === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las integraciones');
    }).finally(() => {
      if (!cancelled && id === requestId.current) setIntegrationLoading(false);
    });
    return () => { cancelled = true; };
  }, [client.id, sessionToken]);

  const activeIntegration = integrations.find((item) => item.isActive);

  const handleQuery = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionToken || !activeIntegration) return;
    if (!isValidInclusiveDateRange(range.from, range.to, 31)) {
      setError('Selecciona un periodo válido de hasta 31 días.');
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = isAdmin
        ? await syncGa4Traffic(sessionToken, activeIntegration.id, range.from, range.to)
        : await getGa4TrafficSnapshot(sessionToken, activeIntegration.id, range.from, range.to).then((saved) =>
          saved.complete ? saved : getGa4TrafficPreview(sessionToken, activeIntegration.id, range.from, range.to));
      if (id === requestId.current) setReport(result);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudo consultar Google Analytics');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const chartData = report?.sessionsSeries.map((point) => ({ name: point.date.slice(5), sessions: point.sessions, conversions: point.conversions })) ?? [];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Tráfico · {client.name}</h2>
        <p className="text-slate-500 font-medium">Sesiones, conversiones, fuentes de tráfico y páginas de Google Analytics 4, agrupadas según la zona horaria de la propiedad.</p>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Consulta de tráfico GA4">
        <div className="flex items-start gap-4">
          <Compass className="mt-1 size-7 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-slate-900">Tráfico real de Google Analytics 4</h3>
            <p className="mt-1 text-sm text-slate-600">
              {report?.timeZone ? `Fechas agrupadas en la zona horaria de la propiedad (${report.timeZone}).` : 'Las fechas se agrupan según la zona horaria configurada en la propiedad GA4.'}
            </p>
            {integrationLoading ? <p className="mt-4 text-sm text-slate-500" role="status">Cargando integración…</p> : !activeIntegration ? (
              <div className="mt-4">
                <p className="text-sm text-amber-800">No hay una integración de Google Analytics 4 activa para este cliente.</p>
                <button type="button" onClick={() => setActiveTab('integrations')} className="mt-3 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">Ir a Integraciones</button>
              </div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={(event) => void handleQuery(event)}>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="text-xs font-bold text-slate-600">Desde<input aria-label="Desde" type="date" value={range.from} max={range.to} onChange={(event) => { requestId.current += 1; setLoading(false); setRange((current) => ({ ...current, from: event.target.value })); setReport(null); setError(null); }} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-bold text-slate-600">Hasta<input aria-label="Hasta" type="date" value={range.to} min={range.from} onChange={(event) => { requestId.current += 1; setLoading(false); setRange((current) => ({ ...current, to: event.target.value })); setReport(null); setError(null); }} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  <button type="submit" disabled={loading || !isValidInclusiveDateRange(range.from, range.to, 31)} className="rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Consultando…' : isAdmin ? 'Sincronizar' : 'Consultar'}</button>
                </div>
                <p className="text-xs text-slate-500">Máximo 31 días. Los administradores guardan sincronizaciones completas; viewers consultan lo ya guardado y pueden ver una vista previa si aún no existe.</p>
              </form>
            )}
            {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
            {report?.samplingWarning && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="alert">GA4 aplicó muestreo a este periodo; los números son una estimación.</p>}
          </div>
        </div>
      </section>

      {report && (
        <div className="mt-6 space-y-6" aria-live="polite">
          <p className="text-xs text-slate-500">{report.persisted ? 'Sincronización guardada' : 'Vista previa sin guardar'} · propiedad {report.propertyId}.</p>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sesiones y conversiones</h3>
            {chartData.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay datos de sesiones en el periodo.</p>
            ) : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      formatter={(value, name) => [value, name === 'sessions' ? 'Sesiones' : 'Conversiones']}
                    />
                    <Area type="monotone" dataKey="sessions" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorSessions)" />
                    <Area type="monotone" dataKey="conversions" stroke="#6366f1" strokeWidth={3} fill="none" strokeDasharray="5 5" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Fuentes de tráfico</h3>
              {report.trafficSources.length === 0 ? <p className="mt-3 text-sm text-slate-500">Sin datos.</p> : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-slate-400"><tr><th className="pb-2">Canal</th><th className="pb-2">Sesiones</th><th className="pb-2">Conv.</th></tr></thead>
                  <tbody>{report.trafficSources.map((row) => <tr key={row.channelGroup} className="border-t border-slate-100"><td className="py-2">{row.channelGroup}</td><td className="py-2">{row.sessions}</td><td className="py-2">{row.conversions}</td></tr>)}</tbody>
                </table>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Páginas más vistas</h3>
              {report.topPages.length === 0 ? <p className="mt-3 text-sm text-slate-500">Sin datos.</p> : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-slate-400"><tr><th className="pb-2">Página</th><th className="pb-2">Vistas</th></tr></thead>
                  <tbody>{report.topPages.map((row) => <tr key={row.pagePath} className="border-t border-slate-100"><td className="py-2 truncate max-w-[12rem]" title={row.pagePath}>{row.pagePath}</td><td className="py-2">{row.pageViews}</td></tr>)}</tbody>
                </table>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Páginas de destino</h3>
              {report.landingPages.length === 0 ? <p className="mt-3 text-sm text-slate-500">Sin datos.</p> : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-slate-400"><tr><th className="pb-2">Página</th><th className="pb-2">Sesiones</th></tr></thead>
                  <tbody>{report.landingPages.map((row) => <tr key={row.landingPage} className="border-t border-slate-100"><td className="py-2 truncate max-w-[12rem]" title={row.landingPage}>{row.landingPage}</td><td className="py-2">{row.sessions}</td></tr>)}</tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
