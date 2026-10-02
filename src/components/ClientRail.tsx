import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Home, Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Client } from '../store/useClientStore.js';
import { cn } from '../lib/utils.js';
import { DASHBOARD_PATH, clientPath } from '../lib/routes.js';
import { filterClients, sortClients } from '../lib/clientAvatar.js';
import { InitialsAvatar } from './InitialsAvatar.js';

const railTileClass =
  'relative w-[4.25rem] shrink-0 flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary';
const railTileIdle = 'text-slate-500 hover:bg-white/80 hover:text-slate-800';
const railTileActive = 'bg-white text-slate-900 shadow-sm';
const railIconClass = 'size-8 shrink-0 rounded-lg flex items-center justify-center';
const railLabelClass = 'w-full text-center text-[10px] font-semibold leading-tight line-clamp-2 break-words';
// Scrolls without a visible scrollbar; the edges fade so it is clear there is more.
const railScrollClass =
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]';

function ClientSearch({ clients }: { clients: Client[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const matches = filterClients(sortClients(clients), query);

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
        className={cn(railTileClass, open ? railTileActive : railTileIdle)}
      >
        <span className={railIconClass}><Search className="size-5" /></span>
        <span className={railLabelClass}>Buscar</span>
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
                    <InitialsAvatar name={client.name} seed={client.slug} logo={client.logo} decorative className="text-[10px]" />
                  </span>
                  <span className="truncate">{client.name}</span>
                </Link>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-slate-500">Sin resultados</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One client avatar tile. Memoized: client objects keep their identity between unrelated store updates, so only the previously and newly active tiles re-render on navigation. */
const ClientRailTile = memo(function ClientRailTile({ client, isActive }: { client: Client; isActive: boolean }) {
  return (
    <li className="relative w-full flex justify-center">
      {isActive && (
        <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 rounded-r-full bg-brand-primary" />
      )}
      <Link
        to={clientPath(client.slug)}
        aria-label={client.name}
        title={client.name}
        aria-current={isActive ? 'page' : undefined}
        className={cn(railTileClass, isActive ? railTileActive : railTileIdle)}
      >
        <span className={cn(railIconClass, 'overflow-hidden', isActive && 'ring-2 ring-brand-primary')}>
          <InitialsAvatar name={client.name} seed={client.slug} logo={client.logo} decorative className="text-[11px]" />
        </span>
        <span className={railLabelClass}>{client.name}</span>
      </Link>
    </li>
  );
});

/** Narrow vertical rail with the agency home button, one avatar per client and a client search. */
export function ClientRail({ clients, activeClientId }: { clients: Client[]; activeClientId: string | null }) {
  const { pathname } = useLocation();
  const isDashboard = !activeClientId && pathname === DASHBOARD_PATH;

  return (
    <nav aria-label="Clientes" className="w-20 shrink-0 h-full bg-slate-50 border-r border-slate-200 flex flex-col items-center py-3 gap-2">
      <Link
        to={DASHBOARD_PATH}
        aria-label="Dashboard de la agencia"
        title="Dashboard de la agencia"
        aria-current={isDashboard ? 'page' : undefined}
        className={cn(railTileClass, isDashboard ? railTileActive : railTileIdle)}
      >
        <span className={cn(railIconClass, isDashboard && 'bg-brand-primary text-white')}><Home className="size-5" /></span>
        <span className={railLabelClass}>Inicio</span>
      </Link>

      <div className="w-8 border-t border-slate-200" />

      <ul className={cn('flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-1 py-3', railScrollClass)}>
        {sortClients(clients).map((client) => <ClientRailTile key={client.id} client={client} isActive={client.id === activeClientId} />)}
      </ul>

      <ClientSearch clients={clients} />
    </nav>
  );
}
