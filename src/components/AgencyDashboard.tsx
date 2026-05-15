import { useState } from 'react';
import { useClientStore } from '../store/useClientStore';
import { LayoutGrid, List, Plus, Search, Filter, TrendingUp, TrendingDown, Minus, ArrowRight, X } from 'lucide-react';
import { cn } from '../lib/utils';

export function AgencyDashboard() {
  const { clients, setActiveClient, addClient } = useClientStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isNewClientModalOpen, setNewClientModalOpen] = useState(false);
  
  const [newClientForm, setNewClientForm] = useState({
    name: '',
    industry: '',
    logo: ''
  });

  const handleAddNewClient = (e: React.FormEvent) => {
    e.preventDefault();
    addClient({
      name: newClientForm.name,
      industry: newClientForm.industry || 'General',
      logo: newClientForm.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(newClientForm.name)}&background=random`
    });
    setNewClientModalOpen(false);
    setNewClientForm({ name: '', industry: '', logo: '' });
  };
  
  const totalRevenue = clients.reduce((acc, client) => {
    // Basic parse for mock values like "52.430 €" to numbers
    const num = parseFloat(client.metrics.revenue.value.toString().replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
    return acc + (isNaN(num) ? 0 : num);
  }, 0);

  const avgHealth = Math.round(clients.reduce((acc, client) => acc + client.health, 0) / (clients.length || 1));

  const getHealthStatus = (score: number) => {
    if (score >= 80) return { label: 'Excelente', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' };
    if (score >= 65) return { label: 'Estable', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' };
    if (score >= 40) return { label: 'En Riesgo', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200' };
    return { label: 'Crítico', bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500', border: 'border-rose-200' };
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold text-slate-900 mb-1">Dashboard General</h2>
           <p className="text-slate-500 font-medium">Gestión integral de cartera y métricas globales de la agencia.</p>
        </div>
        <button 
           onClick={() => setNewClientModalOpen(true)}
           className="bg-brand-primary text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20"
        >
           <Plus className="size-4" /> Nuevo Cliente
        </button>
      </header>

      {/* Global Agency Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Clientes Activos</h3>
            <div className="flex items-end justify-between">
               <span className="text-3xl font-bold text-slate-900">{clients.length}</span>
               <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">+2 este mes</span>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Revenue Gestionado (30d)</h3>
            <div className="flex items-end justify-between">
               <span className="text-3xl font-bold text-slate-900">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalRevenue)}</span>
               <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">+14.2%</span>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Health Score Medio</h3>
            <div className="flex items-center gap-4">
               <div className="relative size-12 flex-shrink-0">
                  <svg className="size-full -rotate-90 transform" viewBox="0 0 100 100">
                    <circle className="text-slate-100" strokeWidth="8" stroke="currentColor" fill="transparent" r="40" cx="50" cy="50" />
                    <circle 
                      className={cn(avgHealth > 70 ? 'stroke-emerald-500' : avgHealth > 50 ? 'stroke-amber-500' : 'stroke-rose-500')} 
                      strokeWidth="8" strokeDasharray={251.2} strokeDashoffset={251.2 - (251.2 * avgHealth) / 100} strokeLinecap="round" stroke="currentColor" fill="transparent" r="40" cx="50" cy="50" 
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold">{avgHealth}</span>
                  </div>
               </div>
               <div>
                  <p className="text-sm font-bold text-slate-700">Estado Estable</p>
                  <p className="text-[10px] text-slate-400 font-medium">1 cliente en riesgo crítico</p>
               </div>
            </div>
         </div>
         <div className="bg-brand-primary p-6 rounded-2xl shadow-[0_8px_30px_rgba(14,165,233,0.3)] flex flex-col justify-between text-white relative overflow-hidden group cursor-pointer">
            <div className="relative z-10">
               <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/80 mb-2">Insights de Agencia</h3>
               <p className="text-sm font-medium leading-relaxed">Se detectó una caída general del CTR en campañas de Meta en 3 clientes.</p>
               <div className="mt-4 inline-flex items-center gap-1 text-xs font-bold bg-white/20 px-2 py-1 rounded">
                  Ver Análisis Completo <ArrowRight className="size-3" />
               </div>
            </div>
            <TrendingDown className="absolute -right-4 -bottom-4 size-24 text-white opacity-10 group-hover:scale-110 transition-transform" />
         </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
         <div className="flex items-center gap-3">
            <div className="relative w-64">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
               <input 
                  type="text" 
                  placeholder="Buscar en la cartera..." 
                  className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all shadow-sm"
               />
            </div>
            <button className="bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm">
               <Filter className="size-4" />
            </button>
         </div>

         <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button 
               onClick={() => setViewMode('grid')}
               className={cn("p-2 rounded-lg transition-all", viewMode === 'grid' ? "bg-white text-brand-primary shadow-sm" : "text-slate-400 hover:text-slate-600")}
            >
               <LayoutGrid className="size-4" />
            </button>
            <button 
               onClick={() => setViewMode('list')}
               className={cn("p-2 rounded-lg transition-all", viewMode === 'list' ? "bg-white text-brand-primary shadow-sm" : "text-slate-400 hover:text-slate-600")}
            >
               <List className="size-4" />
            </button>
         </div>
      </div>

      {/* Clients View */}
      {viewMode === 'grid' ? (
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clients.map(client => {
               const status = getHealthStatus(client.health);
               return (
                  <div 
                     key={client.id} 
                     onClick={() => setActiveClient(client.id)}
                     className={cn(
                        "bg-white rounded-2xl border-2 transition-all cursor-pointer hover:-translate-y-1 hover:shadow-xl group flex flex-col",
                        status.border
                     )}
                  >
                     <div className="p-6 border-b border-slate-50">
                        <div className="flex justify-between items-start mb-4">
                           <div className="size-12 rounded-xl overflow-hidden shadow-sm">
                              <img src={client.logo} alt={client.name} className="size-full object-cover" />
                           </div>
                           <div className={cn("px-2.5 py-1 rounded-full flex items-center gap-1.5", status.bg)}>
                              <div className={cn("size-1.5 rounded-full", status.dot)} />
                              <span className={cn("text-[10px] font-bold tracking-wide uppercase", status.text)}>
                                 Score: {client.health}
                              </span>
                           </div>
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 leading-tight mb-1">{client.name}</h3>
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">{client.industry}</p>
                     </div>
                     
                     <div className="p-6 bg-slate-50/50 flex-1 grid grid-cols-2 gap-4">
                        <div>
                           <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">{client.metrics.revenue.label}</p>
                           <p className="text-sm font-bold text-slate-900">{client.metrics.revenue.value}</p>
                           <div className="flex items-center gap-1 mt-1">
                              {client.metrics.revenue.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-rose-500" />}
                              <span className={cn("text-[10px] font-bold", client.metrics.revenue.trend === 'up' ? "text-emerald-600" : "text-rose-600")}>
                                 {Math.abs(client.metrics.revenue.change)}%
                              </span>
                           </div>
                        </div>
                        <div>
                           <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">{client.metrics.roas.label}</p>
                           <p className="text-sm font-bold text-slate-900">{client.metrics.roas.value}</p>
                           <div className="flex items-center gap-1 mt-1">
                              {client.metrics.roas.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-rose-500" />}
                              <span className={cn("text-[10px] font-bold", client.metrics.roas.trend === 'up' ? "text-emerald-600" : "text-rose-600")}>
                                 {Math.abs(client.metrics.roas.change)}x
                              </span>
                           </div>
                        </div>
                     </div>
                     <div className="px-6 py-3 border-t border-slate-50 bg-white rounded-b-2xl flex items-center justify-between text-xs font-bold text-slate-400 group-hover:text-brand-primary transition-colors">
                        <span>Ver Dashboard Analítico</span>
                        <ArrowRight className="size-4" />
                     </div>
                  </div>
               );
            })}
         </div>
      ) : (
         <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left">
               <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Health Score</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Revenue (30d)</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">ROAS</th>
                     <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acción</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {clients.map(client => {
                     const status = getHealthStatus(client.health);
                     return (
                        <tr 
                           key={client.id} 
                           className="hover:bg-slate-50 transition-colors cursor-pointer group"
                           onClick={() => setActiveClient(client.id)}
                        >
                           <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                 <img src={client.logo} alt={client.name} className="size-10 rounded-lg object-cover" />
                                 <div>
                                    <h3 className="text-sm font-bold text-slate-900">{client.name}</h3>
                                    <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">{client.industry}</p>
                                 </div>
                              </div>
                           </td>
                           <td className="px-6 py-4">
                              <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full", status.bg)}>
                                 <div className={cn("size-1.5 rounded-full", status.dot)} />
                                 <span className={cn("text-[10px] font-bold tracking-wide uppercase", status.text)}>
                                    {client.health}% • {status.label}
                                 </span>
                              </div>
                           </td>
                           <td className="px-6 py-4 text-right">
                              <span className="text-sm font-bold text-slate-900">{client.metrics.revenue.value}</span>
                              <div className="flex items-center justify-end gap-1 mt-0.5">
                                 {client.metrics.revenue.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-rose-500" />}
                                 <span className={cn("text-[10px] font-bold", client.metrics.revenue.trend === 'up' ? "text-emerald-600" : "text-rose-600")}>
                                    {Math.abs(client.metrics.revenue.change)}%
                                 </span>
                              </div>
                           </td>
                           <td className="px-6 py-4 text-right">
                              <span className="text-sm font-bold text-slate-900">{client.metrics.roas.value}</span>
                              <div className="flex items-center justify-end gap-1 mt-0.5">
                                 {client.metrics.roas.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-rose-500" />}
                                 <span className={cn("text-[10px] font-bold", client.metrics.roas.trend === 'up' ? "text-emerald-600" : "text-rose-600")}>
                                    {Math.abs(client.metrics.roas.change)}
                                 </span>
                              </div>
                           </td>
                           <td className="px-6 py-4 text-right">
                              <button className="text-[10px] font-bold text-brand-primary uppercase tracking-widest bg-brand-primary/10 px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                 Ver Detalles
                              </button>
                           </td>
                        </tr>
                     );
                  })}
               </tbody>
            </table>
         </div>
      )}

      {/* New Client Modal */}
      {isNewClientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-900">Añadir Nuevo Cliente</h3>
              <button 
                onClick={() => setNewClientModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddNewClient} className="p-6">
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-bold text-slate-700 mb-1">Nombre del Cliente *</label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={newClientForm.name}
                    onChange={(e) => setNewClientForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                    placeholder="Ej. Acme Corp"
                  />
                </div>
                
                <div>
                  <label htmlFor="industry" className="block text-sm font-bold text-slate-700 mb-1">Sector / Industria</label>
                  <input
                    type="text"
                    id="industry"
                    value={newClientForm.industry}
                    onChange={(e) => setNewClientForm(prev => ({ ...prev, industry: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                    placeholder="Ej. Ecommerce, Retail, SaaS..."
                  />
                </div>

                <div>
                  <label htmlFor="logo" className="block text-sm font-bold text-slate-700 mb-1">URL del Logo (Opcional)</label>
                  <input
                    type="url"
                    id="logo"
                    value={newClientForm.logo}
                    onChange={(e) => setNewClientForm(prev => ({ ...prev, logo: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                    placeholder="https://..."
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Si se deja vacío, se generará uno automáticamente.</p>
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setNewClientModalOpen(false)}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newClientForm.name.trim()}
                  className="px-4 py-2 text-sm font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-lg shadow-brand-primary/20"
                >
                  Añadir Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
