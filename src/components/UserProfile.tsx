import { useState } from 'react';
import { User, Mail, Shield, Bell, Key, LogOut, Camera, Globe, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

export function UserProfile() {
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'security' | 'notifications'>('profile');

  const menu = [
    { id: 'profile', label: 'Mi Perfil', icon: User },
    { id: 'security', label: 'Seguridad', icon: Shield },
    { id: 'notifications', label: 'Notificaciones', icon: Bell },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Perfil de Usuario</h2>
        <p className="text-slate-500 font-medium">Gestiona tu identidad y preferencias en la plataforma.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Side Menu */}
        <div className="lg:col-span-1 space-y-1">
          {menu.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSubTab(item.id as any)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all",
                activeSubTab === item.id ? "bg-slate-900 text-white shadow-xl" : "text-slate-500 hover:bg-white hover:text-slate-900"
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className="size-4" />
                {item.label}
              </div>
              <ChevronRight className={cn("size-4 opacity-50", activeSubTab === item.id ? "block" : "hidden")} />
            </button>
          ))}
          <div className="pt-4 mt-4 border-t border-slate-200">
             <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 transition-all">
                <LogOut className="size-4" />
                Cerrar Sesión
             </button>
          </div>
        </div>

        {/* Right Side Content */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-8">
            {activeSubTab === 'profile' && (
              <div className="animate-in fade-in duration-300">
                <div className="flex flex-col md:flex-row items-center gap-8 mb-10 pb-10 border-b border-slate-100">
                  <div className="relative group">
                    <div className="size-32 rounded-3xl overflow-hidden border-4 border-slate-50 shadow-inner">
                      <img 
                        src="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?q=80&w=200&h=200&auto=format&fit=crop" 
                        alt="Profile" 
                        className="size-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                    </div>
                    <button className="absolute -bottom-2 -right-2 p-2 bg-brand-primary text-white rounded-xl shadow-lg hover:scale-110 transition-all">
                      <Camera className="size-4" />
                    </button>
                  </div>
                  <div className="text-center md:text-left">
                    <h3 className="text-2xl font-bold text-slate-900 mb-1">Fede Nevado</h3>
                    <p className="text-sm font-bold text-brand-primary mb-4 uppercase tracking-widest">Senior Agency Manager</p>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4">
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                        <Globe className="size-3 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-600">ESPAÑA, MADRID</span>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                        <Mail className="size-3 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-600">fede@agencia-hub.com</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nombre Completo</span>
                      <input 
                        type="text" 
                        defaultValue="Fede Nevado"
                        className="mt-1 w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Email Corporativo</span>
                      <input 
                        type="email" 
                        defaultValue="fede@agencia-hub.com"
                        className="mt-1 w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      />
                    </label>
                  </div>
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rol en la Agencia</span>
                      <select 
                        defaultValue="manager"
                        className="mt-1 w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      >
                        <option value="admin">Administrador</option>
                        <option value="manager">Account Manager</option>
                        <option value="analyst">Data Analyst</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Zona Horaria</span>
                      <input 
                        type="text" 
                        defaultValue="Europe/Madrid (GMT+2)"
                        className="mt-1 w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-10 flex justify-end">
                   <button className="bg-brand-primary text-white px-8 py-3 rounded-2xl text-sm font-bold shadow-xl shadow-brand-primary/20 hover:scale-105 active:scale-95 transition-all">
                      Guardar Cambios
                   </button>
                </div>
              </div>
            )}

            {activeSubTab === 'security' && (
              <div className="animate-in fade-in duration-300">
                 <h3 className="text-xl font-bold text-slate-900 mb-6">Seguridad de la Cuenta</h3>
                 <div className="space-y-6">
                    <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                       <div className="flex items-center gap-4">
                          <div className="size-10 bg-white rounded-xl flex items-center justify-center border border-slate-100">
                             <Key className="size-5 text-slate-400" />
                          </div>
                          <div>
                             <p className="text-sm font-bold text-slate-900">Contraseña</p>
                             <p className="text-xs text-slate-400">Último cambio hace 3 meses</p>
                          </div>
                       </div>
                       <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50">Cambiar</button>
                    </div>
                    <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                       <div className="flex items-center gap-4">
                          <div className="size-10 bg-white rounded-xl flex items-center justify-center border border-slate-100">
                             <Shield className="size-5 text-emerald-500" />
                          </div>
                          <div>
                             <p className="text-sm font-bold text-slate-900">Autenticación en dos pasos (2FA)</p>
                             <p className="text-xs text-slate-400">Protege tu cuenta con un nivel extra de seguridad</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mr-2">ACTIVO</span>
                          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 text-rose-500">Desactivar</button>
                       </div>
                    </div>
                 </div>
              </div>
            )}
            
            {activeSubTab === 'notifications' && (
              <div className="animate-in fade-in duration-300">
                 <h3 className="text-xl font-bold text-slate-900 mb-6">Preferencias de Notificación</h3>
                 <div className="space-y-4">
                    {[
                      { id: 'n1', label: 'Alertas de Health Score Crítico', desc: 'Recibe un email y notificación push cuando la salud cae de 40' },
                      { id: 'n2', label: 'Reportes Mensuales Generados', desc: 'Aviso cuando los reports automáticos están listos' },
                      { id: 'n3', label: 'Anomalías detectadas por IA', desc: 'Alertas inmediatas de Gemini ante cambios bruscos en métricas' },
                      { id: 'n4', label: 'Seguridad e Inicios de Sesión', desc: 'Avisos sobre accesos desde nuevos dispositivos' },
                    ].map((n) => (
                      <div key={n.id} className="flex items-start justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                         <div>
                            <p className="text-sm font-bold text-slate-900">{n.label}</p>
                            <p className="text-xs text-slate-400">{n.desc}</p>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer mt-1">
                            <input type="checkbox" defaultChecked className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                         </label>
                      </div>
                    ))}
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
