import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Megaphone, CheckCircle2, Clock, XCircle, Copy, Check, LoaderCircle } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { buildLeadsCsv, type LeadExportRow } from '../lib/leadsExport.js';
import { getClientIntegrations, getLeads, rotateIntegrationWebhook, setIntegrationActive, type ApiIntegration, type ApiLead, type LeadsPage } from '../services/infidashApi.js';

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<ApiLead['status'], string> = {
  new: 'Nuevo',
  in_progress: 'En Proceso',
  closed: 'Cerrado',
  lost: 'Perdido',
};

function leadContactLabel(lead: ApiLead) {
  return lead.name || lead.email || lead.phone || 'Sin datos de contacto';
}

function leadDateLabel(iso: string) {
  try {
    return format(parseISO(iso), "d MMM, HH:mm", { locale: es });
  } catch {
    return iso;
  }
}

export function LeadsTab({ client }: { client: Client }) {
  const { sessionToken, currentUser } = useClientStore();
  const isAdmin = currentUser?.role === 'admin';

  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [page, setPage] = useState<LeadsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  const [updatingWebhook, setUpdatingWebhook] = useState(false);
  const [wordpressIntegration, setWordpressIntegration] = useState<ApiIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWebhookPanel, setShowWebhookPanel] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!sessionToken) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setPage(null);
      try {
        const [leadsResponse, integrationsResponse] = await Promise.all([
          getLeads(sessionToken, client.id, { limit: PAGE_SIZE, offset, status: statusFilter, source: sourceFilter }),
          getClientIntegrations(sessionToken, client.id),
        ]);
        if (!cancelled) {
          setLeads(leadsResponse.leads);
          setPage(leadsResponse);
          setWordpressIntegration(integrationsResponse.integrations.find((integration) => integration.provider === 'wordpress') ?? null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'No se pudieron cargar los leads');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [client.id, sessionToken, offset, statusFilter, sourceFilter]);

  const webhookUrl = wordpressIntegration?.isActive && wordpressIntegration.webhookSecret
    ? `${window.location.origin}/api/public/leads/${wordpressIntegration.webhookSecret}`
    : null;

  const handleCopyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  };

  const updateWebhook = async (action: 'enable' | 'disable' | 'rotate') => {
    if (!sessionToken || !wordpressIntegration || updatingWebhook) return;
    if (action === 'rotate' && !window.confirm('¿Rotar la URL del webhook? La URL anterior dejará de funcionar de inmediato.')) return;
    if (action === 'disable' && !window.confirm('¿Desactivar la captura de leads de WordPress?')) return;
    setUpdatingWebhook(true);
    setError(null);
    try {
      const response = action === 'rotate'
        ? await rotateIntegrationWebhook(sessionToken, wordpressIntegration.id)
        : await setIntegrationActive(sessionToken, wordpressIntegration.id, action === 'enable');
      setWordpressIntegration(response.integration);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No se pudo actualizar el webhook');
    } finally {
      setUpdatingWebhook(false);
    }
  };

  const handleExportCsv = async () => {
    if (!sessionToken || !page || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const allLeads: ApiLead[] = [];
      for (let exportOffset = 0; exportOffset < page.total; exportOffset += 100) {
        const response = await getLeads(sessionToken, client.id, {
          limit: 100, offset: exportOffset, status: statusFilter, source: sourceFilter,
        });
        allLeads.push(...response.leads);
        if (!response.leads.length) break;
      }
      const rows: LeadExportRow[] = allLeads.map((lead) => ({
      name: leadContactLabel(lead),
      source: lead.source,
      status: STATUS_LABELS[lead.status],
      date: leadDateLabel(lead.receivedAt),
      }));
      const blob = new Blob([buildLeadsCsv(rows)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-${client.slug || client.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'No se pudo exportar el CSV');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Centro de Leads · {client.name}</h2>
          <p className="text-slate-500 font-medium">Leads recibidos y almacenados para {client.name}.</p>
        </div>
        {isAdmin && (
        <button
          type="button"
          onClick={() => setShowWebhookPanel((current) => !current)}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
        >
          <Megaphone className="size-4" /> Configurar Webhooks
        </button>
        )}
      </header>

      {showWebhookPanel && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Captura de leads desde WordPress</h3>
          {!wordpressIntegration ? (
            <p className="text-sm text-slate-500">
              Este cliente todavía no tiene una integración de WordPress configurada. Ve a <strong>Integraciones</strong> y crea una antes de poder recibir leads.
            </p>
          ) : !webhookUrl ? (
            <p className="text-sm text-slate-500">La captura está desactivada o aún no hay URL. Actívala para recibir formularios.</p>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-3">
                En <strong>WP Webhooks</strong>, configura el disparador «Form submitted» de Fluent Forms o Contact Form 7 para enviar un <strong>POST JSON</strong> a esta URL. Para evitar duplicados, incluye <code>infidash_provider</code>, <code>infidash_form_id</code> y un <code>infidash_delivery_id</code> estable; consulta <code>docs/lead-webhooks.md</code>. No uses el email como identificador del envío.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">{webhookUrl}</code>
                <button
                  type="button"
                  onClick={() => void handleCopyWebhook()}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </>
          )}
          {wordpressIntegration && isAdmin && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={updatingWebhook} onClick={() => void updateWebhook(wordpressIntegration.isActive ? 'disable' : 'enable')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-40">
                {wordpressIntegration.isActive ? 'Desactivar captura' : 'Activar captura'}
              </button>
              <button type="button" disabled={updatingWebhook} onClick={() => void updateWebhook('rotate')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-40">Rotar URL</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Leads según filtros</p>
            <h3 className="text-3xl font-bold">{page?.total ?? '—'}</h3>
          </div>
          <div className="text-xs text-slate-500">{loading ? 'Cargando…' : error ? 'No se pudieron cargar' : `${leads.length} en esta página`}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">En curso</p>
            <h3 className="text-3xl font-bold">{page?.openCount ?? '—'}</h3>
          </div>
          <div className="text-xs text-slate-500">Nuevos o en proceso</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cerrados / perdidos</p>
            <h3 className="text-3xl font-bold">{page?.resolvedCount ?? '—'}</h3>
          </div>
          <div className="text-xs text-slate-500">Según el estado registrado</div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">Leads registrados</h3>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="lead-status">Filtrar por estado</label>
            <select id="lead-status" value={statusFilter} onChange={(event) => { setOffset(0); setStatusFilter(event.target.value); }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSourceFilter(sourceInput.trim()); }} className="flex gap-1">
              <label className="sr-only" htmlFor="lead-source">Fuente exacta</label>
              <input id="lead-source" value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} maxLength={100} placeholder="Fuente exacta" className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
              <button type="submit" className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold">Filtrar</button>
            </form>
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              disabled={!page?.total || exporting}
              className="text-xs font-bold text-slate-600 px-3 py-1 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="px-6 py-3 text-sm text-rose-700 bg-rose-50 border-b border-rose-100">{error}</p>}
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <LoaderCircle className="size-4 animate-spin" /> Cargando leads…
          </div>
        ) : leads.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {page?.total ? 'No hay leads en esta página.' : 'No hay leads para estos filtros.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contacto</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fuente</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estado</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contacto adicional</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{leadContactLabel(lead)}</p>
                        <p className="text-[10px] text-slate-400 font-medium tracking-wide">{leadDateLabel(lead.receivedAt)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-semibold text-slate-600 px-2 py-1 bg-slate-100 rounded-md">{lead.source}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {lead.status === 'new' && <div className="size-2 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]" />}
                        {lead.status === 'in_progress' && <Clock className="size-3 text-amber-500" />}
                        {lead.status === 'closed' && <CheckCircle2 className="size-3 text-emerald-500" />}
                        {lead.status === 'lost' && <XCircle className="size-3 text-rose-500" />}
                        <span className="text-xs font-bold text-slate-700">{STATUS_LABELS[lead.status]}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {[lead.email, lead.phone].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page && page.total > PAGE_SIZE && (
          <nav aria-label="Paginación de leads" className="flex items-center justify-between border-t border-slate-100 p-4 text-xs text-slate-600">
            <span>{Math.min(offset + 1, page.total)}–{Math.min(offset + leads.length, page.total)} de {page.total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded-lg border px-3 py-1 disabled:opacity-40">Anterior</button>
              <button type="button" disabled={loading || offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Siguiente</button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
