import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BarChart3, Target, Globe, TrendingUp, TrendingDown } from 'lucide-react';
import { ChartFrame } from './ChartFrame';
import { type Client } from '../store/useClientStore';
import { buildClientSignals, formatMoney, formatPlain } from '../lib/clientSignals.js';

const baseTrafficData = [
  { name: '1 May', google: 420, meta: 380 },
  { name: '5 May', google: 550, meta: 410 },
  { name: '10 May', google: 480, meta: 520 },
  { name: '15 May', google: 600, meta: 580 },
  { name: '20 May', google: 720, meta: 650 },
  { name: '25 May', google: 680, meta: 820 },
  { name: '30 May', google: 750, meta: 910 },
];

export function TrafficTab({ client }: { client: Client }) {
  const signals = buildClientSignals(client);
  const hasData = signals.hasData;
  const adBudget = hasData ? Math.max(signals.revenue * 0.18, 3200) : 0;
  const spendScale = hasData ? Math.max(signals.roas > 0 ? 4.2 / signals.roas : 1, 0.7) : 0;
  const trafficData = baseTrafficData.map((point, index) => ({
    ...point,
    google: hasData ? Math.round(point.google * spendScale) : 0,
    meta: hasData ? Math.round(point.meta * (1 + (signals.healthBand === 'critical' ? 0.22 : signals.healthBand === 'risk' ? 0.12 : 0.04)) - index * 8) : 0,
  }));
  const conversionsAds = hasData ? Math.max(Math.round(signals.conversions * 0.68), 1) : 0;
  const cpa = hasData && signals.cpa > 0 ? signals.cpa : 0;
  const roas = hasData ? signals.roas || 0 : 0;

  const channels = [
    { channel: 'Paid Search', sessions: hasData ? Math.round(adBudget * 3.2) : 0, share: signals.channelShare.search, trend: hasData ? 'up' as const : 'neutral' as const },
    { channel: 'Social Paid', sessions: hasData ? Math.round(adBudget * 2.1) : 0, share: signals.channelShare.social, trend: hasData && signals.healthBand === 'critical' ? 'down' as const : hasData ? 'up' as const : 'neutral' as const },
    { channel: 'Direct', sessions: hasData ? Math.round(adBudget * 1.4) : 0, share: signals.channelShare.direct, trend: hasData ? 'up' as const : 'neutral' as const },
    { channel: 'Referral', sessions: hasData ? Math.round(adBudget * 0.4) : 0, share: signals.channelShare.referral, trend: 'neutral' as const },
  ];

  const campaigns = hasData
    ? [
        {
          name: `${client.industry.includes('Moda') ? 'PMax' : 'Search'} - Core Performance`,
          roas: `${Math.max(roas + 1.8, 1.6).toFixed(1)}x`,
          spend: formatMoney(adBudget * 0.44),
        },
        {
          name: `${client.industry.includes('B2B') ? 'LinkedIn' : 'Meta'} - Prospecting`,
          roas: `${Math.max(roas + 1.1, 1.2).toFixed(1)}x`,
          spend: formatMoney(adBudget * 0.24),
        },
        {
          name: 'Brand Search / Retención',
          roas: `${Math.max(roas + 3.2, 2.5).toFixed(1)}x`,
          spend: formatMoney(adBudget * 0.14),
        },
        {
          name: 'Remarketing Dinámico',
          roas: `${Math.max(roas, 1.9).toFixed(1)}x`,
          spend: formatMoney(adBudget * 0.18),
        },
      ]
    : [
        { name: 'Search - Core Performance', roas: '0.0x', spend: formatMoney(0) },
        { name: 'Meta - Prospecting', roas: '0.0x', spend: formatMoney(0) },
        { name: 'Brand Search / Retención', roas: '0.0x', spend: formatMoney(0) },
        { name: 'Remarketing Dinámico', roas: '0.0x', spend: formatMoney(0) },
      ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Tráfico & Ads (GA4 + Ads) · {client.name}</h2>
        <p className="text-slate-500 font-medium">{signals.primaryMessage}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Gasto Ads Estimado</p>
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">{formatMoney(adBudget)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
              {hasData ? (signals.healthBand === 'excellent' ? '+8.2%' : signals.healthBand === 'critical' ? '-7.4%' : '+2.1%') : '0%'}
            </span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Conversiones Ads</p>
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">{formatPlain(conversionsAds)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{hasData ? (signals.healthBand === 'critical' ? '-3.8%' : '+9.6%') : '0%'}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">CPA Global</p>
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">{formatMoney(cpa)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{hasData ? (signals.healthBand === 'critical' ? '-1.1%' : '-6.4%') : '0%'}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">ROAS Combinado</p>
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">{roas > 0 ? `${roas.toFixed(1)}x` : '0.0x'}</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasData && signals.healthBand === 'critical' ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50'}`}>
              {hasData ? (signals.healthBand === 'critical' ? '-2.1%' : '+4.9%') : '0%'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Gasto Publicitario por Canal</h3>
            <p className="text-xs text-slate-400 font-medium">Comparativa de inversión, ritmo y retorno real</p>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-blue-500" />
              <span className="text-xs font-bold text-slate-600">Google Ads</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-full bg-rose-500" />
              <span className="text-xs font-bold text-slate-600">Meta Ads</span>
            </div>
          </div>
        </div>
        <ChartFrame height={350} className="w-full min-w-0" fallback={<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-sm font-medium text-slate-500">Calculando dimensiones del gráfico...</div>}>
          {({ width, height }) => (
            <AreaChart width={width} height={height} data={trafficData}>
              <defs>
                <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorMeta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
              <Area type="monotone" dataKey="google" stroke="#3b82f6" strokeWidth={3} fill="url(#colorGoogle)" />
              <Area type="monotone" dataKey="meta" stroke="#f43f5e" strokeWidth={3} fill="url(#colorMeta)" />
            </AreaChart>
          )}
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Globe className="size-5 text-slate-400" /> Canales de Tráfico (GA4)
          </h3>
          <div className="space-y-4">
            {channels.map((c) => (
              <div key={c.channel} className="space-y-1.5">
                <div className="flex justify-between items-end">
                  <span className="text-sm font-bold text-slate-700">{c.channel}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">{formatPlain(c.sessions)} ses.</span>
                    {c.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : c.trend === 'down' ? <TrendingDown className="size-3 text-rose-500" /> : <BarChart3 className="size-3 text-slate-400" />}
                  </div>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-primary rounded-full transition-all duration-1000" style={{ width: `${c.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Target className="size-5 text-slate-400" /> Campañas con Mejor ROAS
          </h3>
          <div className="space-y-3">
            {campaigns.map((camp) => (
              <div key={camp.name} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div>
                  <p className="text-sm font-bold text-slate-900">{camp.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Inversión: {camp.spend}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-brand-primary">{camp.roas}</p>
                  <span className="text-[10px] text-emerald-600 font-bold">TOP ROAS</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
