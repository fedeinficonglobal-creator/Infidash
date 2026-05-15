import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { MetricCard, HealthScoreCard } from './DashboardComponents';
import { Zap, ArrowUpRight, ShoppingCart, UserCheck, AlertTriangle } from 'lucide-react';
import { type Client } from '../store/useClientStore';

const dummyChartData = [
  { name: '1 May', sales: 1200, roas: 4.2 },
  { name: '5 May', sales: 1900, roas: 4.5 },
  { name: '10 May', sales: 1500, roas: 4.1 },
  { name: '15 May', sales: 2200, roas: 4.8 },
  { name: '20 May', sales: 2800, roas: 5.2 },
  { name: '25 May', sales: 2100, roas: 4.6 },
  { name: '30 May', sales: 2430, roas: 4.8 },
];

export function OverviewTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
             <h2 className="text-3xl font-bold text-slate-900">Dashboard Overview</h2>
             <span className="bg-brand-primary/10 text-brand-primary text-[10px] font-bold px-2 py-1 rounded-md">DATOS REAL-TIME</span>
          </div>
          <p className="text-slate-500 font-medium">Análisis consolidado para <span className="text-slate-900 font-bold">{client.name}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">
            Personalizar Dashboard
          </button>
          <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2">
            Últimos 30 días
          </button>
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
              <p className="text-xs text-slate-400 font-medium tracking-wide">TENDENCIA DE LOS ÚLTIMOS 30 DÍAS</p>
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
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dummyChartData}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1}/>
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
                />
                <Area type="monotone" dataKey="sales" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                <Area type="monotone" dataKey="roas" stroke="#6366f1" strokeWidth={3} fill="none" dashArray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Health Score & AI Quick Insight */}
        <div className="space-y-6">
          <HealthScoreCard score={client.health} />
          
          <div className="bg-slate-900 p-6 rounded-2xl text-white relative overflow-hidden group">
             <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                   <Zap className="size-5 text-amber-400 fill-amber-400" />
                   <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">AI Instant Insight</h3>
                </div>
                <p className="text-sm leading-relaxed mb-6">
                  Hemos detectado que el <span className="text-amber-400 font-bold">ROAS de Meta Ads</span> es un 40% superior al de Google Ads en la campaña "Summer Sale". 
                  Recomendamos reasignar <span className="text-white font-bold">2.500€</span> de presupuesto hoy mismo.
                </p>
                <button className="w-full bg-white text-slate-900 py-2 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
                  Aplicar Recomendación <ArrowUpRight className="size-3" />
                </button>
             </div>
             <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                <Zap className="size-24" />
             </div>
          </div>
        </div>
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
