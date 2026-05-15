import { SearchCode, TrendingUp, TrendingDown, ExternalLink, MousePointer2, Eye } from 'lucide-react';
import { type Client } from '../store/useClientStore';

const dummyQueries = [
  { query: 'vestidos de fiesta mujer', clicks: 1240, impressions: 15400, pos: 3.2, change: -0.4 },
  { query: 'tienda ropa mujer online', clicks: 842, impressions: 24500, pos: 5.8, change: 1.2 },
  { query: 'calzado primavera 2024', clicks: 641, impressions: 8200, pos: 2.1, change: -1.5 },
  { query: 'bolsos de piel rebajas', clicks: 432, impressions: 5100, pos: 4.5, change: 0.2 },
  { query: 'moda eco friendly españa', clicks: 215, impressions: 3200, pos: 12.4, change: -4.1 },
];

export function SeoTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">SEO (Search Console)</h2>
        <p className="text-slate-500 font-medium">Análisis de visibilidad, keywords y tráfico orgánico.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Clicks Totales</p>
               <h3 className="text-2xl font-bold">18.4K</h3>
            </div>
            <div className="size-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
               <MousePointer2 className="size-6" />
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Impresiones</p>
               <h3 className="text-2xl font-bold">245K</h3>
            </div>
            <div className="size-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
               <Eye className="size-6" />
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">CTR Medio</p>
               <h3 className="text-2xl font-bold">7.5%</h3>
            </div>
            <div className="size-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
               <TrendingUp className="size-6" />
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Posición Media</p>
               <h3 className="text-2xl font-bold">5.8</h3>
            </div>
            <div className="size-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
               <SearchCode className="size-6" />
            </div>
         </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-8">
         <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Keywords Principales</h3>
            <button className="text-brand-primary text-xs font-bold hover:underline">Ver todas las queries</button>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-left">
               <thead>
                  <tr className="bg-slate-50">
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Query</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Clicks</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Impresiones</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">CTR</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Posición</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {dummyQueries.map((q) => (
                     <tr key={q.query} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">{q.query}</span>
                              <ExternalLink className="size-3 text-slate-300" />
                           </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-slate-600">{q.clicks.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-slate-400">{q.impressions.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">{((q.clicks / q.impressions) * 100).toFixed(1)}%</td>
                        <td className="px-6 py-4 text-right">
                           <div className="flex items-center justify-end gap-2">
                              <span className="text-sm font-bold text-slate-900">{q.pos}</span>
                              {q.change < 0 ? (
                                 <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded">↑ {Math.abs(q.change)}</span>
                              ) : (
                                 <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1 py-0.5 rounded">↓ {q.change}</span>
                              )}
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-2xl relative overflow-hidden">
            <h3 className="text-lg font-bold text-emerald-900 mb-2">Quick Win: Optimización de Meta Tags</h3>
            <p className="text-sm text-emerald-700 leading-relaxed mb-6">
               Detectadas 12 páginas con CTR inferior al 1.5% a pesar de estar en el Top 5. Ajustar el Title y Meta Description podría aumentar el tráfico orgánico en un ~15%.
            </p>
            <button className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors">
               Ver Páginas Recomendadas
            </button>
            <SearchCode className="absolute -right-4 -bottom-4 size-24 text-emerald-100" />
         </div>

         <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl relative overflow-hidden">
            <h3 className="text-lg font-bold text-blue-900 mb-2">Canibalización Detectada</h3>
            <p className="text-sm text-blue-700 leading-relaxed mb-6">
               Las páginas "/coleccion-verano" y "/vestidos-fiesta" están compitiendo por la misma keyword "vestidos fiesta verano". Recomendamos unificarlas o pivotar contenidos.
            </p>
            <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors">
               Analizar Canibalización
            </button>
         </div>
      </div>
    </div>
  );
}
