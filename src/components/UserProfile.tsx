import { useState } from 'react';
import { User, Mail, Shield, Bell, Key, LogOut, Camera, Globe, ChevronRight, BadgeCheck, Clock3 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useClientStore } from '../store/useClientStore';

export function UserProfile() {
  const [activeSubTab, setActiveSubTab] = useState<'profile' | 'security' | 'notifications'>('profile');
  const { currentUser, signOut } = useClientStore();

  const displayName = currentUser?.name ?? 'Usuario de Infidash';
  const displayEmail = currentUser?.email ?? 'sesion@infidash.local';
  const displayRole = currentUser?.role === 'admin' ? 'Administrador' : currentUser?.role === 'viewer' ? 'Visualizador' : 'Sin rol';
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0F172A&color=FFFFFF&size=256`;

  const menu = [
    { id: 'profile', label: 'Mi Perfil', icon: User },
    { id: 'security', label: 'Seguridad', icon: Shield },
    { id: 'notifications', label: 'Notificaciones', icon: Bell },
  ] as const;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Perfil de Usuario</h2>
        <p className="text-slate-500 font-medium">Gestiona tu cuenta conectada al backend de Infidash.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-1">
          {menu.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSubTab(item.id)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all',
                activeSubTab === item.id ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-500 hover:bg-white hover:text-slate-900'
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className="size-4" />
                {item.label}
              </div>
              <ChevronRight className={cn('size-4 opacity-50', activeSubTab === item.id ? 'block' : 'hidden')} />
            </button>
          ))}
          <div className="pt-4 mt-4 border-t border-slate-200">
            <button
              onClick={() => void signOut()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 transition-all"
            >
              <LogOut className="size-4" />
              Cerrar Sesión
            </button>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-8">
            {activeSubTab === 'profile' && (
              <div className="animate-in fade-in duration-300">
                <div className="flex flex-col md:flex-row items-center gap-8 mb-10 pb-10 border-b border-slate-100">
                  <div className="relative group">
                    <div className="size-32 rounded-3xl overflow-hidden border-4 border-slate-50 shadow-inner bg-slate-50">
                      <img
                        src={avatarUrl}
                        alt={`Avatar de ${displayName}`}
                        className="size-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                    </div>
                    <button className="absolute -bottom-2 -right-2 p-2 bg-brand-primary text-white rounded-xl shadow-lg hover:scale-110 transition-all" aria-label="Cambiar avatar">
                      <Camera className="size-4" />
                    </button>
                  </div>
                  <div className="text-center md:text-left">
                    <h3 className="text-2xl font-bold text-slate-900 mb-1">{displayName}</h3>
                    <p className="text-sm font-bold text-brand-primary mb-4 uppercase tracking-widest">{displayRole}</p>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4">
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                        <Globe className="size-3 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-600">ESPAÑA, MADRID</span>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                        <Mail className="size-3 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-600">{displayEmail}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Cuenta</p>
                    <p className="text-sm font-bold text-slate-900">{currentUser?.active ? 'Activa' : 'Sin sesión'}</p>
                    <p className="text-xs text-slate-500 mt-1">Datos sincronizados desde el backend.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Permisos</p>
                    <p className="text-sm font-bold text-slate-900">{displayRole}</p>
                    <p className="text-xs text-slate-500 mt-1">Acceso según rol del usuario autenticado.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Última carga</p>
                    <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
                      <Clock3 className="size-4 text-slate-400" />
                      Sesión restaurada
                    </p>
                    <p className="text-xs text-slate-500 mt-1">La información viene del token guardado en el navegador.</p>
                  </div>
                </div>
              </div>
            )}

            {activeSubTab === 'security' && (
              <div className="animate-in fade-in duration-300 space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Seguridad de la Cuenta</h3>
                  <p className="text-sm text-slate-500">La autenticación y los permisos se gestionan en el servidor.</p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-4">
                      <div className="size-10 bg-white rounded-xl flex items-center justify-center border border-slate-100">
                        <Key className="size-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Sesión autenticada</p>
                        <p className="text-xs text-slate-400">El token se valida contra el backend en cada petición</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">Activa</span>
                  </div>
                  <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-4">
                      <div className="size-10 bg-white rounded-xl flex items-center justify-center border border-slate-100">
                        <Shield className="size-5 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Rol actual</p>
                        <p className="text-xs text-slate-400">{displayRole} con permisos de {currentUser?.role === 'admin' ? 'escritura completa' : 'solo lectura en endpoints de edición'}</p>
                      </div>
                    </div>
                    <BadgeCheck className="size-5 text-emerald-500" />
                  </div>
                </div>
              </div>
            )}

            {activeSubTab === 'notifications' && (
              <div className="animate-in fade-in duration-300 space-y-4">
                <h3 className="text-xl font-bold text-slate-900">Notificaciones</h3>
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
                  <p className="text-sm font-semibold text-slate-700">Las preferencias de notificación todavía no están conectadas al backend.</p>
                  <p className="text-xs text-slate-500 mt-1">Cuando activemos esta parte, se guardarán de forma persistente por usuario.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
