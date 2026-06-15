import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Calendar, FileText, LoaderCircle, Save, Share2, Download, Mail } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { createDailyStat, getDailyStats, type DailyStat } from '../services/infidashApi';

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(statDate: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${statDate}T00:00:00`));
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

function formatInteger(value: number) {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 0,
  }).format(value);
}

function DailyStatRow({ stat }: { stat: DailyStat }) {
  return (
    <div className="p-4 flex flex-col gap-3 hover:bg-slate-50 transition-colors sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="size-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
          <FileText className="size-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-900">{formatDate(stat.statDate)}</h4>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            {stat.source} • {stat.notes ? stat.notes : 'Sin notas'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4 sm:gap-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revenue</p>
          <p className="text-sm font-bold text-slate-900">{formatMoney(stat.revenue)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">ROAS</p>
          <p className="text-sm font-bold text-slate-900">{formatDecimal(stat.roas)}x</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">CPA</p>
          <p className="text-sm font-bold text-slate-900">{formatMoney(stat.cpa)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Conv.</p>
          <p className="text-sm font-bold text-slate-900">{formatInteger(stat.conversions)}</p>
        </div>
      </div>
    </div>
  );
}

export function ReportsTab({ client }: { client: Client }) {
  const { sessionToken, currentUser, refreshClients } = useClientStore();
  const canManageReports = currentUser?.role === 'admin';
  const [isSavingStat, setIsSavingStat] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dailyStatForm, setDailyStatForm] = useState({
    statDate: todayISODate(),
    revenue: '',
    roas: '',
    clicks: '',
    conversions: '',
    cpa: '',
    leads: '',
    traffic: '',
    notes: '',
  });

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      if (!sessionToken) {
        setDailyStats([]);
        setIsLoadingHistory(false);
        return;
      }

      setIsLoadingHistory(true);
      try {
        const response = await getDailyStats(sessionToken, client.id);
        if (!cancelled) {
          setDailyStats(response.stats.sort((a, b) => b.statDate.localeCompare(a.statDate)));
        }
      } catch {
        if (!cancelled) {
          setDailyStats([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [client.id, sessionToken]);

  const latestStat = dailyStats[0] ?? null;
  const historySummary = useMemo(() => {
    if (dailyStats.length === 0) {
      return 'Aún no hay métricas diarias guardadas para este cliente.';
    }

    return `Hay ${dailyStats.length} métricas reales guardadas para ${client.name}.`;
  }, [client.name, dailyStats.length]);

  const handleSaveDailyStat = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionToken) {
      setSaveError('No hay una sesión activa.');
      return;
    }

    setIsSavingStat(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const response = await createDailyStat(sessionToken, {
        clientId: client.id,
        statDate: dailyStatForm.statDate,
        revenue: dailyStatForm.revenue ? Number(dailyStatForm.revenue) : 0,
        roas: dailyStatForm.roas ? Number(dailyStatForm.roas) : 0,
        clicks: dailyStatForm.clicks ? Number(dailyStatForm.clicks) : 0,
        conversions: dailyStatForm.conversions ? Number(dailyStatForm.conversions) : 0,
        cpa: dailyStatForm.cpa ? Number(dailyStatForm.cpa) : 0,
        leads: dailyStatForm.leads ? Number(dailyStatForm.leads) : 0,
        traffic: dailyStatForm.traffic ? Number(dailyStatForm.traffic) : 0,
        notes: dailyStatForm.notes.trim() || undefined,
        source: 'manual',
      });

      setSaveSuccess(`Métrica guardada para ${response.stat.statDate}. El overview se actualizará con estos datos reales.`);
      await refreshClients();
      setDailyStats((prev) => [response.stat, ...prev.filter((item) => item.id !== response.stat.id)].sort((a, b) => b.statDate.localeCompare(a.statDate)));
      setDailyStatForm({
        statDate: todayISODate(),
        revenue: '',
        roas: '',
        clicks: '',
        conversions: '',
        cpa: '',
        leads: '',
        traffic: '',
        notes: '',
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la métrica diaria');
    } finally {
      setIsSavingStat(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Generación de Reportes</h2>
          <p className="text-slate-500 font-medium">Exportación de datos, métricas diarias y histórico real para {client.name}.</p>
        </div>
        <div className="flex gap-3">
          <button
            disabled={!canManageReports}
            className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Calendar className="size-4" /> Programar Envío
          </button>
          <button
            disabled={!canManageReports}
            className="bg-brand-primary text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="size-4" /> Nuevo Reporte
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden group">
          <div className="relative z-10">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Última métrica guardada</h3>
            <p className="text-sm text-slate-400 font-medium mb-6">
              {latestStat
                ? `${formatDate(latestStat.statDate)} · Revenue ${formatMoney(latestStat.revenue)} · ROAS ${formatDecimal(latestStat.roas)}x`
                : 'Todavía no hay métricas guardadas para este cliente.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors">
                <Download className="size-3" /> Descargar PDF
              </button>
              <button className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-200 transition-colors">
                <Share2 className="size-3" /> Compartir resumen
              </button>
            </div>
          </div>
          <FileText className="absolute -right-4 -bottom-4 size-32 text-slate-50 group-hover:text-slate-100 transition-colors" />
        </div>

        <div className="bg-brand-secondary/5 p-8 rounded-3xl border border-brand-secondary/10 shadow-sm relative overflow-hidden group">
          <div className="relative z-10">
            <h3 className="text-lg font-bold text-brand-secondary mb-2">Integración pendiente</h3>
            <p className="text-sm text-slate-500 font-medium mb-6">La sincronización automática con Notion todavía no está conectada. Por ahora, el histórico vive en PostgreSQL.</p>
            <button className="text-brand-secondary font-bold text-xs flex items-center gap-2 hover:translate-x-1 transition-transform">
              Revisar roadmap <Share2 className="size-3" />
            </button>
          </div>
          <div className="absolute top-4 right-4 size-10 bg-white rounded-xl shadow-sm flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity">
            <Share2 className="size-5 text-brand-secondary" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-12">
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Registrar métrica diaria</h3>
              <p className="text-xs text-slate-400 mt-1">Persistencia real en PostgreSQL para {client.name}</p>
            </div>
            {currentUser?.role === 'admin' ? (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">Solo administradores</span>
            ) : (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md">Solo lectura</span>
            )}
          </div>

          {canManageReports ? (
            <form onSubmit={handleSaveDailyStat} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block text-sm font-medium text-slate-600">
                  Fecha
                  <input
                    type="date"
                    value={dailyStatForm.statDate}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, statDate: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    required
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Revenue (€)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dailyStatForm.revenue}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, revenue: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="12450"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  ROAS
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={dailyStatForm.roas}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, roas: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="4.8"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  CPA (€)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dailyStatForm.cpa}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, cpa: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="12.5"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Clicks
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dailyStatForm.clicks}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, clicks: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="2840"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Conversiones
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dailyStatForm.conversions}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, conversions: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="138"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Leads
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dailyStatForm.leads}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, leads: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="42"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Tráfico
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dailyStatForm.traffic}
                    onChange={(e) => setDailyStatForm((prev) => ({ ...prev, traffic: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                    placeholder="12000"
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-600">
                Notas
                <textarea
                  value={dailyStatForm.notes}
                  onChange={(e) => setDailyStatForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 w-full min-h-24 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-primary"
                  placeholder="Resumen breve de lo ocurrido hoy..."
                />
              </label>

              {saveError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {saveError}
                </div>
              )}

              {saveSuccess && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {saveSuccess}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-2">
                <p className="text-xs text-slate-400">{historySummary}</p>
                <button
                  type="submit"
                  disabled={isSavingStat}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingStat ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {isSavingStat ? 'Guardando...' : 'Guardar métrica'}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-6">
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Modo solo lectura</p>
                <p className="mt-1">Tu usuario puede revisar métricas y exportaciones, pero no registrar ni modificar datos diarios.</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Resumen real del cliente</h3>
            <p className="text-xs text-slate-400 mt-1">Últimos datos sincronizados desde la API</p>
          </div>
          <div className="divide-y divide-slate-100 p-6 space-y-4">
            {isLoadingHistory ? (
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <LoaderCircle className="size-4 animate-spin" /> Cargando histórico...
              </div>
            ) : latestStat ? (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Revenue</p>
                    <p className="text-sm font-bold text-slate-900">{formatMoney(latestStat.revenue)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">ROAS</p>
                    <p className="text-sm font-bold text-slate-900">{formatDecimal(latestStat.roas)}x</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Clicks</p>
                    <p className="text-sm font-bold text-slate-900">{formatInteger(latestStat.clicks)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Conversiones</p>
                    <p className="text-sm font-bold text-slate-900">{formatInteger(latestStat.conversions)}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <p className="font-semibold text-slate-700">{formatDate(latestStat.statDate)}</p>
                  <p className="mt-1">{latestStat.notes || 'Sin notas para esta métrica.'}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-900">Histórico guardado</h4>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{dailyStats.length} entradas</span>
                </div>
                <div className="rounded-2xl border border-slate-100 overflow-hidden">
                  {dailyStats.slice(0, 6).map((stat) => (
                    <div key={stat.id}>
                      <DailyStatRow stat={stat} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                <p className="text-sm font-semibold text-slate-700">No hay métricas diarias guardadas todavía</p>
                <p className="text-xs text-slate-400 mt-1">Guarda la primera métrica para ver el histórico real aquí.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Exportación y sincronización</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="p-6 border-b lg:border-b-0 lg:border-r border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Exportar PDF / compartir</p>
            <p className="text-xs text-slate-500 mt-1">Los botones de exportación siguen como roadmap de producto hasta conectar el motor de documentos.</p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"><Download className="size-3" /> PDF</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"><Mail className="size-3" /> Email</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"><Share2 className="size-3" /> Cliente</span>
            </div>
          </div>
          <div className="p-6">
            <p className="text-sm font-semibold text-slate-900">Notion y otras integraciones</p>
            <p className="text-xs text-slate-500 mt-1">La integración todavía no escribe datos reales fuera de Infidash.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
