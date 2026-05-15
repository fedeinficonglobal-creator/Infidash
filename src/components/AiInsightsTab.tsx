import { Zap, Sparkles, AlertCircle, TrendingUp, Lightbulb, MessageSquare, ArrowRight } from 'lucide-react';
import { type Client } from '../store/useClientStore';

export function AiInsightsTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold text-slate-900 mb-1 flex items-center gap-3">
              Insights Inteligentes <Sparkles className="size-6 text-brand-primary fill-brand-primary/20" />
           </h2>
           <p className="text-slate-500 font-medium uppercase text-xs tracking-widest">Motor: Gemini 1.5 Pro</p>
        </div>
        <button className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-200">
           Refrescar Análisis <Zap className="size-4 text-amber-400 fill-amber-400" />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         {/* Critical Alerts */}
         <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
               <AlertCircle className="size-4 text-rose-500" /> Diagnóstico de Salud
            </h3>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
               <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                  <h4 className="text-sm font-bold text-rose-900 mb-1">Fatiga de Ad-Set Detectada</h4>
                  <p className="text-xs text-rose-700 leading-relaxed">
                     El CTR de la audiencia "Intereses: Moda Lujo" ha caído un 22% esta semana. La frecuencia ha subido a 4.2. Recomendamos rotar creatividades inmediatamente.
                  </p>
               </div>
               <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <h4 className="text-sm font-bold text-emerald-900 mb-1">Oportunidad de Scaling</h4>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                     La campaña de Google Ads de búsqueda "Vestidos de Verano" mantiene un ROAS de 8.2x con una cuota de impresiones del 45%. Hay margen para duplicar presupuesto.
                  </p>
               </div>
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
               <Lightbulb className="size-4 text-amber-500" /> Ideas de Contenido
            </h3>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
               {[
                  'Video corto: "3 formas de combinar nuestro bolso top ventas" (Basado en volumen de búsqueda)',
                  'Blog post: "Por qué la moda eco-friendly es el futuro en España" (Basado en queries de Search Console)',
                  'Newsletter: Recuperación de carritos con código "MODASETG" (Basado en anomalía carritos abandonados)',
               ].map((idea, i) => (
                  <div key={i} className="flex gap-3 group cursor-pointer hover:bg-slate-50 p-2 rounded-xl transition-colors text-left w-full">
                     <div className="size-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:text-brand-primary transition-colors shrink-0">
                        <MessageSquare className="size-4" />
                     </div>
                     <p className="text-sm font-medium text-slate-600 flex-1 leading-tight">{idea}</p>
                     <ArrowRight className="size-4 text-slate-200 group-hover:text-slate-400 group-hover:translate-x-1 transition-all shrink-0" />
                  </div>
               ))}
            </div>
         </div>

         {/* Executive Summary */}
         <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
               <Sparkles className="size-4 text-brand-primary" /> Resumen Ejecutivo IA
            </h3>
            <div className="bg-slate-900 text-white p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
               <div className="relative z-10 space-y-6 text-slate-300">
                  <div className="flex items-center gap-2 text-white">
                     <TrendingUp className="size-5 text-emerald-400" />
                     <h4 className="text-lg font-bold">Rendimiento Excepcional</h4>
                  </div>
                  <p className="text-sm leading-relaxed">
                     Estimado Consultor, <span className="text-white font-bold">{client.name}</span> está operando con una eficiencia del <span className="text-brand-primary font-bold">84%</span>. 
                     El principal motor de crecimiento este mes ha sido la retención de clientes antiguos vía Email Marketing, superando al tráfico pagado por primera vez en el trimestre.
                  </p>
                  <p className="text-sm leading-relaxed">
                     Sin embargo, el margen neto está siendo presionado por el aumento del CPC en Google Shopping. Se aconseja una revisión de la estrategia de biding a "Target ROAS" para optimizar el spend.
                  </p>
                  <div className="pt-4 border-t border-white/10 space-y-3">
                     <h5 className="text-xs font-bold text-white uppercase tracking-widest">Próximos Pasos Sugeridos:</h5>
                     <ul className="text-xs space-y-2">
                        <li className="flex gap-2">
                           <div className="size-1.5 rounded-full bg-brand-primary mt-1" />
                           <span>Pausar ad-set "Lujo Madrid" (ROAS inferior a 1.5x)</span>
                        </li>
                        <li className="flex gap-2">
                           <div className="size-1.5 rounded-full bg-brand-primary mt-1" />
                           <span>Activar flujo de Win-back en Klaviyo para clientes de &gt;90 días.</span>
                        </li>
                     </ul>
                  </div>
               </div>
               
               {/* Decorative Gradient */}
               <div className="absolute top-0 right-0 size-64 bg-brand-secondary/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
               <div className="absolute bottom-0 left-0 size-64 bg-brand-primary/10 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2" />
            </div>
         </div>
      </div>
    </div>
  );
}
