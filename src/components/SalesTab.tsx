import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ShoppingBag, TrendingUp, Users, Package, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { ChartFrame } from './ChartFrame';
import { type Client } from '../store/useClientStore';
import { buildClientSignals, formatMoney, formatPlain } from '../lib/clientSignals.js';

const baseSalesData = [
  { name: 'Lun', sales: 4200 },
  { name: 'Mar', sales: 3800 },
  { name: 'Mie', sales: 5100 },
  { name: 'Jue', sales: 4600 },
  { name: 'Vie', sales: 6200 },
  { name: 'Sab', sales: 7500 },
  { name: 'Dom', sales: 6800 },
];

const CATEGORY_PRESETS = {
  moda: [
    { name: 'Vestidos', value: 400 },
    { name: 'Zapatos', value: 300 },
    { name: 'Bolsos', value: 300 },
    { name: 'Accesorios', value: 200 },
  ],
  b2b: [
    { name: 'Leads cualificados', value: 360 },
    { name: 'Demos', value: 260 },
    { name: 'Retención', value: 220 },
    { name: 'Upsell', value: 160 },
  ],
  default: [
    { name: 'Top Sellers', value: 360 },
    { name: 'Bundles', value: 260 },
    { name: 'Cross-sell', value: 220 },
    { name: 'Otros', value: 160 },
  ],
};

const COLORS = ['#0ea5e9', '#6366f1', '#f43f5e', '#fbbf24'];

function getCategoryPreset(industry: string) {
  const text = industry.toLowerCase();
  if (text.includes('moda') || text.includes('joyer')) return CATEGORY_PRESETS.moda;
  if (text.includes('b2b') || text.includes('industrial') || text.includes('servicio')) return CATEGORY_PRESETS.b2b;
  return CATEGORY_PRESETS.default;
}

export function SalesTab({ client }: { client: Client }) {
  const signals = buildClientSignals(client);
  const hasData = signals.hasData;
  const scale = hasData ? Math.max(signals.revenue / 52430, 0.35) : 0;
  const salesData = baseSalesData.map((item) => ({
    ...item,
    sales: hasData ? Math.round(item.sales * scale) : 0,
  }));
  const categoryData = getCategoryPreset(client.industry).map((item) => ({
    ...item,
    value: hasData ? item.value : 0,
  }));
  const averageOrderValue = hasData && signals.conversions > 0 ? signals.revenue / signals.conversions : 0;
  const recoverableRevenue = hasData
    ? Math.round(Math.max(signals.revenue * (signals.healthBand === 'critical' ? 0.14 : signals.healthBand === 'risk' ? 0.1 : 0.06), 0))
    : 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Rendimiento WooCommerce · {client.name}</h2>
        <p className="text-slate-500 font-medium">
          {hasData ? `${signals.primaryMessage} ${signals.actionMessage}` : signals.primaryMessage}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4 text-emerald-600">
            <TrendingUp className="size-5" />
            <span className="text-xs font-bold uppercase tracking-widest">Ingresos Totales</span>
          </div>
            <h3 className="text-2xl font-bold">{formatMoney(hasData ? signals.revenue : 0)}</h3>
<p className="text-xs text-slate-400 mt-1">Basado en las métricas reales del cliente</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4 text-blue-600">
            <Package className="size-5" />
            <span className="text-xs font-bold uppercase tracking-widest">Pedidos</span>
          </div>
            <h3 className="text-2xl font-bold">{formatPlain(hasData ? signals.conversions : 0)}</h3>
            <p className="text-xs text-slate-400 mt-1">{hasData && signals.roas > 0 ? `ROAS actual ${signals.roas.toFixed(1)}x` : 'Sin ROAS registrado todavía'}</p>
</div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4 text-amber-600">
            <Users className="size-5" />
            <span className="text-xs font-bold uppercase tracking-widest">Ticket Medio (AOV)</span>
          </div>
          <h3 className="text-2xl font-bold">{formatMoney(averageOrderValue)}</h3>
          <p className="text-xs text-slate-400 mt-1">Potencial recuperable hoy: {formatMoney(recoverableRevenue)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-2">Ventas por Día</h3>
          <p className="text-xs text-slate-400 font-medium mb-6">Escalado sobre el ritmo real del cliente en esta cartera.</p>
          <ChartFrame height={300} className="w-full min-w-0" fallback={<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-sm font-medium text-slate-500">Calculando dimensiones del gráfico...</div>}>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                  <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Categorías Top</h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <ChartFrame height={300} className="w-full min-w-0 flex items-center justify-center" fallback={<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-sm font-medium text-slate-500">Calculando dimensiones del gráfico...</div>}>
              {() => (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartFrame>
            <div className="space-y-2">
              {categoryData.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2">
                  <div className="size-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                  <span className="text-xs font-bold text-slate-600 truncate w-24">{c.name}</span>
                  <span className="text-xs font-medium text-slate-400">{Math.round((c.value / 12) * scale)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-10 bg-rose-500 rounded-xl flex items-center justify-center text-white">
              <ArrowDownRight className="size-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-rose-900">Oportunidad de recuperación</h3>
              <p className="text-sm text-rose-700">{signals.riskMessage}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-rose-900">{formatMoney(recoverableRevenue)}</p>
            <p className="text-xs text-rose-600 font-bold uppercase">Potencial recuperable</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-700">
          <ArrowUpRight className="size-4" />
          <span>{signals.actionMessage}</span>
        </div>
      </div>
    </div>
  );
}
