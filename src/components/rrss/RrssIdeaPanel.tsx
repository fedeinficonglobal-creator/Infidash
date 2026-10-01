import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertCircle, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useClientStore } from '../../store/useClientStore.js';
import { useRrssStore } from '../../store/useRrssStore.js';
import { canRunJob, formatEditorialDate } from '../../lib/content.js';
import { RRSS_FORMATS, RRSS_NETWORKS, canGeneratePosts, formatLabel, networkFromInstanceKey, networkLabel, preselectAccountIds } from '../../lib/rrss.js';
import type { RrssIdea } from '../../services/rrssApi.js';
import { Button, Field } from '../content/controls.js';
import { ContentStatusBadge } from '../content/ContentStatusBadge.js';
import { SocialPostCard } from './SocialPostCard.js';

const toLocalInput = (value: string | null) => value ? format(parseISO(value), "yyyy-MM-dd'T'HH:mm") : '';

/** Network checkboxes shared by the idea form, the new-idea form and the plan dialog. */
export function NetworkCheckboxes({ value, onChange, disabled }: { value: string[]; onChange: (networks: string[]) => void; disabled?: boolean }) {
  return <fieldset className="space-y-1"><legend className="text-xs font-bold text-slate-500">Redes</legend><div className="mt-1 flex flex-wrap gap-3">{RRSS_NETWORKS.map((network) => <label key={network} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" disabled={disabled} checked={value.includes(network)} onChange={(event) => onChange(event.target.checked ? [...value, network] : value.filter((item) => item !== network))} className="size-4 rounded border-slate-300" />{networkLabel(network)}</label>)}</div></fieldset>;
}

export function FormatSelect({ value, onChange, disabled }: { value: string; onChange: (format: string) => void; disabled?: boolean }) {
  return <label className="block text-xs font-bold text-slate-500">Formato<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-100"><option value="">Sin formato</option>{RRSS_FORMATS.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}{value && !(RRSS_FORMATS as readonly string[]).includes(value) && <option value={value}>{value}</option>}</select></label>;
}

function GeneratePostsDialog({ idea, onClose }: { idea: RrssIdea; onClose: () => void }) {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const { publishingAccounts, loadAccounts, generatePosts } = useRrssStore();
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [generateImage, setGenerateImage] = useState(true);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed by the network list's content: a background refresh hands a new array and must not reset the selection.
  const networksKey = idea.networks.join(',');
  useEffect(() => {
    let active = true;
    void loadAccounts(token).finally(() => {
      if (!active) return;
      setAccountIds(preselectAccountIds(useRrssStore.getState().publishingAccounts, networksKey.split(',').filter(Boolean)));
      setIsLoadingAccounts(false);
    });
    return () => { active = false; };
  }, [idea.id, networksKey, loadAccounts, token]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" role="dialog" aria-modal="true" aria-label="Generar posts">
    <form className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try { await generatePosts(token, idea.id, { accountIds, generateImage }); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la generación de los posts'); }
      finally { setIsSubmitting(false); }
    }}>
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Generar posts</h2><Button type="button" onClick={onClose} className="bg-slate-100 px-3 text-slate-700" aria-label="Cerrar"><X className="size-4" /></Button></div>
      <p className="text-xs text-slate-500">Se creará un borrador por cuenta. Los posts ya programados no se sobrescriben.</p>
      <fieldset className="space-y-1"><legend className="text-xs font-bold text-slate-500">Cuentas</legend>
        {isLoadingAccounts ? <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Cargando cuentas…</p>
          : publishingAccounts.length ? <div className="mt-1 space-y-1 rounded-xl border border-slate-200 p-2">{publishingAccounts.map((account) => <label key={account.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={accountIds.includes(account.id)} onChange={(event) => setAccountIds(event.target.checked ? [...accountIds, account.id] : accountIds.filter((id) => id !== account.id))} className="size-4 rounded border-slate-300" />{account.label} · {networkLabel(networkFromInstanceKey(account.instanceKey))}</label>)}</div>
          : <p className="text-xs font-semibold text-amber-700">No hay cuentas de redes sociales (Postiz) activas para este cliente.</p>}
      </fieldset>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={generateImage} onChange={(event) => setGenerateImage(event.target.checked)} className="size-4 rounded border-slate-300" />Generar imagen con IA</label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" onClick={onClose} className="bg-slate-100 text-slate-700">Cancelar</Button><Button type="submit" disabled={isSubmitting || isLoadingAccounts || !accountIds.length} className="bg-slate-900 text-white">{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Generar posts</Button></div>
    </form>
  </div>;
}

/** Drawer with the idea brief, its status actions and its social post drafts. */
export function RrssIdeaPanel() {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const role = useClientStore((state) => state.currentUser?.role);
  const { items, selectedId, socialPosts, uploads, readiness, isLoadingDetail, isSaving, detailError, conflict, select, saveIdea, releaseGeneration, saveCopy, removeMedia, moveMedia, uploadFiles, dismissUpload, approvePost, discardPost, schedulePost, refresh, clearConflict } = useRrssStore();
  const idea = items.find((candidate) => candidate.id === selectedId) ?? null;
  const [draft, setDraft] = useState({ title: '', theme: '', rationale: '', format: '', networks: [] as string[], cta: '', plannedAt: '' });
  const [generating, setGenerating] = useState(false);
  useEffect(() => { if (idea) setDraft({ title: idea.title, theme: idea.theme ?? '', rationale: idea.rationale ?? '', format: idea.format ?? '', networks: [...idea.networks], cta: idea.cta ?? '', plannedAt: toLocalInput(idea.plannedAt) }); }, [idea?.id, idea?.version]); // Keyed by id+version: a background refresh must not wipe unsaved edits.
  if (!idea) return null;
  const admin = role === 'admin';
  const ignore = () => { /* the store already surfaced the error in the panel */ };
  const close = () => { setGenerating(false); void select(token, null); };
  const release = () => { if (!window.confirm('¿Marcar la generación como fallida? Revisa antes que no se hayan creado ya los borradores para no duplicarlos.')) return; void releaseGeneration(token, idea.id).catch(ignore); };
  return <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30" role="dialog" aria-modal="true" aria-label={`Detalle de ${idea.title}`} onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-5 backdrop-blur"><div className="flex items-start justify-between gap-4"><div><ContentStatusBadge status={idea.status} /><h2 className="mt-2 text-xl font-bold text-slate-900">{idea.title}</h2><p className="mt-1 text-xs text-slate-500">{formatEditorialDate(idea.plannedAt)} · {formatLabel(idea.format)}</p></div><Button onClick={close} className="bg-slate-100 px-3 text-slate-700" aria-label="Cerrar detalle"><X className="size-4" /></Button></div></div>
    <div className="space-y-6 p-5">
      {conflict && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex gap-2"><AlertCircle className="size-5 shrink-0" /><div><p className="font-bold">Hay una versión más reciente</p><p className="mt-1">{conflict}</p><Button className="mt-3 bg-amber-900 text-white" onClick={() => { clearConflict(); void refresh(token).then(() => select(token, idea.id)); }}>Recargar datos</Button></div></div></div>}
      {detailError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{detailError}</p>}
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!admin) return; void saveIdea(token, idea.id, { title: draft.title, theme: draft.theme, rationale: draft.rationale, format: draft.format || undefined, networks: draft.networks, cta: draft.cta, plannedAt: draft.plannedAt ? new Date(draft.plannedAt).toISOString() : null }).catch(ignore); }}>
        <Field label="Título" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} disabled={!admin} required />
        <Field label="Tema" value={draft.theme} onChange={(theme) => setDraft({ ...draft, theme })} disabled={!admin} />
        <Field label="Enfoque" value={draft.rationale} onChange={(rationale) => setDraft({ ...draft, rationale })} disabled={!admin} multiline rows={3} />
        <div className="grid gap-3 sm:grid-cols-2"><FormatSelect value={draft.format} onChange={(formatValue) => setDraft({ ...draft, format: formatValue })} disabled={!admin} /><Field label="Fecha" type="datetime-local" value={draft.plannedAt} onChange={(plannedAt) => setDraft({ ...draft, plannedAt })} disabled={!admin} /></div>
        <NetworkCheckboxes value={draft.networks} onChange={(networks) => setDraft({ ...draft, networks })} disabled={!admin} />
        <Field label="CTA" value={draft.cta} onChange={(cta) => setDraft({ ...draft, cta })} disabled={!admin} />
        {admin && <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSaving || !draft.title.trim()} className="bg-brand-primary text-white">Guardar cambios</Button>
          {idea.status === 'proposed' && <Button type="button" disabled={isSaving} onClick={() => void saveIdea(token, idea.id, { status: 'approved' }).catch(ignore)} className="bg-emerald-600 text-white">Aprobar idea</Button>}
          {canGeneratePosts(idea, readiness) && <Button type="button" disabled={isSaving} onClick={() => setGenerating(true)} className="bg-slate-900 text-white"><Sparkles className="size-4" />Generar posts</Button>}
          {idea.status === 'generating' && <Button type="button" disabled={isSaving} onClick={release} className="border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"><AlertCircle className="size-4" />Marcar como fallida</Button>}
        </div>}
      </form>
      <section aria-label="Borradores" className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Borradores</h3>
        {isLoadingDetail && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Cargando borradores…</p>}
        {idea.status === 'generating' && <p className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800"><LoaderCircle className="size-4 shrink-0 animate-spin" />Generando posts… los borradores aparecerán aquí automáticamente.</p>}
        {!isLoadingDetail && !socialPosts.length && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Esta idea todavía no tiene borradores.</p>}
        {socialPosts.map((post) => <SocialPostCard key={post.id} post={post} admin={admin} canPublish={canRunJob(readiness, 'publish')} busy={isSaving} uploads={uploads[post.id] ?? []}
          onSaveCopy={(copy) => void saveCopy(token, post.id, copy).catch(ignore)}
          onRemoveMedia={(index) => void removeMedia(token, post.id, index).catch(ignore)}
          onMoveMedia={(index, delta) => void moveMedia(token, post.id, index, delta).catch(ignore)}
          onUpload={(files) => void uploadFiles(token, post.id, files)}
          onDismissUpload={(key) => dismissUpload(post.id, key)}
          onApprove={() => void approvePost(token, post.id).catch(ignore)}
          onDiscard={() => { if (window.confirm('¿Descartar este borrador?')) void discardPost(token, post.id).catch(ignore); }}
          onSchedule={(input) => void schedulePost(token, post.id, input).catch(ignore)} />)}
      </section>
    </div>
    {generating && <GeneratePostsDialog idea={idea} onClose={() => setGenerating(false)} />}
  </aside></div>;
}
