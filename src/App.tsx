import { Sidebar } from './components/Sidebar';
import { OverviewTab } from './components/OverviewTab';
import { SalesTab } from './components/SalesTab';
import { TrafficTab } from './components/TrafficTab';
import { SeoTab } from './components/SeoTab';
import { LeadsTab } from './components/LeadsTab';
import { RrssTab } from './components/RrssTab';
import { AiInsightsTab } from './components/AiInsightsTab';
import { ReportsTab } from './components/ReportsTab';
import { IntegrationsTab } from './components/IntegrationsTab';
import { UserProfile } from './components/UserProfile';
import { AgencyDashboard } from './components/AgencyDashboard';
import { useClientStore } from './store/useClientStore';
import { Zap, Bell, ChevronDown } from 'lucide-react';

export default function App() {
  const { activeClientId, activeTabId, clients, setActiveTab } = useClientStore();
  const activeClient = clients.find(c => c.id === activeClientId) || null;

  const renderTab = () => {
    if (activeTabId === 'profile') {
      return <UserProfile />;
    }

    if (!activeClient) {
      return <AgencyDashboard />;
    }
    
    switch (activeTabId) {
      case 'overview': return <OverviewTab client={activeClient} />;
      case 'sales': return <SalesTab client={activeClient} />;
      case 'traffic': return <TrafficTab client={activeClient} />;
      case 'seo': return <SeoTab client={activeClient} />;
      case 'leads': return <LeadsTab client={activeClient} />;
      case 'rrss': return <RrssTab client={activeClient} />;
      case 'integrations': return <IntegrationsTab client={activeClient} />;
      case 'ai': return <AiInsightsTab client={activeClient} />;
      case 'reports': return <ReportsTab client={activeClient} />;
      default: return <OverviewTab client={activeClient} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      
      <main className="flex-1 flex flex-col">
        {/* Navbar */}
        <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 text-slate-400">
                <button 
                  onClick={() => useClientStore.getState().setActiveClient(null)} 
                  className="text-sm font-medium hover:text-slate-900 transition-colors"
                >
                  Dashboard
                </button>
                {activeClient && (
                  <>
                    <span className="text-slate-300">/</span>
                    <span className="text-sm font-bold text-slate-900">{activeClient.name}</span>
                  </>
                )}
             </div>
          </div>

          <div className="flex items-center gap-6">
             <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 rounded-full border border-slate-100">
                <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-slate-600 tracking-wide uppercase">SISTEMA SINCRONIZADO</span>
             </div>

             <div className="flex items-center gap-3 border-l border-slate-200 pl-6">
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors relative group">
                  <Bell className="size-5 group-hover:rotate-12 transition-transform" />
                  <span className="absolute top-2 right-2 size-2 bg-brand-accent rounded-full border-2 border-white" />
                </button>
                <div 
                   onClick={() => setActiveTab('profile')}
                   className="flex items-center gap-3 pl-3 active:scale-95 transition-transform cursor-pointer group"
                >
                   <div className="size-10 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white overflow-hidden shadow-sm">
                      <img src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?q=80&w=100&h=100&auto=format&fit=crop" alt="Profile" />
                   </div>
                   <div className="hidden md:block">
                      <p className="text-sm font-bold text-slate-900 leading-none mb-1">Fede Nevado</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Senior Manager</p>
                   </div>
                   <ChevronDown className="size-4 text-slate-400 group-hover:translate-y-0.5 transition-transform" />
                </div>
             </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-8 max-w-7xl mx-auto w-full">
           {renderTab()}
        </div>
      </main>

      {/* Global AI Floating Action */}
      <button className="fixed bottom-8 right-8 size-14 bg-slate-900 rounded-full shadow-2xl flex items-center justify-center group hover:scale-110 transition-all z-50">
         <Zap className="size-6 text-amber-400 group-hover:scale-125 transition-transform fill-amber-400" />
         <div className="absolute right-16 bg-white px-4 py-2 rounded-xl shadow-xl border border-slate-100 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
            <p className="text-xs font-bold text-slate-900">Analizador Inteligente Activo</p>
         </div>
      </button>
    </div>
  );
}
