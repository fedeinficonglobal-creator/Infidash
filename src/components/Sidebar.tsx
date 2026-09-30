/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LayoutDashboard, ShoppingBag, BarChart3, SearchCode, Megaphone, Zap, FileText, AlertCircle, Users, Hash, CalendarDays } from 'lucide-react';
import { Link } from 'react-router';
import { useClientStore, type Client } from '../store/useClientStore';
import { cn } from '../lib/utils.js';
import { buildClientSignals } from '../lib/clientSignals.js';
import { DASHBOARD_PATH, clientPath } from '../lib/routes.js';
import { ClientRail } from './ClientRail.js';

function clientAlertText(client: Client) {
  const clientSignals = buildClientSignals(client);
  if (!clientSignals.hasData) return 'Sin datos reales sincronizados';
  if (clientSignals.healthBand === 'excellent') return `ROAS de ${client.metrics.roas.value} y salud en ${client.health}%`;
  if (clientSignals.healthBand === 'critical') return `Requiere atención: health ${client.health}%`;
  return `Health ${client.health}% · foco en optimización`;
}

interface SidebarViewProps {
  clients: Client[];
  activeClientId: string | null;
  activeTabId: string;
}

export function Sidebar() {
  const { clients, activeClientId, activeTabId } = useClientStore();
  return <SidebarView clients={clients} activeClientId={activeClientId} activeTabId={activeTabId} />;
}

/** Presentational sidebar: client rail plus the active client's section menu (or the agency brand). */
export function SidebarView({ clients, activeClientId, activeTabId }: SidebarViewProps) {
  const activeClient = clients.find((c) => c.id === activeClientId);
  const signals = activeClient ? buildClientSignals(activeClient) : null;

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'sales', label: 'Ventas (Woo)', icon: ShoppingBag },
    { id: 'traffic', label: 'Tráfico & Ads', icon: BarChart3 },
    { id: 'web', label: 'Web', icon: SearchCode },
    { id: 'leads', label: 'Leads', icon: Megaphone },
    { id: 'rrss', label: 'Redes Sociales', icon: Hash },
    { id: 'content', label: 'Contenidos', icon: CalendarDays },
    { id: 'ai', label: 'Insights', icon: Zap },
    { id: 'reports', label: 'Reportes', icon: FileText },
    { id: 'integrations', label: 'Integraciones', icon: Users },
  ].filter((item) => !activeClient?.activeTabs || activeClient.activeTabs.includes(item.id));

  return (
    <aside className="flex h-screen sticky top-0 shrink-0">
      <ClientRail clients={clients} activeClientId={activeClient?.id ?? null} />

      <div className="w-60 bg-white border-r border-slate-200 flex flex-col h-full">
        <div className="p-5 border-b border-slate-100">
          {activeClient ? (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cliente</p>
              <h1 className="text-base font-bold leading-tight text-slate-900 break-words">{activeClient.name}</h1>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    activeClient.health > 70 ? 'bg-emerald-500' : activeClient.health > 40 ? 'bg-amber-500' : 'bg-rose-500'
                  )}
                />
                <span className="text-[10px] text-slate-400 font-medium">{clientAlertText(activeClient)}</span>
              </div>
            </div>
          ) : (
            <Link to={DASHBOARD_PATH} className="flex items-center gap-3 w-full text-left cursor-pointer group">
              <div className="size-10 bg-brand-primary rounded-xl flex items-center justify-center group-hover:bg-brand-primary/90 transition-colors">
                <Zap className="text-white size-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-none group-hover:text-brand-primary transition-colors">Infidash</h1>
                <span className="text-xs text-slate-400 font-medium tracking-wide">PANEL OPERATIVO</span>
              </div>
            </Link>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {activeClient && (
            <div>
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-3">Menú de cliente</h2>
              <nav aria-label="Menú de cliente" className="space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.id}
                    to={clientPath(activeClient.slug, item.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors group',
                      activeTabId === item.id ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'size-4 transition-colors',
                        activeTabId === item.id ? 'text-brand-primary' : 'text-slate-400 group-hover:text-brand-primary'
                      )}
                    />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="size-8 bg-brand-accent rounded-lg flex items-center justify-center">
                <AlertCircle className="size-5 text-white" />
              </div>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">ALERTA</span>
            </div>
            <p className="text-xs font-medium text-slate-500 leading-relaxed">
              {activeClient
                ? `El cliente ${activeClient.name} está en ${signals?.healthBand === 'critical' ? 'zona crítica' : signals?.healthBand === 'risk' ? 'zona de riesgo' : 'nivel controlado'}.`
                : 'Selecciona un cliente para ver la alerta prioritaria de la cuenta.'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
