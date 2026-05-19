import { Sparkles, AlertCircle, TrendingUp, Lightbulb, MessageSquare, ArrowRight, Target, BarChart3 } from 'lucide-react';
import { type Client } from '../store/useClientStore.js';
import { useClientStore } from '../store/useClientStore.js';
import { buildAiInsightPlan } from '../lib/aiInsights.js';
import { buildClientSignals, formatMoney, formatPlain } from '../lib/clientSignals.js';
import { cn } from '../lib/utils';

export function AiInsightsTab({ client }: { client: Client }) {
  const setActiveTab = useClientStore((state) => state.setActiveTab);
  const signals = buildClientSignals(client);
  const plan = buildAiInsightPlan(client);

  const contentIdeas = plan.contentPillars.map((pillar, index) => {
    const prefix = index === 0 ? 'Vídeo corto' : index === 1 ? 'Carousel' : 'Story';
    return `${prefix}: ${pillar} · ${signals.healthBand === 'critical' ? 'prioridad recuperación' : 'enfoque conversión'}`;
  });

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1 flex items-center gap-3">
            Insights Inteligentes <Sparkles className="size-6 text-brand-primary fill-brand-primary/20" />
          </h2>
          <p className="text-slate-500 font-medium uppercase text-xs tracking-widest">
            {client.name} · {signals.healthBand === 'excellent' ? 'Señal positiva' : signals.healthBand === 'stable' ? 'Estabilidad operativa' : signals.healthBand === 'risk' ? 'Atención táctica' : 'Zona crítica'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-200"
        >
          Volver al Overview <ArrowRight className="size-4 text-amber-400" />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <AlertCircle className="size-4 text-rose-500" /> Diagnóstico de Salud
          </h3>
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            <div className={cn('p-4 rounded-2xl border', signals.healthBand === 'critical' ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100')}>
              <h4 className={cn('text-sm font-bold mb-1', signals.healthBand === 'critical' ? 'text-rose-900' : 'text-slate-900')}>Señal prioritaria</h4>
              <p className={cn('text-xs leading-relaxed', signals.healthBand === 'critical' ? 'text-rose-700' : 'text-slate-600')}>{signals.riskMessage}</p>
            </div>
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <h4 className="text-sm font-bold text-emerald-900 mb-1">Oportunidad de scaling</h4>
              <p className="text-xs text-emerald-700 leading-relaxed">
                {client.name} puede escalar con criterio mientras se protege el CPA. {signals.actionMessage}
              </p>
            </div>
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <h4 className="text-sm font-bold text-blue-900 mb-1 flex items-center gap-2">
                <Target className="size-4" /> Foco de presupuesto
              </h4>
              <p className="text-xs text-blue-700 leading-relaxed">{plan.budgetFocus}</p>
            </div>
          </div>

          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Lightbulb className="size-4 text-amber-500" /> Ideas de Contenido
          </h3>
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            {contentIdeas.map((idea, i) => (
              <div key={idea} className="flex gap-3 group cursor-pointer hover:bg-slate-50 p-2 rounded-xl transition-colors text-left w-full">
                <div className="size-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-brand-primary transition-colors shrink-0">
                  <MessageSquare className="size-4" />
                </div>
                <p className="text-sm font-medium text-slate-600 flex-1 leading-tight">{idea}</p>
                <ArrowRight className="size-4 text-slate-200 group-hover:text-slate-400 group-hover:translate-x-1 transition-all shrink-0" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Sparkles className="size-4 text-brand-primary" /> Resumen Ejecutivo IA
          </h3>
          <div className={cn('p-8 rounded-[2rem] shadow-2xl relative overflow-hidden text-white', signals.healthBand === 'critical' ? 'bg-rose-950' : 'bg-slate-900')}>
            <div className="relative z-10 space-y-6 text-slate-300">
              <div className="flex items-center gap-2 text-white">
                <TrendingUp className="size-5 text-emerald-400" />
                <h4 className="text-lg font-bold">{plan.title}</h4>
              </div>
              <p className="text-sm leading-relaxed">
                {client.name} está operando con {formatMoney(signals.revenue)} de revenue y {formatPlain(signals.conversions)} conversiones visibles. El ROAS actual es de {signals.roas.toFixed(1)}x.
              </p>
              <p className="text-sm leading-relaxed">{plan.summary}</p>
              <div className="pt-4 border-t border-white/10 space-y-3">
                <h5 className="text-xs font-bold text-white uppercase tracking-widest">Prioridades de acción</h5>
                <ul className="text-xs space-y-2">
                  {plan.priorityItems.map((item) => (
                    <li key={item} className="flex gap-2">
                      <div className="size-1.5 rounded-full bg-brand-primary mt-1" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-4 border-t border-white/10 space-y-3">
                <h5 className="text-xs font-bold text-white uppercase tracking-widest">Pilares creativos</h5>
                <div className="flex flex-wrap gap-2">
                  {plan.contentPillars.map((pillar) => (
                    <span key={pillar} className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold tracking-wide text-white/90">
                      {pillar}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="absolute top-0 right-0 size-64 bg-brand-secondary/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 size-64 bg-brand-primary/10 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-3">
                <BarChart3 className="size-4 text-slate-400" /> Ritmo de ejecución
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">Mantén el foco en {signals.healthBand === 'excellent' ? 'escala controlada' : 'corrección de prioridades'} para no perder eficiencia en el corto plazo.</p>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-3">
                <Sparkles className="size-4 text-brand-primary" /> Próximo paso
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">Cierra el ciclo en el overview y vuelve aquí para revisar el plan de acción recomendado.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
