import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock3, LoaderCircle, Plus, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useClientStore } from '../../store/useClientStore.js';
import { useRrssStore } from '../../store/useRrssStore.js';
import { canRunJob, contentRefreshDelayMs, formatEditorialDate, splitPlanInputs, statusLabel } from '../../lib/content.js';
import { RRSS_FORMATS, draftsSummary, formatLabel, rrssIdeaDisplayStatus } from '../../lib/rrss.js';
import type { EditorialReadiness } from '../../services/contentApi.js';
import type { RrssFormat, RrssNetwork } from '../../services/rrssApi.js';
import { cn } from '../../lib/utils.js';
import { Button, Field } from '../content/controls.js';
import { Modal } from '../Modal.js';
import { ContentStatusBadge } from '../content/ContentStatusBadge.js';
import { FormatSelect, NetworkCheckboxes, RrssIdeaPanel } from './RrssIdeaPanel.js';
import { NetworkBadge } from './SocialPostCard.js';

const PLAN_STATUSES = ['proposed', 'approved', 'generating', 'review', 'ready', 'generation_failed', 'archived'];

export interface RrssToolbarProps {
  admin: boolean;
  readiness: EditorialReadiness | null | undefined;
  isRefreshing: boolean;
  lastUpdatedAt: string | null;
  onGeneratePlan: () => void;
  onNewIdea: () => void;
  onRefresh: () => void;
}

/** «Generar plan de redes» / «Nueva idea» (admins, gated by readiness) plus the refresh control. */
export function RrssToolbar({ admin, readiness, isRefreshing, lastUpdatedAt, onGeneratePlan, onNewIdea, onRefresh }: RrssToolbarProps) {
  const canPlan = canRunJob(readiness, 'generate_rrss_plan');
  const enabled = Boolean(readiness?.enabled);
  return <div className="flex flex-wrap items-center justify-between gap-3">
    {admin ? <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!canPlan || isRefreshing} title={readiness && !canPlan ? 'El workflow de plan de redes no está configurado para este cliente' : undefined} onClick={onGeneratePlan} className="bg-slate-900 text-white"><Sparkles className="size-4" />Generar plan de redes</Button>
      <Button type="button" disabled={!enabled} title={readiness && !enabled ? 'La automatización editorial no está activada para este cliente' : undefined} onClick={onNewIdea} className="bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"><Plus className="size-4" />Nueva idea</Button>
    </div> : <span />}
    <div className="flex items-center gap-2 text-xs text-slate-400"><Clock3 className="size-3.5" />{lastUpdatedAt ? `Actualizado ${format(parseISO(lastUpdatedAt), 'HH:mm:ss', { locale: es })}` : 'Pendiente de actualizar'}<button type="button" onClick={onRefresh} disabled={isRefreshing} aria-label="Actualizar publicaciones" className="rounded-lg p-2 hover:bg-white"><RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} /></button></div>
  </div>;
}

function GenerateRrssPlanDialog({ onClose }: { onClose: () => void }) {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const loadPlanInputs = useRrssStore((state) => state.loadPlanInputs);
  const generatePlan = useRrssStore((state) => state.generatePlan);
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [networks, setNetworks] = useState<string[]>([]);
  const [postsPerWeek, setPostsPerWeek] = useState('3');
  const [weeks, setWeeks] = useState('4');
  const [isLoadingInputs, setIsLoadingInputs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    loadPlanInputs(token)
      .then((inputs) => { if (!active) return; setTopic(inputs.topic); setKeywords(inputs.keywords.join('\n')); setNetworks(inputs.networks); if (inputs.postsPerWeek) setPostsPerWeek(String(inputs.postsPerWeek)); setWeeks(String(inputs.weeksHorizon)); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos del plan de redes'); })
      .finally(() => { if (active) setIsLoadingInputs(false); });
    return () => { active = false; };
  }, [loadPlanInputs, token]);
  const perWeek = Number(postsPerWeek);
  const weeksValue = Number(weeks);
  const valid = Boolean(topic.trim()) && networks.length > 0 && Number.isInteger(perWeek) && perWeek >= 1 && perWeek <= 14 && Number.isInteger(weeksValue) && weeksValue >= 1 && weeksValue <= 12;
  return <Modal open onClose={onClose} title="Generar plan de redes" size="md">
    <form className="space-y-4 p-6" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try { await generatePlan(token, { topic: topic.trim(), keywords: splitPlanInputs(keywords, { commas: true }), networks, postsPerWeek: perWeek, weeksHorizon: weeksValue }); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la generación del plan de redes'); }
      finally { setIsSubmitting(false); }
    }}>
      <p className="text-xs text-slate-500">El tema y las keywords orientan las ideas; se guardan para las próximas generaciones.</p>
      <Field label="Tema" value={topic} onChange={setTopic} disabled={isLoadingInputs} required maxLength={200} />
      <Field label="Keywords (una por línea o separadas por comas)" value={keywords} onChange={setKeywords} disabled={isLoadingInputs} multiline rows={4} />
      <NetworkCheckboxes value={networks} onChange={setNetworks} disabled={isLoadingInputs} />
      <div className="grid grid-cols-2 gap-3"><Field label="Posts por semana (1-14)" type="number" value={postsPerWeek} onChange={setPostsPerWeek} disabled={isLoadingInputs} required /><Field label="Semanas (1-12)" type="number" value={weeks} onChange={setWeeks} disabled={isLoadingInputs} required /></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" onClick={onClose} className="bg-slate-100 text-slate-700">Cancelar</Button><Button type="submit" disabled={isSubmitting || isLoadingInputs || !valid} className="bg-slate-900 text-white">{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Generar plan</Button></div>
    </form>
  </Modal>;
}

function NewIdeaDialog({ onClose }: { onClose: () => void }) {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const createIdea = useRrssStore((state) => state.createIdea);
  const select = useRrssStore((state) => state.select);
  const [draft, setDraft] = useState({ title: '', theme: '', rationale: '', format: '', networks: [] as string[], cta: '', plannedAt: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Modal open onClose={onClose} title="Nueva idea" size="md">
    <form className="space-y-4 p-6" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try {
        const idea = await createIdea(token, { title: draft.title.trim(), theme: draft.theme.trim() || null, rationale: draft.rationale.trim() || null, format: (draft.format || null) as RrssFormat | null, networks: draft.networks as RrssNetwork[], cta: draft.cta.trim() || null, ...(draft.plannedAt ? { plannedAt: new Date(draft.plannedAt).toISOString() } : {}) });
        onClose();
        void select(token, idea.id);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la idea'); }
      finally { setIsSubmitting(false); }
    }}>
      <Field label="Título" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} required maxLength={500} />
      <Field label="Tema" value={draft.theme} onChange={(theme) => setDraft({ ...draft, theme })} />
      <Field label="Enfoque" value={draft.rationale} onChange={(rationale) => setDraft({ ...draft, rationale })} multiline rows={3} />
      <FormatSelect value={draft.format} onChange={(formatValue) => setDraft({ ...draft, format: formatValue })} />
      <NetworkCheckboxes value={draft.networks} onChange={(networks) => setDraft({ ...draft, networks })} />
      <Field label="CTA" value={draft.cta} onChange={(cta) => setDraft({ ...draft, cta })} />
      <Field label="Fecha" type="datetime-local" value={draft.plannedAt} onChange={(plannedAt) => setDraft({ ...draft, plannedAt })} />
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" onClick={onClose} className="bg-slate-100 text-slate-700">Cancelar</Button><Button type="submit" disabled={isSubmitting || !draft.title.trim()} className="bg-brand-primary text-white">{isSubmitting && <LoaderCircle className="size-4 animate-spin" />}Crear idea</Button></div>
    </form>
  </Modal>;
}

/** «Publicaciones»: RRSS ideas with their AI drafts, creatives and scheduling. */
export function RrssPostsSection({ clientId }: { clientId: string }) {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const role = useClientStore((state) => state.currentUser?.role);
  const { clientId: storeClientId, filters, items, nextCursor, page, jobs, readiness, isLoading, isRefreshing, error, lastUpdatedAt, reset, setFilters, load, refresh, nextPage, previousPage, loadReadiness, pollJobs, select } = useRrssStore();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [ideaDialogOpen, setIdeaDialogOpen] = useState(false);
  const [dismissedPlanJobId, setDismissedPlanJobId] = useState<string | null>(null);
  useEffect(() => { reset(clientId); }, [clientId, reset]);
  useEffect(() => { if (storeClientId) void loadReadiness(token); }, [storeClientId, token, loadReadiness]);
  useEffect(() => { if (storeClientId) void load(token); }, [storeClientId, token, filters.status, filters.format, filters.search, load]);
  useEffect(() => {
    // Same adaptive cadence as Contenidos: every 30s while a job is in flight, every 5 minutes otherwise.
    let busy = false;
    let timer: number | undefined;
    let delay = 0;
    const schedule = () => { window.clearTimeout(timer); delay = contentRefreshDelayMs(useRrssStore.getState().jobs); timer = window.setTimeout(() => void tick(), delay); };
    const tick = async () => {
      if (busy) return;
      if (document.visibilityState !== 'visible') { schedule(); return; }
      busy = true;
      try { const refreshed = await pollJobs(token); if (!refreshed) await refresh(token); } finally { busy = false; schedule(); }
    };
    schedule();
    const unsubscribe = useRrssStore.subscribe((state, previous) => { if (!busy && state.jobs !== previous.jobs && contentRefreshDelayMs(state.jobs) < delay) schedule(); });
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); unsubscribe(); document.removeEventListener('visibilitychange', onVisible); };
  }, [pollJobs, refresh, token]);
  const admin = role === 'admin';
  const planJob = jobs.find((job) => job.kind === 'generate_rrss_plan');
  const showPlanBanner = Boolean(planJob && planJob.id !== dismissedPlanJobId);
  return <section aria-label="Publicaciones de redes sociales" className="space-y-5">
    <RrssToolbar admin={admin} readiness={readiness} isRefreshing={isRefreshing} lastUpdatedAt={lastUpdatedAt} onGeneratePlan={() => setPlanDialogOpen(true)} onNewIdea={() => setIdeaDialogOpen(true)} onRefresh={() => void refresh(token)} />
    {showPlanBanner && planJob && ['pending', 'running'].includes(planJob.status) && <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800"><LoaderCircle className="size-4 shrink-0 animate-spin" />Generando plan de redes… puede tardar varios minutos. Las ideas nuevas aparecerán aquí automáticamente.</div>}
    {showPlanBanner && planJob && planJob.status === 'unknown' && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">El resultado del plan de redes no está confirmado. Revisa el trabajo antes de crear otro.</div>}
    {showPlanBanner && planJob && planJob.status === 'succeeded' && <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><span>Plan de redes generado correctamente.</span><Button onClick={() => setDismissedPlanJobId(planJob.id)} aria-label="Cerrar aviso" className="bg-white px-3 text-emerald-700"><X className="size-4" /></Button></div>}
    {showPlanBanner && planJob && planJob.status === 'failed' && <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span>{planJob.lastError ?? 'La generación del plan de redes falló.'}</span><Button onClick={() => setDismissedPlanJobId(planJob.id)} aria-label="Cerrar aviso" className="bg-white px-3 text-rose-700"><X className="size-4" /></Button></div>}
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4">
      <label className="text-xs font-bold text-slate-500">Estado<select aria-label="Filtrar ideas por estado" value={filters.status} onChange={(event) => setFilters({ status: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><option value="">Todos</option>{PLAN_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-500">Formato<select aria-label="Filtrar ideas por formato" value={filters.format} onChange={(event) => setFilters({ format: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><option value="">Todos</option>{RRSS_FORMATS.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}</select></label>
      <label className="relative text-xs font-bold text-slate-500 md:col-span-2">Buscar<Search className="absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden="true" /><input aria-label="Buscar ideas" value={filters.search} onChange={(event) => setFilters({ search: event.target.value })} placeholder="Título o tema" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm" /></label>
    </div>
    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><span>{error}</span><Button onClick={() => void load(token)} className="bg-white px-3 text-rose-700">Reintentar</Button></div>}
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800">Ideas de redes</h3>
      {isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}</div>
        : !items.length ? <p className="p-8 text-center text-sm font-semibold text-slate-500">{filters.status || filters.format || filters.search ? 'Ninguna idea coincide con los filtros' : 'Todavía no hay ideas de redes sociales'}</p>
        : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Idea</th><th className="px-4 py-3">Formato</th><th className="px-4 py-3">Redes</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Borradores</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id} className="hover:bg-slate-50">
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatEditorialDate(item.plannedAt)}</td>
            <td className="px-4 py-3"><button type="button" onClick={() => void select(token, item.id)} className="text-left font-bold text-slate-800 hover:text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30">{item.title}</button></td>
            <td className="px-4 py-3 text-slate-600">{formatLabel(item.format)}</td>
            <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{item.networks.length ? item.networks.map((network) => <NetworkBadge key={network} network={network} />) : <span className="text-xs text-slate-400">—</span>}</div></td>
            <td className="px-4 py-3"><ContentStatusBadge status={rrssIdeaDisplayStatus(item.status, item.socialPosts)} /></td>
            <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{draftsSummary(item.socialPosts ?? [])}</td>
          </tr>)}</tbody></table></div>}
    </div>
    {(page > 1 || nextCursor) && <nav aria-label="Paginación de ideas" className="flex items-center justify-between gap-3"><Button onClick={() => void previousPage(token)} disabled={page <= 1 || isLoading} className="bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"><ChevronLeft className="size-4" />Anterior</Button><span className="text-xs font-bold text-slate-500">Página {page}</span><Button onClick={() => void nextPage(token)} disabled={!nextCursor || isLoading} className="bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">Siguiente<ChevronRight className="size-4" /></Button></nav>}
    <RrssIdeaPanel />
    {planDialogOpen && <GenerateRrssPlanDialog onClose={() => setPlanDialogOpen(false)} />}
    {ideaDialogOpen && <NewIdeaDialog onClose={() => setIdeaDialogOpen(false)} />}
  </section>;
}
