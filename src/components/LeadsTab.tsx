import { Megaphone, TrendingUp, Filter, CheckCircle2, Clock, XCircle, MoreVertical } from 'lucide-react';
import { type Client } from '../store/useClientStore';
import { buildClientSignals, formatMoney, formatPlain } from '../lib/clientSignals.js';

function buildLeadNames(industry: string) {
  const text = industry.toLowerCase();
  if (text.includes('b2b') || text.includes('industrial')) {
    return ['Nora García', 'Carlos Romero', 'Marta Vidal', 'Álvaro Ruiz'];
  }
  if (text.includes('moda') || text.includes('joyer')) {
    return ['María Sánchez', 'Lucas Rivas', 'Elena Gómez', 'Pablo Domínguez'];
  }
  return ['Laura Pérez', 'Javier Torres', 'Lucía Martín', 'Diego Alonso'];
}

export function LeadsTab({ client }: { client: Client }) {
  const signals = buildClientSignals(client);
  const leadNames = buildLeadNames(client.industry);
  const leadConversion = signals.healthBand === 'excellent' ? 14.8 : signals.healthBand === 'stable' ? 12.4 : signals.healthBand === 'risk' ? 9.7 : 6.3;
  const cpl = signals.cpa > 0 ? signals.cpa : (signals.revenue / Math.max(signals.conversions || 1, 1)) * 0.38;
  const pipelineEstimated = Math.max(signals.revenue * (signals.healthBand === 'excellent' ? 2.2 : signals.healthBand === 'stable' ? 1.8 : 1.4), 18500);

  const dummyLeads = [
    { id: 1, name: leadNames[0], source: 'Meta Ads', status: 'Nuevo', value: formatMoney(cpl * 54), date: 'Hace 2h' },
    { id: 2, name: leadNames[1], source: 'Google Organic', status: 'En Proceso', value: formatMoney(cpl * 138), date: 'Hace 5h' },
    { id: 3, name: leadNames[2], source: 'Email / Remarketing', status: 'Cerrado', value: formatMoney(cpl * 196), date: 'Ayer' },
    { id: 4, name: leadNames[3], source: 'Instagram Direct', status: 'Perdido', value: formatMoney(cpl * 22), date: 'Ayer' },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Centro de Leads · {client.name}</h2>
          <p className="text-slate-500 font-medium">{signals.primaryMessage} {signals.actionMessage}</p>
        </div>
        <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
          <Megaphone className="size-4" /> Configurar Webhooks
        </button>
      </header>

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
            <button className="text-xs font-bold text-slate-600 px-3 py-1 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">Exportar CSV</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contacto</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fuente</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estado</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Valor Est.</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dummyLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{lead.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium tracking-wide">{lead.date}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-semibold text-slate-600 px-2 py-1 bg-slate-100 rounded-md">{lead.source}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {lead.status === 'Nuevo' && <div className="size-2 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]" />}
                      {lead.status === 'En Proceso' && <Clock className="size-3 text-amber-500" />}
                      {lead.status === 'Cerrado' && <CheckCircle2 className="size-3 text-emerald-500" />}
                      {lead.status === 'Perdido' && <XCircle className="size-3 text-rose-500" />}
                      <span className="text-xs font-bold text-slate-700">{lead.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-slate-900">{lead.value}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-1 text-slate-300 hover:text-slate-600">
                      <MoreVertical className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
