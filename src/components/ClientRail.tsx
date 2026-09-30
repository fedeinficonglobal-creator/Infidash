import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Home, Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Client } from '../store/useClientStore.js';
import { cn } from '../lib/utils.js';
import { DASHBOARD_PATH, clientPath } from '../lib/routes.js';
import { clientColor, clientInitials, clientLogoUrl, filterClients } from '../lib/clientAvatar.js';

const railItemClass =
  'relative size-10 shrink-0 rounded-xl flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2';

function ClientAvatar({ client, className }: { client: Client; className?: string }) {
  const logoUrl = clientLogoUrl(client.logo);
  const [logoFailed, setLogoFailed] = useState(false);

  if (logoUrl && !logoFailed) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={cn('size-full rounded-[inherit] object-cover bg-white', className)}
        onError={() => setLogoFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-full rounded-[inherit] flex items-center justify-center text-xs font-bold tracking-wide',
        clientColor(client.slug),
        className,
      )}
    >
      {clientInitials(client.name)}
    </span>
  );
}

function ClientSearch({ clients }: { clients: Client[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const matches = filterClients(clients, query);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && matches[0]) {
      event.preventDefault();
      void navigate(clientPath(matches[0].slug));
      close();
    }
  };

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Buscar cliente"
        title="Buscar cliente"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          railItemClass,
          open ? 'bg-brand-primary/10 text-brand-primary' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
        )}
      >
        <Search className="size-5" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Buscar cliente"
          className="absolute left-full bottom-0 ml-3 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-3"
        >
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar cliente…"
            aria-label="Buscar cliente"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
          />
          <ul className="mt-2 max-h-72 overflow-y-auto space-y-0.5">
            {matches.map((client) => (
              <li key={client.id}>
                <Link
                  to={clientPath(client.slug)}
                  onClick={() => close()}
                  className="flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                >
                  <span className="size-7 shrink-0 rounded-lg overflow-hidden">
                    <ClientAvatar client={client} className="text-[10px]" />
                  </span>
                  <span className="truncate">{client.name}</span>
                </Link>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-slate-400">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Narrow vertical rail with the agency home button, one avatar per client and a client search. */
export function ClientRail({ clients, activeClientId }: { clients: Client[]; activeClientId: string | null }) {
  const { pathname } = useLocation();
  const isDashboard = !activeClientId && pathname === DASHBOARD_PATH;

  return (
    <nav aria-label="Clientes" className="w-16 shrink-0 h-full bg-slate-50 border-r border-slate-200 flex flex-col items-center py-4 gap-3">
      <Link
        to={DASHBOARD_PATH}
        aria-label="Dashboard de la agencia"
        title="Dashboard de la agencia"
        aria-current={isDashboard ? 'page' : undefined}
        className={cn(
          railItemClass,
          isDashboard ? 'bg-brand-primary text-white shadow-sm' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
        )}
      >
        <Home className="size-5" />
      </Link>

      <div className="w-8 border-t border-slate-200" />

      <ul className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-2 py-1">
        {clients.map((client) => {
          const isActive = client.id === activeClientId;
          return (
            <li key={client.id} className="relative w-full flex justify-center">
              {isActive && (
                <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 rounded-r-full bg-brand-primary" />
              )}
              <Link
                to={clientPath(client.slug)}
                aria-label={client.name}
                title={client.name}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  railItemClass,
                  isActive
                    ? 'ring-2 ring-brand-primary ring-offset-2 ring-offset-slate-50'
                    : 'opacity-80 hover:opacity-100 hover:rounded-lg',
                )}
              >
                <ClientAvatar client={client} />
              </Link>
            </li>
          );
        })}
      </ul>

      <ClientSearch clients={clients} />
    </nav>
  );
}
