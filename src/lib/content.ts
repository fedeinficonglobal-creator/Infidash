import { endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import type { ContentJob, EditorialReadiness, JobKind, PlanItem, PlanStatus } from '../services/contentApi.js';

export interface ContentFilters { clientId: string; status: string; format: string; search: string; }

export function monthDays(month: Date) {
  return eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
}

export function itemsOnDay(items: PlanItem[], day: Date) {
  return items.filter((item) => item.plannedAt && isSameDay(parseISO(item.plannedAt), day));
}

export function filterItems(items: PlanItem[], filters: ContentFilters) {
  const search = filters.search.trim().toLocaleLowerCase('es');
  return items.filter((item) => {
    if (filters.clientId && item.clientId !== filters.clientId) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.format && item.format !== filters.format) return false;
    if (search && ![item.title, item.theme, item.keywordPrimary, item.format].some((value) => value?.toLocaleLowerCase('es').includes(search))) return false;
    return true;
  });
}

export function jobsForTimeline(jobs: ContentJob[], planItemId: string, contentId: string | null, publicationIds: string[]) {
  const targets = new Set([planItemId, contentId, ...publicationIds].filter((id): id is string => Boolean(id)));
  return jobs.filter((job) => job.targetId !== null && targets.has(job.targetId));
}

/** Auto-refresh cadence for the Contenidos screen: fast only while n8n may still change something. */
export function contentRefreshDelayMs(jobs: Pick<ContentJob, 'status'>[]) {
  return jobs.some((job) => job.status === 'pending' || job.status === 'running') ? 30_000 : 300_000;
}

/** Job-creating actions are only offered when the client has editorial automation enabled and an n8n workflow bound for that kind. */
export function canRunJob(readiness: EditorialReadiness | null | undefined, kind: JobKind) { return Boolean(readiness?.enabled && readiness.jobs?.[kind]); }

/** Brief-tab actions: "Marcar como fallida" unsticks a generation that never reported back (see POST /release-generation). */
export function planItemActions(item: Pick<PlanItem, 'status'>, { admin, readiness }: { admin: boolean; readiness: EditorialReadiness | null | undefined }) {
  const generateContent = admin && canRunJob(readiness, 'generate_content');
  return { generateContent, generateContentEnabled: generateContent && ['approved', 'review', 'ready', 'generation_failed'].includes(item.status), releaseGeneration: admin && item.status === 'generating' };
}

/** Manual retries need a fresh key; the server's JOB_IN_PROGRESS guard is what prevents duplicates. */
export function timestampedIdempotencyKey(prefix: string, now = Date.now()) { return `${prefix}:${now}`; }

/** One entry per line (and per comma when `commas`), trimmed, blanks dropped; the server validates and de-duplicates. */
export function splitPlanInputs(text: string, { commas }: { commas: boolean }) {
  return text.split(commas ? /[\r\n,]+/ : /[\r\n]+/).map((value) => value.trim()).filter(Boolean);
}

/** Status shown for a plan item: a published or scheduled publication outranks the item's own editorial status. Cancelled, failed or pending publications do not. */
export function displayStatus(itemStatus: PlanStatus, publications: ReadonlyArray<{ status: string }>): PlanStatus | 'published' | 'scheduled' {
  if (publications.some((publication) => publication.status === 'published')) return 'published';
  if (publications.some((publication) => publication.status === 'scheduled')) return 'scheduled';
  return itemStatus;
}

/** Publications behind the popup badge: the loaded detail list (fresh after scheduling/cancelling) when it belongs to this item, else the list summary. */
export function displayPublications(item: Pick<PlanItem, 'contentId' | 'publications'>, content: { id: string } | null | undefined, detail: ReadonlyArray<{ status: string }>): ReadonlyArray<{ status: string }> {
  return item.contentId && content?.id === item.contentId ? detail : item.publications;
}

export function canCancelPublication(status: string) { return ['pending', 'scheduled', 'failed', 'unknown'].includes(status); }
export function canReschedulePublication(status: string) { return status === 'scheduled'; }

export function plainTextPreview(html: string | null | undefined, text: string | null | undefined) {
  if (text?.trim()) return text.trim();
  if (!html) return '';
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = stripped;
    return decoder.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  return stripped.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatEditorialDate(value: string | null) {
  return value ? format(parseISO(value), "d MMM yyyy, HH:mm", { locale: es }) : 'Sin fecha';
}

export function monthLabel(month: Date) { return format(month, 'MMMM yyyy', { locale: es }); }
export function isOutsideMonth(day: Date, month: Date) { return !isSameMonth(day, month); }

export function statusLabel(status: string) {
  return ({ proposed: 'Propuesto', approved: 'Aprobado', generating: 'Generando', review: 'En revisión', ready: 'Listo', generation_failed: 'Error de generación', archived: 'Archivado', pending: 'Pendiente', sending: 'Enviando', scheduled: 'Programado', published: 'Publicado', failed: 'Error', unknown: 'Por comprobar', cancel_requested: 'Cancelando', cancelled: 'Cancelado', draft: 'Borrador' } as Record<string, string>)[status] ?? status;
}
