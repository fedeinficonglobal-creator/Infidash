import { useEffect, useMemo, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MetricCard, HealthScoreCard } from './DashboardComponents';
import { ArrowDownRight, ArrowUpRight, AlertTriangle, LoaderCircle, RefreshCw, ShoppingCart, UserCheck, Zap } from 'lucide-react';
import { type Client } from '../store/useClientStore';
import { getDailyStats, type DailyStat } from '../services/infidashApi.js';
import { useClientStore } from '../store/useClientStore.js';
import { buildComparisonPeriod, type ComparisonMetric } from '../lib/overviewComparison.js';
import { buildClientSignals, formatMoney, formatPlain } from '../lib/clientSignals.js';

const PERIOD_OPTIONS = [7, 14, 30] as const;
type PeriodOption = (typeof PERIOD_OPTIONS)[number];

function formatDateLabel(statDate: string) {
return new Intl.DateTimeFormat('es-ES', {
day: 'numeric',
month: 'short',
}).format(new Date(`${statDate}T00:00:00`));
}

function formatCurrency(value: number) {
return new Intl.NumberFormat('es-ES', {
style: 'currency',
currency: 'EUR',
maximumFractionDigits: 0,
}).format(value);
}

function formatPercent(value: number) {
return new Intl.NumberFormat('es-ES', {
minimumFractionDigits: 1,
maximumFractionDigits: 1,
}).format(value);
}

function formatComparisonValue(metric: ComparisonMetric) {
switch (metric.key) {
case 'revenue':
return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(metric.current);
case 'roas':
return `${formatPercent(metric.current)}x`;
case 'conversions':
return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(metric.current);
case 'cpa':
return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(metric.current);
}

return '';
}

function formatComparisonPrevious(metric: ComparisonMetric) {
switch (metric.key) {
case 'revenue':
case 'cpa':
return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(metric.previous);
case 'roas':
return `${formatPercent(metric.previous)}x`;
case 'conversions':
return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(metric.previous);
}

return '';
}

function formatComparisonDelta(metric: ComparisonMetric) {
if (metric.percentDelta === null) {
return 'Sin referencia';
}

const sign = metric.percentDelta > 0 ? '+' : '';
const formatted = `${sign}${formatPercent(metric.percentDelta)}%`;
return metric.key === 'cpa' ? `${formatted} vs periodo anterior` : formatted;
}

function ComparisonChip({ metric }: { metric: ComparisonMetric }) {
const isUp = metric.absoluteDelta > 0;
const isNeutral = metric.absoluteDelta === 0 || metric.percentDelta === null;
const trendClass = isNeutral ? 'bg-slate-100 text-slate-500' : isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
const TrendIcon = isNeutral ? RefreshCw : isUp ? ArrowUpRight : ArrowDownRight;

return (
<div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
<div className="flex items-center justify-between gap-3 mb-3">
<p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{metric.label}</p>
<div className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${trendClass}`}>
<TrendIcon className="size-3" />
{formatComparisonDelta(metric)}
</div>
</div>
<div className="flex items-end justify-between gap-4">
<div>
<p className="text-2xl font-bold text-slate-900">{formatComparisonValue(metric)}</p>
<p className="text-xs text-slate-500 mt-1">Previo: {formatComparisonPrevious(metric)}</p>
</div>
</div>
</div>
);
}

export function OverviewTab({ client }: { client: Client }) {
const sessionToken = useClientStore((state) => state.sessionToken);
const setActiveTab = useClientStore((state) => state.setActiveTab);
const signals = useMemo(() => buildClientSignals(client), [client]);
const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
const [isLoadingStats, setIsLoadingStats] = useState(true);
const [statsError, setStatsError] = useState<string | null>(null);
const [comparisonWindow, setComparisonWindow] = useState<PeriodOption>(7);
const chartWrapperRef = useRef<HTMLDivElement | null>(null);
const [chartWidth, setChartWidth] = useState(0);

useEffect(() => {
let cancelled = false;

const loadStats = async () => {
if (!sessionToken) {
if (!cancelled) {
setDailyStats([]);
setIsLoadingStats(false);
}
return;
}

setIsLoadingStats(true);
setStatsError(null);

try {
const response = await getDailyStats(sessionToken, client.id);
if (!cancelled) {
setDailyStats(response.stats.sort((a, b) => a.statDate.localeCompare(b.statDate)));
}
} catch (error) {
if (!cancelled) {
setStatsError(error instanceof Error ? error.message : 'No se pudieron cargar las métricas diarias');
setDailyStats([]);
}
} finally {
if (!cancelled) {
setIsLoadingStats(false);
}
}
};

void loadStats();

return () => {
cancelled = true;
};
}, [client.id, sessionToken]);

const chartData = useMemo(() => {
return dailyStats.slice(-comparisonWindow).map((stat) => ({
name: formatDateLabel(stat.statDate),
sales: stat.revenue,
roas: stat.roas,
}));
}, [comparisonWindow, dailyStats]);

const comparison = useMemo(() => buildComparisonPeriod(dailyStats, comparisonWindow), [dailyStats, comparisonWindow]);

const periodLabel = `Últimos ${comparisonWindow} días`;
const latestStat = dailyStats.at(-1) ?? null;
const firstVisibleStat = chartData[0] ?? null;
const lastVisibleStat = chartData.at(-1) ?? null;
const salesDelta = firstVisibleStat && lastVisibleStat && firstVisibleStat.sales > 0
? ((lastVisibleStat.sales - firstVisibleStat.sales) / firstVisibleStat.sales) * 100
: 0;
const comparisonReady = Boolean(comparison && comparison.currentCount === comparisonWindow && comparison.previousCount === comparisonWindow);

useEffect(() => {
  const element = chartWrapperRef.current;
  if (!element) {
    return;
  }

  const updateSize = () => {
    setChartWidth(element.clientWidth);
  };

  updateSize();
  const observer = new ResizeObserver(() => updateSize());
  observer.observe(element);

  return () => observer.disconnect();
}, [client.id, comparisonWindow, dailyStats.length]);

return (
<div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
<header className="flex items-center justify-between mb-8">
<div>
<div className="flex items-center gap-3 mb-1">
<h2 className="text-3xl font-bold text-slate-900">Dashboard Overview</h2>
<span className="bg-brand-primary/10 text-brand-primary text-[10px] font-bold px-2 py-1 rounded-md">DATOS REAL-TIME</span>
</div>
<p className="text-slate-500 font-medium">
Análisis consolidado para <span className="text-slate-900 font-bold">{client.name}</span>
{latestStat && (
<span className="ml-2 text-xs text-slate-400">
· Último dato: {formatDateLabel(latestStat.statDate)}
</span>
)}
</p>
</div>
<div className="flex items-center gap-3">
<button className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">
Personalizar Dashboard
</button>
<div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
{PERIOD_OPTIONS.map((option) => (
<button
key={option}
type="button"
onClick={() => setComparisonWindow(option)}
className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${comparisonWindow === option ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
>
{option}d
</button>
))}
</div>
</div>
</header>

{/* KPI Grid */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
<MetricCard metric={client.metrics.revenue} />
<MetricCard metric={client.metrics.roas} />
<MetricCard metric={client.metrics.conversions} />
<MetricCard metric={client.metrics.cpa} />
</div>

<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
{/* Main Chart */}
<div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
<div className="flex items-center justify-between mb-8">
<div>
<h3 className="text-lg font-bold text-slate-900">Rendimiento de Ventas & ROAS</h3>
<p className="text-xs text-slate-400 font-medium tracking-wide">{periodLabel.toUpperCase()} FRENTE AL MISMO PERIODO ANTERIOR</p>
</div>
<div className="flex items-center gap-4">
<div className="flex items-center gap-2">
<div className="size-3 rounded-full bg-brand-primary" />
<span className="text-xs font-bold text-slate-600">Ventas (€)</span>
</div>
<div className="flex items-center gap-2">
<div className="size-3 rounded-full bg-brand-secondary" />
<span className="text-xs font-bold text-slate-600">ROAS</span>
</div>
</div>
</div>

<div ref={chartWrapperRef} className="h-[300px] w-full min-w-0">
{isLoadingStats ? (
<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200">
<div className="flex items-center gap-3 text-slate-500">
<LoaderCircle className="size-5 animate-spin text-brand-primary" />
<span className="text-sm font-medium">Cargando métricas diarias...</span>
</div>
</div>
) : statsError ? (
<div className="h-full flex items-center justify-center rounded-2xl bg-rose-50 border border-dashed border-rose-200 px-6 text-center">
<div>
<p className="text-sm font-bold text-rose-700">No se pudieron cargar las métricas</p>
<p className="text-xs text-rose-500 mt-1">{statsError}</p>
</div>
</div>
) : chartData.length === 0 ? (
<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 px-6 text-center">
<div>
<p className="text-sm font-bold text-slate-700">Aún no hay métricas diarias</p>
<p className="text-xs text-slate-400 mt-1">Cuando el equipo registre datos, aquí verás la evolución real del cliente.</p>
</div>
</div>
) : chartWidth > 0 ? (
<ResponsiveContainer width="100%" height="100%">
<AreaChart data={chartData}>
<defs>
<linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
<stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.12}/>
<stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
</linearGradient>
</defs>
<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
<XAxis
dataKey="name"
axisLine={false}
tickLine={false}
tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }}
dy={10}
/>
<YAxis
axisLine={false}
tickLine={false}
tick={{ fontSize: 10, fontWeight: 600, fill: '#94a3b8' }}
/>
<Tooltip
contentStyle={{
borderRadius: '12px',
border: 'none',
boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
fontSize: '12px'
}}
formatter={(value, name) => [name === 'sales' ? formatCurrency(Number(value)) : `${formatPercent(Number(value))}x`, name === 'sales' ? 'Ventas' : 'ROAS']}
/>
<Area type="monotone" dataKey="sales" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
<Area type="monotone" dataKey="roas" stroke="#6366f1" strokeWidth={3} fill="none" strokeDasharray="5 5" />
</AreaChart>
</ResponsiveContainer>
) : (
<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 px-6 text-center">
<div>
<p className="text-sm font-bold text-slate-700">Calculando dimensiones del gráfico...</p>
</div>
</div>
)}
</div>

{chartData.length > 1 && (
<div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
<span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">
Cambio ventas: {salesDelta >= 0 ? '+' : ''}{formatPercent(salesDelta)}%
</span>
{latestStat && (
<span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">
ROAS último dato: {formatPercent(latestStat.roas)}x
</span>
)}
</div>
)}
</div>

{/* Health Score & AI Quick Insight */}
<div className="space-y-6">
<HealthScoreCard score={client.health} />

<div className="bg-slate-900 p-6 rounded-2xl text-white relative overflow-hidden group">
<div className="relative z-10">
<div className="flex items-center gap-2 mb-4">
<Zap className="size-5 text-amber-400 fill-amber-400" />
<h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">AI Insight Activo</h3>
</div>
<p className="text-sm leading-relaxed mb-4">
{signals.healthBand === 'excellent'
  ? `La cartera de ${client.name} está en un punto fuerte: ${formatMoney(signals.revenue)} de revenue y ${signals.roas.toFixed(1)}x de ROAS.`
  : signals.healthBand === 'stable'
    ? `La cuenta de ${client.name} mantiene una base estable. Conviene revisar creatividad y foco de campañas para sostener el ritmo.`
    : signals.healthBand === 'risk'
      ? `Hay señales de presión en ${client.name}. El foco debería ir a CPA, audiencias y velocidad de respuesta.`
      : `La cuenta de ${client.name} necesita una intervención prioritaria antes de seguir escalando inversión.`}
</p>
<p className="text-xs text-slate-300 leading-relaxed mb-6">
Recomendación: {signals.actionMessage}
</p>
<button type="button" onClick={() => setActiveTab('ai')} className="w-full bg-white text-slate-900 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
Ver recomendación prioritaria <ArrowUpRight className="size-3" />
</button>
</div>
<div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
<Zap className="size-24" />
</div>
</div>
</div>
</div>

<div className="mb-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
<div className="flex items-center justify-between gap-4 mb-6">
<div>
<h3 className="text-lg font-bold text-slate-900">Comparador periodo actual vs anterior</h3>
<p className="text-xs text-slate-400 font-medium tracking-wide">{periodLabel.toUpperCase()} FRENTE A LOS {comparisonWindow} DÍAS ANTERIORES</p>
</div>
<div className="text-right text-xs text-slate-500">
{comparisonReady && comparison ? (
<>
<p className="font-semibold text-slate-700">Actual: {comparison.currentCount} días</p>
<p>Previo: {comparison.previousCount} días</p>
</>
) : (
<p>Se necesitan al menos {comparisonWindow * 2} días para comparar este periodo</p>
)}
</div>
</div>

{comparisonReady && comparison ? (
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
{comparison.metrics.map((metric) => (
<div key={metric.key}>
<ComparisonChip metric={metric} />
</div>
))}
</div>
) : (
<div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
<p className="text-sm font-semibold text-slate-700">Aún no hay suficientes métricas para este comparador</p>
<p className="text-xs text-slate-400 mt-1">Carga al menos {comparisonWindow * 2} días para ver la comparación {comparisonWindow} vs {comparisonWindow}.</p>
</div>
)}
</div>

{/* Bottom Row - Mini Alerts & Stats */}
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
{(client.activeTabs?.includes('sales')) && (
<div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4">
<div className="size-12 bg-emerald-50 rounded-xl flex items-center justify-center">
<ShoppingCart className="size-6 text-emerald-600" />
</div>
<div>
<p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Carritos Abandonados</p>
<div className="flex items-center gap-2">
<h4 className="text-xl font-bold">12.4%</h4>
<span className="text-[10px] text-emerald-600 font-bold">-2.1% ptos</span>
</div>
</div>
</div>
)}

{(client.activeTabs?.includes('leads')) && (
<div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4">
<div className="size-12 bg-blue-50 rounded-xl flex items-center justify-center">
<UserCheck className="size-6 text-blue-600" />
</div>
<div>
<p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leads Totales</p>
<div className="flex items-center gap-2">
<h4 className="text-xl font-bold">452</h4>
<span className="text-[10px] text-blue-600 font-bold">+15.2%</span>
</div>
</div>
</div>
)}

<div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4">
<div className="size-12 bg-rose-50 rounded-xl flex items-center justify-center">
<AlertTriangle className="size-6 text-rose-600" />
</div>
<div>
<p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Problemas UX Detectados</p>
<div className="flex items-center gap-2">
<h4 className="text-xl font-bold">3</h4>
<span className="text-[10px] text-rose-600 font-bold">Críticos</span>
</div>
</div>
</div>
</div>
</div>
);
}
