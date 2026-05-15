import { useState } from 'react';
import { type Client } from '../store/useClientStore';
import { 
  Settings, 
  Key, 
  Link as LinkIcon, 
  ExternalLink, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCcw, 
  ShieldCheck, 
  Globe, 
  ShoppingBag, 
  BarChart3, 
  Hash, 
  Zap,
  Info
} from 'lucide-react';
import { cn } from '../lib/utils';

interface Integration {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'pending';
  lastSync?: string;
  icon: any;
  color: string;
}

export function IntegrationsTab({ client }: { client: Client }) {
  const [integrations, setIntegrations] = useState<Integration[]>([
    { id: 'woo', name: 'WooCommerce', type: 'Ecommerce', status: 'connected', lastSync: 'Hace 5m', icon: ShoppingBag, color: 'text-purple-600 bg-purple-50' },
    { id: 'ga4', name: 'Google Analytics 4', type: 'Analytics', status: 'connected', lastSync: 'Hace 1h', icon: Globe, color: 'text-amber-500 bg-amber-50' },
    { id: 'gads', name: 'Google Ads', type: 'Advertising', status: 'connected', lastSync: 'Hace 2h', icon: BarChart3, color: 'text-blue-500 bg-blue-50' },
    { id: 'meta', name: 'Meta Ads', type: 'Advertising', status: 'connected', lastSync: 'Hace 30m', icon: Hash, color: 'text-blue-600 bg-blue-50' },
    { id: 'ig', name: 'Instagram Graph API', type: 'Social Media', status: 'pending', icon: Hash, color: 'text-rose-500 bg-rose-50' },
    { id: 'tiktok', name: 'TikTok for Business', type: 'Social Media', status: 'disconnected', icon: RefreshCcw, color: 'text-black bg-slate-100' },
    { id: 'search', name: 'Search Console', type: 'SEO', status: 'connected', lastSync: 'Ayer', icon: Globe, color: 'text-blue-400 bg-blue-50' },
  ]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Integraciones API</h2>
        <p className="text-slate-500 font-medium">Conecta y gestiona los endpoints de datos para {client.name}.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="md:col-span-2 space-y-6">
           <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
             <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
               <h3 className="font-bold text-slate-900">Servicios Conectados</h3>
               <button className="text-xs font-bold text-brand-primary flex items-center gap-1">
                 <RefreshCcw className="size-3" /> Sincronizar Todo
               </button>
             </div>
             <div className="divide-y divide-slate-100">
                {integrations.map((int) => (
                  <div key={int.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={cn("size-10 rounded-xl flex items-center justify-center", int.color)}>
                        <int.icon className="size-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{int.name}</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{int.type}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Estado</p>
                        <div className="flex items-center gap-1.5 justify-end">
                          <div className={cn(
                            "size-1.5 rounded-full",
                            int.status === 'connected' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
                            int.status === 'pending' ? "bg-amber-500 animate-pulse" : "bg-rose-500"
                          )} />
                          <span className={cn(
                            "text-xs font-bold",
                            int.status === 'connected' ? "text-emerald-600" : 
                            int.status === 'pending' ? "text-amber-600" : "text-rose-600"
                          )}>
                            {int.status === 'connected' ? 'Activo' : int.status === 'pending' ? 'Verificando' : 'Desconectado'}
                          </span>
                        </div>
                      </div>
                      
                      {int.lastSync && (
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] text-slate-400 font-bold uppercase">Última Sync</p>
                          <p className="text-xs font-bold text-slate-600">{int.lastSync}</p>
                        </div>
                      )}

                      <button className="p-2 border border-slate-200 rounded-lg hover:bg-white hover:text-brand-primary transition-all">
                        <Settings className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
             </div>
           </div>

           <div className="bg-amber-50 border border-amber-100 p-5 rounded-2xl flex gap-4">
              <div className="size-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                 <AlertCircle className="size-5 text-amber-600" />
              </div>
              <div>
                 <h4 className="text-sm font-bold text-amber-900 mb-1">Permisos de API próximos a expirar</h4>
                 <p className="text-xs text-amber-700 leading-relaxed">
                   El token de acceso de <strong>Meta Ads</strong> expirará en 3 días. Es necesario renovar los permisos para evitar cortes en la sincronización de datos.
                 </p>
                 <button className="mt-3 text-xs font-bold text-amber-900 underline underline-offset-4">
                   Renovar Token de Acceso
                 </button>
              </div>
           </div>
        </div>

        <div className="space-y-6">
           <div className="bg-slate-900 rounded-3xl p-6 text-white overflow-hidden relative shadow-2xl">
              <div className="relative z-10">
                 <ShieldCheck className="size-8 text-emerald-400 mb-4" />
                 <h3 className="text-lg font-bold mb-2">Configuración de Seguridad</h3>
                 <p className="text-xs text-slate-400 leading-relaxed mb-6">
                   Tus API Keys se almacenan utilizando cifrado AES-256 en Supabase con Row Level Security activo.
                 </p>
                 <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                       <span className="text-xs font-medium">Modo Producción</span>
                       <div className="size-2 rounded-full bg-emerald-500" />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                       <span className="text-xs font-medium">Validación Webhook</span>
                       <div className="size-2 rounded-full bg-emerald-500" />
                    </div>
                 </div>
              </div>
              <div className="absolute top-0 right-0 p-4 opacity-5">
                 <Zap className="size-40" />
              </div>
           </div>

           <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                 <Info className="size-4 text-slate-400" /> Ayuda de Conexión
              </h3>
              <div className="space-y-4">
                 <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-xs font-bold text-slate-700 mb-1">¿Cómo conecto WooCommerce?</p>
                    <p className="text-[10px] text-slate-500">Necesitas generar un Consumer Key y Secret en Ajustes &gt; Avanzado &gt; REST API.</p>
                 </div>
                 <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-xs font-bold text-slate-700 mb-1">¿Qué es el ID de Propiedad de GA4?</p>
                    <p className="text-[10px] text-slate-500">Lo encontrarás en Administrador &gt; Configuración de la propiedad en tu cuenta de Analytics.</p>
                 </div>
              </div>
              <button className="w-full mt-6 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors">
                 Ver Documentación API
              </button>
           </div>
        </div>
      </div>
    </div>
  );
}
