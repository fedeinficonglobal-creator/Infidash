import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Megaphone, TrendingUp, Filter, CheckCircle2, Clock, XCircle, Copy, Check, LoaderCircle } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { buildClientSignals, formatMoney } from '../lib/clientSignals.js';
import { buildLeadsCsv, type LeadExportRow } from '../lib/leadsExport.js';
import { getClientIntegrations, getLeads, type ApiIntegration, type ApiLead } from '../services/infidashApi.js';

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
  const { sessionToken } = useClientStore();
  const signals = buildClientSignals(client);
  const leadConversion = signals.healthBand === 'excellent' ? 14.8 : signals.healthBand === 'stable' ? 12.4 : signals.healthBand === 'risk' ? 9.7 : 6.3;
  const cpl = signals.cpa > 0 ? signals.cpa : (signals.revenue / Math.max(signals.conversions || 1, 1)) * 0.38;
  const pipelineEstimated = Math.max(signals.revenue * (signals.healthBand === 'excellent' ? 2.2 : signals.healthBand === 'stable' ? 1.8 : 1.4), 18500);

  const [leads, setLeads] = useState<ApiLead[]>([]);
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
      try {
        const [leadsResponse, integrationsResponse] = await Promise.all([
          getLeads(sessionToken, client.id),
          getClientIntegrations(sessionToken, client.id),
        ]);
        if (!cancelled) {
          setLeads(leadsResponse.leads);
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
  }, [client.id, sessionToken]);

  const webhookUrl = wordpressIntegration?.webhookSecret
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

  const handleExportCsv = () => {
    const rows: LeadExportRow[] = leads.map((lead) => ({
      name: leadContactLabel(lead),
      source: lead.source,
      status: STATUS_LABELS[lead.status],
      value: '—',
      date: leadDateLabel(lead.receivedAt),
    }));
    const csv = buildLeadsCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads-${client.slug || client.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Centro de Leads · {client.name}</h2>
          <p className="text-slate-500 font-medium">{signals.primaryMessage} {signals.actionMessage}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowWebhookPanel((current) => !current)}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
        >
          <Megaphone className="size-4" /> Configurar Webhooks
        </button>
      </header>

      {showWebhookPanel && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Captura de leads desde WordPress</h3>
          {!wordpressIntegration ? (
            <p className="text-sm text-slate-500">
              Este cliente todavía no tiene una integración de WordPress configurada. Ve a <strong>Integraciones</strong> y crea una antes de poder recibir leads.
            </p>
          ) : !webhookUrl ? (
            <p className="text-sm text-slate-500">Guarda la integración de WordPress en Integraciones para generar la URL del webhook.</p>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-3">
                Pega esta URL como destino del webhook en tu formulario de <strong>Fluent Forms</strong> (Configuraciones → Integraciones → Webhook) o en el plugin que uses para enviar <strong>Contact Form 7</strong> a un webhook. Cada envío del formulario creará un lead aquí automáticamente.
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
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conversión Lead a Venta</p>
            <h3 className="text-3xl font-bold">{leadConversion.toFixed(1)}%</h3>
          </div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs bg-emerald-50 w-fit px-2 py-1 rounded-md">
            <TrendingUp className="size-3" /> {signals.healthBand === 'critical' ? '-1.2' : '+2.1'}% ptos vs mes anterior
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Coste por Lead (CPL)</p>
            <h3 className="text-3xl font-bold">{formatMoney(cpl)}</h3>
          </div>
          <div className="flex items-center gap-2 text-rose-600 font-bold text-xs bg-rose-50 w-fit px-2 py-1 rounded-md">
            <TrendingUp className="size-3" /> {signals.healthBand === 'critical' ? '+15%' : '+4.8%'} vs foco de adquisición
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between h-[160px]">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pipeline Estimado</p>
            <h3 className="text-3xl font-bold">{formatMoney(pipelineEstimated)}</h3>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-primary rounded-full shadow-[0_0_8px_rgba(14,165,233,0.5)]" style={{ width: `${Math.min(95, Math.round(leadConversion * 5))}%` }} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Últimos Leads Registrados</h3>
          <div className="flex gap-2">
            <button className="p-2 bg-slate-50 text-slate-400 rounded-lg border border-slate-100 hover:text-slate-600">
              <Filter className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!leads.length}
              className="text-xs font-bold text-slate-600 px-3 py-1 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Exportar CSV
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
            Todavía no ha llegado ningún lead. Pulsa "Configurar Webhooks" arriba para conectar tu formulario de WordPress.
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
      </div>
    </div>
  );
}
