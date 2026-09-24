import { endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import type { ContentJob, PlanItem } from '../services/contentApi.js';

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
