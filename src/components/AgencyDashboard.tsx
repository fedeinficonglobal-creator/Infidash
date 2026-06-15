import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_KPI_THRESHOLDS } from '../lib/kpiThresholds.js';
import { useClientStore, type Client } from '../store/useClientStore';
import { getHealthSummary, type HealthSummary } from '../services/infidashApi';
import { LayoutGrid, List, Plus, Search, Filter, TrendingUp, TrendingDown, ArrowRight, X, PencilLine, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function AgencyDashboard() {
  const { clients, setActiveClient, addClient, updateClient, deleteClient } = useClientStore();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isNewClientModalOpen, setNewClientModalOpen] = useState(false);
  const [clientModalMode, setClientModalMode] = useState<'create' | 'edit'>('create');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [clientActionError, setClientActionError] = useState<string | null>(null);
  const [isLoadingHealthSummary, setIsLoadingHealthSummary] = useState(true);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  
  const [newClientForm, setNewClientForm] = useState({
    name: '',
    industry: '',
    logo: '',
    revenueTarget: String(DEFAULT_KPI_THRESHOLDS.revenue),
    roasTarget: String(DEFAULT_KPI_THRESHOLDS.roas),
    conversionsTarget: String(DEFAULT_KPI_THRESHOLDS.conversions),
    cpaTarget: String(DEFAULT_KPI_THRESHOLDS.cpa),
  });

  const resetClientForm = () => {
    setNewClientForm({
      name: '',
      industry: '',
      logo: '',
      revenueTarget: String(DEFAULT_KPI_THRESHOLDS.revenue),
      roasTarget: String(DEFAULT_KPI_THRESHOLDS.roas),
      conversionsTarget: String(DEFAULT_KPI_THRESHOLDS.conversions),
      cpaTarget: String(DEFAULT_KPI_THRESHOLDS.cpa),
    });
  };

  const openCreateClientModal = () => {
    setClientModalMode('create');
    setEditingClient(null);
    setClientActionError(null);
    resetClientForm();
    setNewClientModalOpen(true);
  };

  const openEditClientModal = (client: Client) => {
    setClientModalMode('edit');
    setEditingClient(client);
    setClientActionError(null);
    setNewClientForm({
      name: client.name,
      industry: client.industry,
      logo: client.logo,
      revenueTarget: String(client.kpiThresholds.revenue),
      roasTarget: String(client.kpiThresholds.roas),
      conversionsTarget: String(client.kpiThresholds.conversions),
      cpaTarget: String(client.kpiThresholds.cpa),
    });
    setNewClientModalOpen(true);
  };

  const closeClientModal = () => {
    setNewClientModalOpen(false);
    setEditingClient(null);
    setClientActionError(null);
    setClientModalMode('create');
    resetClientForm();
  };

  const handleSubmitClientForm = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingClient(true);
    setClientActionError(null);

    try {
      const payload = {
        name: newClientForm.name.trim(),
        industry: newClientForm.industry || 'General',
        logo: newClientForm.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(newClientForm.name)}&background=random`,
        kpiThresholds: {
          revenue: Number(newClientForm.revenueTarget) || DEFAULT_KPI_THRESHOLDS.revenue,
          roas: Number(newClientForm.roasTarget) || DEFAULT_KPI_THRESHOLDS.roas,
          conversions: Number(newClientForm.conversionsTarget) || DEFAULT_KPI_THRESHOLDS.conversions,
          cpa: Number(newClientForm.cpaTarget) || DEFAULT_KPI_THRESHOLDS.cpa,
        },
      };

      if (clientModalMode === 'edit' && editingClient) {
        await updateClient(editingClient.id, payload);
      } else {
        await addClient(payload);
      }

      closeClientModal();
    } catch (error) {
      setClientActionError(error instanceof Error ? error.message : 'No se pudo guardar el cliente');
    } finally {
      setIsSavingClient(false);
    }
  };

  const handleDeleteClient = async (client: Client) => {
    const confirmed = window.confirm(`¿Seguro que quieres eliminar a ${client.name}? Esta acción borrará también sus datos asociados.`);
    if (!confirmed) {
      return;
    }

    setIsSavingClient(true);
    setClientActionError(null);
    try {
      await deleteClient(client.id);
      if (editingClient?.id === client.id) {
        closeClientModal();
      }
    } catch (error) {
      setClientActionError(error instanceof Error ? error.message : 'No se pudo eliminar el cliente');
    } finally {
      setIsSavingClient(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadHealthSummary = async () => {
      try {
        const summary = await getHealthSummary();
        if (!cancelled) {
          setHealthSummary(summary);
        }
      } catch {
        if (!cancelled) {
          setHealthSummary(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHealthSummary(false);
        }
      }
    };

    void loadHealthSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalRevenue = clients.reduce((acc, client) => {
    // Basic parse for mock values like "52.430 €" to numbers
    const num = parseFloat(client.metrics.revenue.value.toString().replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.'));
    return acc + (isNaN(num) ? 0 : num);
  }, 0);

  const avgHealth = Math.round(clients.reduce((acc, client) => acc + client.health, 0) / (clients.length || 1));
  const criticalClients = clients.filter((client) => client.health < 40).length;
  const activeClientsCount = healthSummary?.clients ?? clients.length;
  const dailyStatsCount = healthSummary?.dailyStats ?? 0;
  const agencySignal = isLoadingHealthSummary
    ? 'Sincronizando métricas reales...'
    : dailyStatsCount > 0
      ? `Se registraron ${dailyStatsCount} métricas diarias en la base.`
      : 'Aún no hay métricas diarias registradas.';

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
           onClick={openCreateClientModal}
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
               <span className="text-3xl font-bold text-slate-900">{activeClientsCount}</span>
               <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">{isLoadingHealthSummary ? 'Sincronizando...' : `${dailyStatsCount} registros`}</span>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Revenue Gestionado (30d)</h3>
            <div className="flex items-end justify-between">
               <span className="text-3xl font-bold text-slate-900">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalRevenue)}</span>
               <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">{healthSummary ? 'Datos reales' : 'Sincronizando...'}</span>
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
                  <p className="text-[10px] text-slate-400 font-medium">{criticalClients} cliente{criticalClients === 1 ? '' : 's'} en riesgo crítico</p>
               </div>
            </div>
         </div>
        <div className="bg-brand-primary p-6 rounded-2xl shadow-[0_8px_30px_rgba(14,165,233,0.3)] flex flex-col justify-between text-white relative overflow-hidden group cursor-pointer">
           <div className="relative z-10">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/80 mb-2">Resumen automático</h3>
              <p className="text-sm font-medium leading-relaxed">{agencySignal}</p>
              <p className="mt-3 text-xs text-white/70">
                {isLoadingHealthSummary
                  ? 'Cargando cartera y métricas reales...'
                  : `${activeClientsCount} clientes activos · ${dailyStatsCount} métricas guardadas`}
              </p>
              <div className="mt-4 inline-flex items-center gap-1 text-xs font-bold bg-white/20 px-2 py-1 rounded">
                 Ver cartera real <ArrowRight className="size-3" />
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
                           <div className="flex items-start gap-2">
                             <div className={cn("px-2.5 py-1 rounded-full flex items-center gap-1.5", status.bg)}>
                                <div className={cn("size-1.5 rounded-full", status.dot)} />
                                <span className={cn("text-[10px] font-bold tracking-wide uppercase", status.text)}>
                                   Score: {client.health}
                                </span>
                             </div>
                             <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button
                                 type="button"
                                 onClick={(event) => {
                                   event.stopPropagation();
                                   openEditClientModal(client);
                                 }}
                                 className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:text-brand-primary"
                                 aria-label={`Editar cliente ${client.name}`}
                                 title="Editar cliente"
                               >
                                 <PencilLine className="size-3.5" />
                               </button>
                               <button
                                 type="button"
                                 onClick={(event) => {
                                   event.stopPropagation();
                                   void handleDeleteClient(client);
                                 }}
                                 className="rounded-lg border border-rose-100 bg-white p-2 text-rose-500 shadow-sm hover:bg-rose-50"
                                 aria-label={`Eliminar cliente ${client.name}`}
                                 title="Eliminar cliente"
                               >
                                 <Trash2 className="size-3.5" />
                               </button>
                             </div>
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
                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button
                                   type="button"
                                   onClick={(event) => {
                                     event.stopPropagation();
                                     openEditClientModal(client);
                                   }}
                                   className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-brand-primary hover:border-brand-primary/30"
                                 >
                                   <PencilLine className="size-3" /> Editar
                                 </button>
                                 <button
                                   type="button"
                                   onClick={(event) => {
                                     event.stopPropagation();
                                     void handleDeleteClient(client);
                                   }}
                                   className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-rose-600 hover:bg-rose-50"
                                 >
                                   <Trash2 className="size-3" /> Eliminar
                                 </button>
                              </div>
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
              <h3 className="text-xl font-bold text-slate-900">{clientModalMode === 'edit' ? 'Editar Cliente' : 'Añadir Nuevo Cliente'}</h3>
              <button 
                onClick={closeClientModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmitClientForm} className="p-6">
              <div className="space-y-4">
                {clientActionError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {clientActionError}
                  </div>
                )}
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="revenueTarget" className="block text-sm font-bold text-slate-700 mb-1">Umbral revenue éxito (€)</label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      id="revenueTarget"
                      value={newClientForm.revenueTarget}
                      onChange={(e) => setNewClientForm(prev => ({ ...prev, revenueTarget: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      placeholder="10000"
                    />
                  </div>
                  <div>
                    <label htmlFor="roasTarget" className="block text-sm font-bold text-slate-700 mb-1">Umbral ROAS éxito</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      id="roasTarget"
                      value={newClientForm.roasTarget}
                      onChange={(e) => setNewClientForm(prev => ({ ...prev, roasTarget: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      placeholder="4.0"
                    />
                  </div>
                  <div>
                    <label htmlFor="conversionsTarget" className="block text-sm font-bold text-slate-700 mb-1">Umbral conversiones éxito</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      id="conversionsTarget"
                      value={newClientForm.conversionsTarget}
                      onChange={(e) => setNewClientForm(prev => ({ ...prev, conversionsTarget: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      placeholder="100"
                    />
                  </div>
                  <div>
                    <label htmlFor="cpaTarget" className="block text-sm font-bold text-slate-700 mb-1">Umbral CPA fracaso (€ máx.)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      id="cpaTarget"
                      value={newClientForm.cpaTarget}
                      onChange={(e) => setNewClientForm(prev => ({ ...prev, cpaTarget: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      placeholder="15"
                    />
                  </div>
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
                  disabled={!newClientForm.name.trim() || isSavingClient}
                  className="px-4 py-2 text-sm font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-lg shadow-brand-primary/20"
                >
                  {isSavingClient ? (clientModalMode === 'edit' ? 'Guardando cambios...' : 'Guardando...') : (clientModalMode === 'edit' ? 'Guardar Cambios' : 'Añadir Cliente')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
