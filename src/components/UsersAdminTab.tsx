import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgeCheck, CircleAlert, LoaderCircle, Mail, RefreshCw, Shield, Settings2, UserPlus, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { useClientStore } from '../store/useClientStore';
import { createUserAccount, getUsers, updateUserAccount, type SessionUser, type UserRole } from '../services/infidashApi.js';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: 'admin', label: 'Administrador', hint: 'Puede crear usuarios y gestionar permisos' },
  { value: 'viewer', label: 'Visualizador', hint: 'Acceso solo lectura al dashboard' },
];

function roleLabel(role: UserRole) {
  return role === 'admin' ? 'Administrador' : 'Visualizador';
}

function roleBadgeClass(role: UserRole) {
  return role === 'admin'
    ? 'bg-slate-900 text-white'
    : 'bg-slate-100 text-slate-600 border border-slate-200';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function UsersAdminTab() {
  const { sessionToken, currentUser } = useClientStore();
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'viewer' as UserRole,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      if (!sessionToken) {
        if (!cancelled) {
          setLoading(false);
          setError('No hay una sesión activa.');
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await getUsers(sessionToken);
        if (!cancelled) {
          setUsers(response.users);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'No se pudo cargar la administración de usuarios');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [sessionToken, refreshToken]);

  const sortedUsers = useMemo(() => {
    const currentUserId = currentUser?.id ?? '';
    return [...users].sort((left, right) => {
      if (left.id === currentUserId) return -1;
      if (right.id === currentUserId) return 1;
      return left.name.localeCompare(right.name, 'es');
    });
  }, [currentUser?.id, users]);

  const userCount = users.length;
  const adminCount = users.filter((user) => user.role === 'admin').length;
  const activeCount = users.filter((user) => user.active).length;

  const canManage = currentUser?.role === 'admin';

  async function handleToggleActive(user: SessionUser) {
    if (!sessionToken) {
      return;
    }

    setSavingId(user.id);
    setError(null);
    try {
      await updateUserAccount(sessionToken, user.id, { active: !user.active });
      setRefreshToken((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No se pudo actualizar el usuario');
    } finally {
      setSavingId(null);
    }
  }

  async function handleRoleChange(user: SessionUser, role: UserRole) {
    if (!sessionToken || user.role === role) {
      return;
    }

    setSavingId(user.id);
    setError(null);
    try {
      await updateUserAccount(sessionToken, user.id, { role });
      setRefreshToken((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No se pudo actualizar el rol');
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await createUserAccount(sessionToken, {
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      });
      setNewUser({ name: '', email: '', password: '', role: 'viewer' });
      setRefreshToken((value) => value + 1);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el usuario');
    } finally {
      setCreating(false);
    }
  }

  if (!canManage) {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-[2rem] border border-rose-100 bg-rose-50 p-8 shadow-sm">
          <div className="flex items-center gap-3 text-rose-600 mb-4">
            <CircleAlert className="size-5" />
            <span className="text-xs font-bold uppercase tracking-[0.25em]">Acceso restringido</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Administración de usuarios</h2>
          <p className="text-slate-600 max-w-2xl">
            Solo un usuario con rol de administrador puede gestionar cuentas, roles y estado de acceso.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 shadow-sm">
            <Settings2 className="size-3.5 text-brand-primary" />
            Ajustes · usuarios
          </div>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Administración de usuarios</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Desde aquí puedes dar de alta usuarios, cambiar su rol y activar o desactivar accesos sin salir de Infidash.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-brand-primary/30 hover:text-slate-900"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Actualizar lista
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">Usuarios totales</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{userCount}</p>
          <p className="mt-1 text-sm text-slate-500">Cuentas registradas en el backend.</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">Administradores</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{adminCount}</p>
          <p className="mt-1 text-sm text-slate-500">Usuarios con permisos de gestión.</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">Usuarios activos</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{activeCount}</p>
          <p className="mt-1 text-sm text-slate-500">Acceso habilitado en la sesión actual.</p>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Usuarios del sistema</h3>
            <p className="text-sm text-slate-500">Edita estado y rol con cambios persistentes contra el backend.</p>
          </div>
          {loading && (
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-500">
              <LoaderCircle className="size-4 animate-spin" />
              Cargando...
            </div>
          )}
        </div>

        <div className="space-y-3">
          {sortedUsers.map((user) => {
            const isCurrentUser = user.id === currentUser?.id;

            return (
              <article
                key={user.id}
                className={cn(
                  'grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 lg:grid-cols-[1.6fr_0.8fr_1fr] lg:items-center',
                  isCurrentUser && 'border-brand-primary/20 bg-brand-primary/5'
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-white border border-slate-100 shadow-sm">
                    <Users className="size-5 text-slate-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-base font-bold text-slate-900">{user.name}</h4>
                      {isCurrentUser && (
                        <span className="rounded-full bg-brand-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary">
                          Tú
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="size-4" />
                        {user.email}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span>Creado {formatDate(user.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-center">
                  <span className={cn('rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]', roleBadgeClass(user.role))}>
                    {roleLabel(user.role)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]',
                      user.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-500'
                    )}
                  >
                    {user.active ? 'Activo' : 'Desactivado'}
                  </span>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                    <Shield className="size-4 text-slate-400" />
                    <select
                      value={user.role}
                      onChange={(event) => void handleRoleChange(user, event.target.value as UserRole)}
                      className="bg-transparent text-sm font-semibold outline-none"
                      disabled={savingId === user.id}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => void handleToggleActive(user)}
                    disabled={savingId === user.id}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-wait disabled:opacity-70',
                      user.active
                        ? 'border border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:text-rose-600'
                        : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    )}
                  >
                    <BadgeCheck className="size-4" />
                    {user.active ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </article>
            );
          })}

          {!loading && sortedUsers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No hay usuarios para mostrar.
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={(event) => void handleCreateUser(event)} className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
              <UserPlus className="size-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Dar de alta usuario</h3>
              <p className="text-sm text-slate-500">Crea una nueva cuenta con rol inicial y contraseña temporal.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Nombre</span>
              <input
                type="text"
                value={newUser.name}
                onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-brand-primary focus:bg-white"
                placeholder="Nombre completo"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Email</span>
              <input
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-brand-primary focus:bg-white"
                placeholder="usuario@infidash.local"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Contraseña</span>
              <input
                type="password"
                value={newUser.password}
                onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-brand-primary focus:bg-white"
                placeholder="Contraseña temporal"
                minLength={8}
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Rol inicial</span>
              <select
                value={newUser.role}
                onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-brand-primary focus:bg-white"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              El usuario se guardará en el backend y podrá iniciar sesión de inmediato.
            </div>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
            >
              {creating ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Crear usuario
            </button>
          </div>
        </form>

        <aside className="rounded-[2rem] border border-slate-100 bg-slate-50 p-6">
          <h3 className="text-xl font-bold text-slate-900">Guía rápida</h3>
          <div className="mt-4 space-y-4 text-sm text-slate-600">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">Roles disponibles</p>
              <div className="mt-3 space-y-3">
                {ROLE_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-start gap-3">
                    <span className={cn('mt-0.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em]', roleBadgeClass(option.value))}>
                      {option.label}
                    </span>
                    <p className="text-xs leading-5 text-slate-500">{option.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">Seguridad</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Las acciones de alta y edición quedan registradas contra la API de Infidash; no se manejan credenciales en el navegador.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
