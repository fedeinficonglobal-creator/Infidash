import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Send, Trash2, Upload, X } from 'lucide-react';
import { Button } from '../content/controls.js';
import { cn } from '../../lib/utils.js';
import { formatEditorialDate } from '../../lib/content.js';
import { CREATIVE_ACCEPT, MAX_POST_MEDIA, canEditPost, canSchedulePost, copyLimit, mediaKind, networkLabel, socialPostDisplayStatus, socialPostStatusLabel } from '../../lib/rrss.js';
import type { SocialPost } from '../../services/rrssApi.js';
import type { CreativeUpload } from '../../store/useRrssStore.js';

const STATUS_STYLE: Record<string, string> = {
  review: 'bg-amber-50 text-amber-800', approved: 'bg-emerald-50 text-emerald-700', scheduled: 'bg-indigo-50 text-indigo-700',
  published: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-slate-100 text-slate-500', discarded: 'bg-slate-100 text-slate-500', failed: 'bg-rose-50 text-rose-700',
};

const NETWORK_STYLE: Record<string, string> = { gmb: 'bg-sky-50 text-sky-700', facebook: 'bg-blue-50 text-blue-700', instagram: 'bg-fuchsia-50 text-fuchsia-700', other: 'bg-slate-100 text-slate-600' };

export function NetworkBadge({ network }: { key?: string; network: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', NETWORK_STYLE[network] ?? NETWORK_STYLE.other)}>{networkLabel(network)}</span>;
}

export function SocialPostStatusBadge({ status }: { status: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold', STATUS_STYLE[status] ?? STATUS_STYLE.review)}>{socialPostStatusLabel(status)}</span>;
}

export interface SocialPostCardProps {
  key?: string;
  post: SocialPost;
  admin: boolean;
  /** Whether the client has a publish workflow bound (scheduling is hidden otherwise). */
  canPublish: boolean;
  busy: boolean;
  uploads: CreativeUpload[];
  onSaveCopy: (copy: string) => void;
  onRemoveMedia: (index: number) => void;
  onMoveMedia: (index: number, delta: number) => void;
  onUpload: (files: File[]) => void;
  onDismissUpload?: (key: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onSchedule: (input: { desiredScheduledAt: string; externalUrl?: string }) => void;
}

/** One social post draft: copy editor, creative gallery with upload, and its review/schedule actions. */
export function SocialPostCard({ post, admin, canPublish, busy, uploads, onSaveCopy, onRemoveMedia, onMoveMedia, onUpload, onDismissUpload, onApprove, onDiscard, onSchedule }: SocialPostCardProps) {
  const [copy, setCopy] = useState(post.copy);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  useEffect(() => { setCopy(post.copy); }, [post.copy, post.version]);
  const editable = admin && canEditPost(post);
  const displayStatus = socialPostDisplayStatus(post);
  const limit = copyLimit(post.network);
  const schedulable = admin && canPublish && canSchedulePost(post);
  const mediaFull = post.media.length >= MAX_POST_MEDIA;
  const copyId = `social-copy-${post.id}`;
  return <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label={`Borrador para ${post.accountLabel ?? networkLabel(post.network)}`}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><NetworkBadge network={post.network} /><span className="text-sm font-bold text-slate-800">{post.accountLabel ?? 'Cuenta'}</span></div>
      <div className="text-right"><SocialPostStatusBadge status={displayStatus} />{post.status === 'scheduled' && post.publicationScheduledAt && <p className="mt-1 text-[11px] text-slate-500">{formatEditorialDate(post.publicationScheduledAt)}</p>}</div>
    </header>

    <div>
      <label htmlFor={copyId} className="text-xs font-bold text-slate-500">Texto del post</label>
      <textarea id={copyId} rows={5} value={copy} onChange={(event) => setCopy(event.target.value)} readOnly={!editable} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 read-only:bg-slate-100" />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className={cn('text-[11px] font-semibold', copy.length > limit ? 'text-rose-600' : 'text-slate-500')} aria-live="polite">{copy.length} / {limit}</span>
        {editable && <Button type="button" disabled={busy || !copy.trim() || copy === post.copy} onClick={() => onSaveCopy(copy)} className="bg-slate-900 px-3 py-1.5 text-xs text-white">Guardar texto</Button>}
      </div>
    </div>

    <div>
      <p className="text-xs font-bold text-slate-500">Creatividades ({post.media.length}/{MAX_POST_MEDIA})</p>
      {post.media.length ? <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{post.media.map((item, index) => <li key={`${item.url}-${index}`} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {mediaKind(item) === 'video'
          ? <video src={item.url} muted playsInline controls preload="metadata" className="aspect-square w-full bg-black object-cover" aria-label={item.name ?? `Vídeo ${index + 1}`} />
          : <img src={item.url} alt={item.name ?? `Imagen ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover" />}
        {editable && <div className="flex items-center justify-between gap-1 p-1">
          <div className="flex gap-1">
            <button type="button" disabled={busy || index === 0} onClick={() => onMoveMedia(index, -1)} aria-label={`Mover a la izquierda: ${item.name ?? `creatividad ${index + 1}`}`} className="rounded-md p-1 text-slate-600 hover:bg-white disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button type="button" disabled={busy || index === post.media.length - 1} onClick={() => onMoveMedia(index, 1)} aria-label={`Mover a la derecha: ${item.name ?? `creatividad ${index + 1}`}`} className="rounded-md p-1 text-slate-600 hover:bg-white disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
          <button type="button" disabled={busy} onClick={() => onRemoveMedia(index)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="size-3.5" />Quitar</button>
        </div>}
      </li>)}</ul> : <p className="mt-1 text-xs text-slate-500">Sin creatividades.</p>}
      {editable && <div className="mt-2 space-y-1">
        <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:border-brand-primary hover:text-brand-primary', mediaFull && 'pointer-events-none opacity-50')}>
          <Upload className="size-4" />Subir creatividad
          <input type="file" accept={CREATIVE_ACCEPT} multiple disabled={mediaFull} className="sr-only" onChange={(event) => { const files: File[] = event.target.files ? Array.from(event.target.files) : []; event.target.value = ''; if (files.length) onUpload(files); }} />
        </label>
        <p className="text-[11px] text-slate-500">Imágenes JPG, PNG o WEBP (máx. 10 MB) y vídeos MP4 o MOV (máx. 200 MB).</p>
      </div>}
      {uploads.length > 0 && <ul className="mt-2 space-y-1">{uploads.map((upload) => <li key={upload.key} className={cn('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs', upload.status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600')}>
        <span className="flex min-w-0 items-center gap-2">{upload.status === 'uploading' && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}<span className="truncate font-semibold">{upload.name}</span>{upload.status === 'uploading' ? <span>Subiendo…</span> : <span role="alert">{upload.error}</span>}</span>
        {upload.status === 'error' && onDismissUpload && <button type="button" onClick={() => onDismissUpload(upload.key)} aria-label={`Descartar aviso de ${upload.name}`} className="rounded p-0.5 hover:bg-white"><X className="size-3.5" /></button>}
      </li>)}</ul>}
    </div>

    {admin && <div className="flex flex-wrap gap-2">
      {post.status === 'review' && <Button type="button" disabled={busy} onClick={onApprove} className="bg-emerald-600 px-3 py-1.5 text-xs text-white">Aprobar</Button>}
      {schedulable && <Button type="button" disabled={busy} onClick={() => setScheduling(!scheduling)} className="bg-indigo-600 px-3 py-1.5 text-xs text-white"><Send className="size-3.5" />Programar</Button>}
      {canEditPost(post) && <Button type="button" disabled={busy} onClick={onDiscard} className="border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">Descartar</Button>}
    </div>}
    {schedulable && scheduling && <form className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" onSubmit={(event) => { event.preventDefault(); if (!scheduleAt) return; onSchedule({ desiredScheduledAt: new Date(scheduleAt).toISOString(), externalUrl: externalUrl.trim() || undefined }); setScheduling(false); }}>
      <label className="block text-xs font-bold text-slate-500">Fecha de publicación<input required type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="block text-xs font-bold text-slate-500">URL del enlace (opcional)<input type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      {post.network === 'gmb' && <p className="text-[11px] text-slate-500">Google Business necesita una URL para el botón de acción si el cliente no tiene configurada la URL de su web.</p>}
      <Button type="submit" disabled={busy || !scheduleAt} className="bg-indigo-600 px-3 py-1.5 text-xs text-white">Confirmar programación</Button>
    </form>}
  </article>;
}
