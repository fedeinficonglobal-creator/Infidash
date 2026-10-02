import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertCircle, FilePlus2, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import { useClientStore } from '../../store/useClientStore.js';
import { useRrssStore, type BulkUploadState } from '../../store/useRrssStore.js';
import { canRunJob, formatEditorialDate } from '../../lib/content.js';
import { CREATIVE_ACCEPT, RRSS_FORMATS, RRSS_NETWORKS, bulkUploadTargets, canGeneratePosts, copyLimit, formatLabel, manualDraftAccounts, networkFromInstanceKey, networkLabel, preselectAccountIds, rrssIdeaDisplayStatus, validateCreativeFile } from '../../lib/rrss.js';
import type { RrssIdea, SocialPost } from '../../services/rrssApi.js';
import { cn } from '../../lib/utils.js';
import { Button, Field } from '../content/controls.js';
import { Modal } from '../Modal.js';
import { useConfirm } from '../../hooks/useConfirm.js';
import { ContentStatusBadge } from '../content/ContentStatusBadge.js';
import { SocialPostCard } from './SocialPostCard.js';
import { useShallow } from 'zustand/react/shallow';
import { selectRrssAccounts, selectRrssDraftDialog, selectRrssIdeaDetail } from '../../store/selectors.js';

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
  const { publishingAccounts, loadAccounts, generatePosts } = useRrssStore(useShallow(selectRrssAccounts));
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
  return <Modal open onClose={onClose} title="Generar posts" size="md">
    <form className="space-y-4 p-6" onSubmit={async (event) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      try { await generatePosts(token, idea.id, { accountIds, generateImage }); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la generación de los posts'); }
      finally { setIsSubmitting(false); }
    }}>
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
  </Modal>;
}

const NO_EDITABLE_DRAFTS = 'No hay borradores editables (en revisión o aprobados)';

/** Files picked for a creative input, split into uploadable ones and per-file Spanish errors. */
function pickCreatives(list: FileList | null) {
  const files: File[] = list ? Array.from(list) : [];
  const valid: File[] = [];
  const errors: string[] = [];
  files.forEach((file) => { const invalid = validateCreativeFile(file); if (invalid) errors.push(`${file.name}: ${invalid}`); else valid.push(file); });
  return { valid, errors };
}

export interface RrssDraftsToolbarProps {
  admin: boolean;
  ideaStatus: string;
  posts: ReadonlyArray<Pick<SocialPost, 'status'>>;
  busy: boolean;
  bulkUpload: BulkUploadState | null;
  onNewDraft: () => void;
  onBulkUpload: (files: File[]) => void;
  onDismissBulkUpload?: () => void;
}

/** «Nuevo borrador» and «Subir creatividad para todos» (admins), with the bulk upload progress and summary. */
export function RrssDraftsToolbar({ admin, ideaStatus, posts, busy, bulkUpload, onNewDraft, onBulkUpload, onDismissBulkUpload }: RrssDraftsToolbarProps) {
  if (!admin) return null;
  const hasTargets = bulkUploadTargets(posts).length > 0;
  const running = bulkUpload?.status === 'running';
  const bulkDisabled = !hasTargets || busy || running;
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {ideaStatus !== 'generating' && <Button type="button" disabled={busy || running} onClick={onNewDraft} className="bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200"><FilePlus2 className="size-4" />Nuevo borrador</Button>}
      <label aria-disabled={bulkDisabled ? 'true' : undefined} title={hasTargets ? undefined : NO_EDITABLE_DRAFTS} className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-brand-primary hover:text-brand-primary', bulkDisabled && 'cursor-not-allowed opacity-50 hover:border-slate-300 hover:text-slate-600')}>
        <Upload className="size-4" />Subir creatividad para todos
        <input type="file" accept={CREATIVE_ACCEPT} multiple disabled={bulkDisabled} className="sr-only" onChange={(event) => { const files: File[] = event.target.files ? Array.from(event.target.files) : []; event.target.value = ''; if (files.length) onBulkUpload(files); }} />
      </label>
    </div>
    {running && <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600" aria-live="polite"><LoaderCircle className="size-4 shrink-0 animate-spin" />{bulkUpload?.progress ?? 'Subiendo…'}</p>}
    {bulkUpload?.status === 'done' && <div className={cn('space-y-1 rounded-xl p-3 text-xs', bulkUpload.failures.length ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800')} role="status">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">{bulkUpload.failures.length ? 'Algunas creatividades no se añadieron:' : 'Creatividades añadidas a todos los borradores editables.'}</p>
        {onDismissBulkUpload && <button type="button" onClick={onDismissBulkUpload} aria-label="Cerrar resumen de la subida" className="rounded p-0.5 hover:bg-white"><X className="size-3.5" /></button>}
      </div>
      {bulkUpload.failures.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{bulkUpload.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>}
      {bulkUpload.approvedReturned && <p className="font-semibold text-amber-800">Los borradores aprobados vuelven a revisión.</p>}
    </div>}
  </div>;
}

function NewDraftDialog({ idea, onClose }: { idea: RrssIdea; onClose: () => void }) {
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const { publishingAccounts, socialPosts, loadAccounts, createManualDraft } = useRrssStore(useShallow(selectRrssDraftDialog));
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [copy, setCopy] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<{ name: string; error: string }[] | null>(null);
  useEffect(() => {
    let active = true;
    void loadAccounts(token).finally(() => { if (active) setIsLoadingAccounts(false); });
    return () => { active = false; };
  }, [idea.id, loadAccounts, token]);
  const { accounts, emptyReason } = manualDraftAccounts(publishingAccounts, socialPosts);
  // Keep a valid selection: default to the first free account, and drop one that got a draft meanwhile.
  useEffect(() => { if (!failedFiles && !accounts.some((account) => account.id === accountId)) setAccountId(accounts[0]?.id ?? ''); }, [accounts.map((account) => account.id).join(','), accountId, failedFiles]);
  const selected = accounts.find((account) => account.id === accountId);
  const limit = copyLimit(selected ? networkFromInstanceKey(selected.instanceKey) : 'other');
  const created = failedFiles !== null;
  return <Modal open onClose={onClose} title="Nuevo borrador" size="md">
    <form className="space-y-4 p-6" onSubmit={async (event) => {
      event.preventDefault();
      if (created) { onClose(); return; }
      setError(null);
      setIsSubmitting(true);
      try {
        const result = await createManualDraft(token, idea.id, { accountId, copy, files });
        if (result.failedFiles.length) setFailedFiles(result.failedFiles); else onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el borrador'); }
      finally { setIsSubmitting(false); }
    }}>
      <p className="text-xs text-slate-500">Para posts hechos en otra herramienta (Canva, Photoshop, CapCut…): elige la cuenta, pega el texto y sube las creatividades.</p>
      <label className="block text-xs font-bold text-slate-500">Cuenta
        {isLoadingAccounts ? <span className="mt-1 flex items-center gap-2 text-sm font-normal text-slate-500"><LoaderCircle className="size-4 animate-spin" />Cargando cuentas…</span>
          : <select value={accountId} disabled={created || !accounts.length} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-100">{accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {networkLabel(networkFromInstanceKey(account.instanceKey))}</option>)}</select>}
      </label>
      {!isLoadingAccounts && emptyReason && !created && <p className="text-xs font-semibold text-amber-700">{emptyReason}</p>}
      <div>
        <label className="block text-xs font-bold text-slate-500">Texto del post<textarea rows={6} value={copy} disabled={created} onChange={(event) => setCopy(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-100" /></label>
        <span className={cn('text-[11px] font-semibold', copy.length > limit ? 'text-rose-600' : 'text-slate-500')} aria-live="polite">{copy.length} / {limit}</span>
      </div>
      <div className="space-y-1">
        <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:border-brand-primary hover:text-brand-primary', created && 'pointer-events-none opacity-50')}>
          <Upload className="size-4" />Añadir creatividades (opcional)
          <input type="file" accept={CREATIVE_ACCEPT} multiple disabled={created} className="sr-only" onChange={(event) => { const picked = pickCreatives(event.target.files); event.target.value = ''; setFiles([...files, ...picked.valid]); setFileErrors(picked.errors); }} />
        </label>
        <p className="text-[11px] text-slate-500">Imágenes JPG, PNG o WEBP (máx. 10 MB) y vídeos MP4 o MOV (máx. 200 MB).</p>
        {files.length > 0 && <ul className="space-y-1">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600"><span className="truncate font-semibold">{file.name}</span>{!created && <button type="button" onClick={() => setFiles(files.filter((_, position) => position !== index))} aria-label={`Quitar ${file.name}`} className="rounded p-0.5 hover:bg-white"><X className="size-3.5" /></button>}</li>)}</ul>}
        {fileErrors.length > 0 && <ul role="alert" className="space-y-0.5 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{fileErrors.map((line) => <li key={line}>{line}</li>)}</ul>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      {created && <div role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800"><p className="font-bold">El borrador se creó, pero no se pudieron subir estas creatividades:</p><ul className="mt-1 list-disc pl-4 text-xs">{failedFiles.map((file) => <li key={file.name}>{file.name}: {file.error}</li>)}</ul><p className="mt-1 text-xs">Puedes subirlas desde la tarjeta del borrador.</p></div>}
      <div className="flex justify-end gap-2">
        {!created && <Button type="button" onClick={onClose} className="bg-slate-100 text-slate-700">Cancelar</Button>}
        {created ? <Button type="submit" className="bg-slate-900 text-white">Cerrar</Button>
          : <Button type="submit" disabled={isSubmitting || isLoadingAccounts || !selected || !copy.trim()} className="bg-slate-900 text-white">{isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}Crear borrador</Button>}
      </div>
    </form>
  </Modal>;
}

/** Drawer with the idea brief, its status actions and its social post drafts. */
export function RrssIdeaPanel() {
  const confirm = useConfirm();
  const token = useClientStore((state) => state.sessionToken) ?? '';
  const role = useClientStore((state) => state.currentUser?.role);
  const { items, selectedId, socialPosts, uploads, bulkUpload, readiness, isLoadingDetail, isSaving, detailError, conflict, select, saveIdea, releaseGeneration, saveCopy, removeMedia, moveMedia, uploadFiles, uploadToAllDrafts, dismissBulkUpload, dismissUpload, approvePost, discardPost, schedulePost, refresh, clearConflict } = useRrssStore(useShallow(selectRrssIdeaDetail));
  const idea = items.find((candidate) => candidate.id === selectedId) ?? null;
  const [draft, setDraft] = useState({ title: '', theme: '', rationale: '', format: '', networks: [] as string[], cta: '', plannedAt: '' });
  const [generating, setGenerating] = useState(false);
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  useEffect(() => { if (idea) setDraft({ title: idea.title, theme: idea.theme ?? '', rationale: idea.rationale ?? '', format: idea.format ?? '', networks: [...idea.networks], cta: idea.cta ?? '', plannedAt: toLocalInput(idea.plannedAt) }); }, [idea?.id, idea?.version]); // Keyed by id+version: a background refresh must not wipe unsaved edits.
  if (!idea) return null;
  const admin = role === 'admin';
  const ignore = () => { /* the store already surfaced the error in the panel */ };
  const close = () => { setGenerating(false); setNewDraftOpen(false); void select(token, null); };
  const release = async () => { if (!(await confirm({ title: '¿Marcar la generación como fallida?', description: 'Revisa antes que no se hayan creado ya los borradores para no duplicarlos.', confirmLabel: 'Marcar como fallida', tone: 'danger' }))) return; void releaseGeneration(token, idea.id).catch(ignore); };
  return <Modal open onClose={close} variant="drawer" size="lg" hideHeader ariaLabel={`Detalle de ${idea.title}`}>
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-5 backdrop-blur"><div className="flex items-start justify-between gap-4"><div><ContentStatusBadge status={rrssIdeaDisplayStatus(idea.status, socialPosts)} /><h2 className="mt-2 text-xl font-bold text-slate-900">{idea.title}</h2><p className="mt-1 text-xs text-slate-500">{formatEditorialDate(idea.plannedAt)} · {formatLabel(idea.format)}</p></div><Button onClick={close} className="bg-slate-100 px-3 text-slate-700" aria-label="Cerrar detalle"><X className="size-4" /></Button></div></div>
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
        <RrssDraftsToolbar admin={admin} ideaStatus={idea.status} posts={socialPosts} busy={isSaving || isLoadingDetail} bulkUpload={bulkUpload}
          onNewDraft={() => setNewDraftOpen(true)}
          onBulkUpload={(files) => void uploadToAllDrafts(token, idea.id, files)}
          onDismissBulkUpload={dismissBulkUpload} />
        {isLoadingDetail && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Cargando borradores…</p>}
        {idea.status === 'generating' && <p className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800"><LoaderCircle className="size-4 shrink-0 animate-spin" />Generando posts… los borradores aparecerán aquí automáticamente.</p>}
        {!isLoadingDetail && !socialPosts.length && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">Esta idea todavía no tiene borradores.</p>}
        {socialPosts.map((post) => <SocialPostCard key={post.id} post={post} admin={admin} canPublish={canRunJob(readiness, 'publish')} busy={isSaving || bulkUpload?.status === 'running'} uploads={uploads[post.id] ?? []}
          onSaveCopy={(copy) => void saveCopy(token, post.id, copy).catch(ignore)}
          onRemoveMedia={(index) => void removeMedia(token, post.id, index).catch(ignore)}
          onMoveMedia={(index, delta) => void moveMedia(token, post.id, index, delta).catch(ignore)}
          onUpload={(files) => void uploadFiles(token, post.id, files)}
          onDismissUpload={(key) => dismissUpload(post.id, key)}
          onApprove={() => void approvePost(token, post.id).catch(ignore)}
          onDiscard={async () => { if (await confirm({ title: '¿Descartar este borrador?', description: 'Se descartará este borrador y no se publicará.', confirmLabel: 'Descartar borrador', tone: 'danger' })) void discardPost(token, post.id).catch(ignore); }}
          onSchedule={(input) => void schedulePost(token, post.id, input).catch(ignore)} />)}
      </section>
    </div>
    {generating && <GeneratePostsDialog idea={idea} onClose={() => setGenerating(false)} />}
    {newDraftOpen && <NewDraftDialog idea={idea} onClose={() => setNewDraftOpen(false)} />}
  </Modal>;
}
