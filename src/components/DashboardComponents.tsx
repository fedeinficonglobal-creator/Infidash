import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';
import { type Metric } from '../store/useClientStore';

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-slate-500">{metric.label}</p>
        <div className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold",
          metric.trend === 'up' ? "bg-emerald-50 text-emerald-600" : 
          metric.trend === 'down' ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"
        )}>
          {metric.trend === 'up' ? <TrendingUp className="size-3" /> : 
           metric.trend === 'down' ? <TrendingDown className="size-3" /> : <Minus className="size-3" />}
          {metric.change > 0 ? '+' : ''}{metric.change}%
        </div>
      </div>
      <div className="flex items-end justify-between">
        <h3 className="text-2xl font-bold font-display text-slate-900">{metric.value}</h3>
      </div>
      <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">vs Periodo Anterior</span>
        <div className="size-2 rounded-full bg-slate-200" />
      </div>
    </div>
  );
}

export function HealthScoreCard({ score }: { score: number }) {
  const getStatus = (s: number) => {
    if (s > 80) return { label: 'Excelente', color: 'text-emerald-500', bg: 'bg-emerald-500', sub: 'Todo funcionando correctamente.' };
    if (s > 65) return { label: 'Estable', color: 'text-blue-500', bg: 'bg-blue-500', sub: 'Rendimiento dentro de lo esperado.' };
    if (s > 40) return { label: 'En Riesgo', color: 'text-amber-500', bg: 'bg-amber-500', sub: 'Se detectaron anomalías en ads.' };
    return { label: 'Crítico', color: 'text-rose-500', bg: 'bg-rose-500', sub: 'Intervención inmediata requerida.' };
  };

  const status = getStatus(score);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden flex flex-col justify-between">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-600">Client Health Score</h3>
          <span className={cn("text-xs font-bold px-2 py-1 rounded-md bg-opacity-10", status.bg.replace('bg-', 'bg-opacity-10 '), status.color)}>
            {status.label}
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-6 font-medium">{status.sub}</p>
      </div>

      <div className="flex items-center gap-6 relative z-10">
        <div className="relative size-24">
          <svg className="size-full -rotate-90 transform" viewBox="0 0 100 100">
            <circle
              className="text-slate-100"
              strokeWidth="10"
              stroke="currentColor"
              fill="transparent"
              r="40"
              cx="50"
              cy="50"
            />
            <circle
              className={status.color.replace('text-', 'stroke-')}
              strokeWidth="10"
              strokeDasharray={251.2}
              strokeDashoffset={251.2 - (251.2 * score) / 100}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
              r="40"
              cx="50"
              cy="50"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold font-display">{score}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
           <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-400">SALES</span>
              <span>{(score / 10).toFixed(1)}/10</span>
           </div>
           <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(Math.min(score, 100), 0)}%` }} />
           </div>
           <div className="flex justify-between text-[10px] font-bold">
              <span className="text-slate-400">ADS</span>
              <span>{(Math.max(score - 40, 0) / 10).toFixed(1)}/10</span>
           </div>
           <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.max(Math.min(score - 40, 100), 0)}%` }} />
           </div>
        </div>
      </div>
      
      {/* Background decoration */}
      <div className={cn("absolute -right-4 -bottom-4 size-24 rounded-full blur-3xl opacity-10", status.bg)} />
    </div>
  );
}
