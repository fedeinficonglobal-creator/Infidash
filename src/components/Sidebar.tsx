/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Search, LayoutDashboard, ShoppingBag, BarChart3, SearchCode, Megaphone, Zap, FileText, ChevronRight, AlertCircle, Users, Hash } from 'lucide-react';
import { useClientStore } from '../store/useClientStore';
import { cn } from '../lib/utils';

export function Sidebar() {
  const { clients, activeClientId, activeTabId, setActiveClient, setActiveTab } = useClientStore();

  const activeClient = clients.find(c => c.id === activeClientId);

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'sales', label: 'Ventas (Woo)', icon: ShoppingBag },
    { id: 'traffic', label: 'Tráfico & Ads', icon: BarChart3 },
    { id: 'seo', label: 'SEO', icon: SearchCode },
    { id: 'leads', label: 'Leads', icon: Megaphone },
    { id: 'rrss', label: 'Redes Sociales', icon: Hash },
    { id: 'ai', label: 'Insights IA', icon: Zap },
    { id: 'reports', label: 'Reportes', icon: FileText },
    { id: 'integrations', label: 'Integraciones', icon: Users },
  ].filter(item => !activeClient?.activeTabs || activeClient.activeTabs.includes(item.id));

  return (
    <aside className="w-72 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-slate-100">
        <button className="flex items-center gap-3 mb-6 w-full text-left cursor-pointer group" onClick={() => setActiveClient(null)}>
          <div className="size-10 bg-brand-primary rounded-xl flex items-center justify-center group-hover:bg-brand-primary/90 transition-colors">
             <Zap className="text-white size-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none group-hover:text-brand-primary transition-colors">Client Intelligence</h1>
            <span className="text-xs text-slate-400 font-medium tracking-wide">AGENCY HUB</span>
          </div>
        </button>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar..." 
            className="w-full bg-slate-50 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-brand-primary transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {activeClientId && (
           <div className="mb-6">
             <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-3">Menu Cliente</h2>
             <nav className="space-y-1">
               {navItems.map((item) => (
                 <button
                   key={item.id}
                   onClick={() => setActiveTab(item.id)}
                   className={cn(
                     "w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors group",
                     activeTabId === item.id ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                   )}
                 >
                   <item.icon className={cn(
                     "size-4 transition-colors",
                     activeTabId === item.id ? "text-brand-primary" : "text-slate-400 group-hover:text-brand-primary"
                   )} />
                   {item.label}
                 </button>
               ))}
             </nav>
           </div>
        )}

        <div>
          <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-3">Mis Clientes</h2>
          <div className="space-y-1">
            {clients.map((client) => {
              const isActive = activeClientId === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => setActiveClient(client.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2 rounded-lg transition-all group text-left",
                    isActive ? "bg-brand-primary/5 text-brand-primary shadow-sm" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <img src={client.logo} alt={client.name} className="size-8 rounded-md object-cover" />
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-semibold truncate">{client.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "size-1.5 rounded-full",
                        client.health > 70 ? "bg-emerald-500" : client.health > 40 ? "bg-amber-500" : "bg-rose-500"
                      )} />
                      <span className="text-[10px] text-slate-400 font-medium">Health: {client.health}%</span>
                    </div>
                  </div>
                  {isActive && <ChevronRight className="size-4 opacity-50" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-100">
        <div className="bg-slate-900 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-3">
             <div className="size-8 bg-brand-accent rounded-lg flex items-center justify-center">
                <AlertCircle className="size-5" />
             </div>
             <span className="text-[10px] font-bold bg-white/10 px-2 py-1 rounded">ALERTA</span>
          </div>
          <p className="text-xs font-medium text-slate-300 leading-relaxed">
            ROAS de <span className="text-white font-bold">Concha Vega</span> cayó a un nivel crítico.
          </p>
        </div>
      </div>
    </aside>
  );
}
