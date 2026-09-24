export type PlanStatus = 'proposed' | 'approved' | 'generating' | 'review' | 'ready' | 'generation_failed' | 'archived';
export type ContentStatus = 'draft' | 'review' | 'approved' | 'archived';
export type PublicationStatus = 'pending' | 'sending' | 'scheduled' | 'published' | 'failed' | 'unknown' | 'cancel_requested' | 'cancelled' | 'draft';
export type JobKind = 'generate_plan' | 'generate_content' | 'publish' | 'reschedule' | 'cancel' | 'reconcile';

export interface ContentSummary {
  planItems: Partial<Record<PlanStatus, number>>;
  contents: Partial<Record<ContentStatus, number>>;
  publications: Partial<Record<PublicationStatus, number>>;
  incidents: number;
}

export interface PublicationSummary {
  id: string;
  status: PublicationStatus;
  desiredScheduledAt: string | null;
  confirmedScheduledAt: string | null;
}

export interface PlanItem {
  id: string;
  clientId: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  theme: string | null;
  rationale: string | null;
  format: string | null;
  keywordPrimary: string | null;
  keywords: string[];
  entities: string[];
  cta: string | null;
  priority: string | null;
  plannedAt: string | null;
  status: PlanStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  contentId: string | null;
  contentStatus: ContentStatus | null;
  contentTitle: string | null;
  contentVersion: number | null;
  publications: PublicationSummary[];
}

export interface ContentRevision {
  id: string;
  revisionNumber: number;
  contentSnapshot: Record<string, unknown>;
  authorType: string;
  authorId: string | null;
  createdAt: string;
}

export interface ContentItem {
  id: string;
  clientId: string;
  planItemId: string | null;
  title: string;
  bodyHtml: string | null;
  bodyText: string | null;
  excerpt: string | null;
  seo: Record<string, unknown>;
  status: ContentStatus;
  currentRevision: number;
  approvedRevisionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  revisions: ContentRevision[];
}

export interface Publication {
  id: string;
  clientId: string;
  contentId: string;
  accountId: string;
  accountLabel: string;
  provider: string;
  platform: string | null;
  copy: string | null;
  status: PublicationStatus;
  desiredScheduledAt: string | null;
  confirmedScheduledAt: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublishingAccount {
  id: string;
  clientId: string;
  provider: 'wordpress' | 'postiz';
  instanceKey: string;
  externalAccountId: string | null;
  platform: string;
  label: string;
  timezone: string;
  active: boolean;
}

export interface EditorialCalendar { id: string; clientId: string; title: string; status: string; startDate: string | null; endDate: string | null; }
export interface ContentJob { id: string; clientId: string; kind: JobKind; status: string; targetId: string | null; attemptCount?: number; nextAttemptAt?: string | null; lockedUntil?: string | null; lastError: string | null; createdAt: string; updatedAt: string; }
export interface Page<T> { items: T[]; nextCursor: string | null; }

export class ContentApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string | null) { super(message); }
}

function camelKey(key: string) { return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()); }
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelize(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [camelKey(key), camelize(item)])) as T;
  }
  return value as T;
}

async function request<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!response.ok) throw new ContentApiRequestError(payload?.error ?? `La solicitud falló (${response.status})`, response.status, payload?.code ?? null);
  return camelize<T>(payload);
}

function queryString(input: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, String(value)); });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export function getContentSummary(token: string, filters: { clientId?: string; from?: string; to?: string }, signal?: AbortSignal) {
  return request<{ summary: ContentSummary }>(`/api/content/summary${queryString(filters)}`, token, { signal });
}

export function getPlanItems(token: string, filters: { clientId?: string; from?: string; to?: string; status?: string; format?: string; search?: string; includeUndated?: boolean; cursor?: string; limit?: number }, signal?: AbortSignal) {
  return request<Page<PlanItem>>(`/api/content/plan-items${queryString(filters)}`, token, { signal });
}

export function getEditorialCalendars(token: string, clientId: string, signal?: AbortSignal) {
  return request<Page<EditorialCalendar>>(`/api/clients/${encodeURIComponent(clientId)}/editorial-calendars?limit=100`, token, { signal });
}

export function createEditorialCalendar(token: string, clientId: string, input: { title: string; startDate?: string; endDate?: string }) {
  return request<{ calendar: EditorialCalendar }>(`/api/clients/${encodeURIComponent(clientId)}/editorial-calendars`, token, { method: 'POST', body: JSON.stringify(input) });
}

export function getContentItem(token: string, id: string, signal?: AbortSignal) {
  return request<{ content: ContentItem }>(`/api/content/items/${encodeURIComponent(id)}`, token, { signal });
}

export function getPublications(token: string, id: string, signal?: AbortSignal) {
  return request<Page<Publication>>(`/api/content/items/${encodeURIComponent(id)}/publications?limit=100`, token, { signal });
}

export function getPublishingAccounts(token: string, clientId: string, signal?: AbortSignal) {
  return request<{ accounts: PublishingAccount[] }>(`/api/clients/${encodeURIComponent(clientId)}/publishing-accounts`, token, { signal });
}

export function schedulePublication(token: string, contentId: string, input: { clientId: string; expectedVersion: number; accountId: string; desiredScheduledAt: string; externalUrl?: string; occurrenceKey?: string; copy?: string; idempotencyKey: string }) {
  return request<{ publication: Publication; job: ContentJob; replayed: boolean }>(`/api/content/items/${encodeURIComponent(contentId)}/publications`, token, { method: 'POST', body: JSON.stringify(input) });
}

export function createPlanItem(token: string, input: Record<string, unknown>) {
  return request<{ planItem: PlanItem }>('/api/content/plan-items', token, { method: 'POST', body: JSON.stringify(input) });
}

export function updatePlanItem(token: string, id: string, input: Record<string, unknown>) {
  return request<{ planItem: PlanItem }>(`/api/content/plan-items/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: JSON.stringify(input) });
}

export function updateContentItem(token: string, id: string, input: Record<string, unknown>) {
  return request<{ content: ContentItem }>(`/api/content/items/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: JSON.stringify(input) });
}

export function approveContentItem(token: string, id: string, revisionId: string, version: number) {
  return request<{ content: ContentItem }>(`/api/content/items/${encodeURIComponent(id)}/approve`, token, { method: 'POST', body: JSON.stringify({ revisionId, version }) });
}

export function createContentJob(token: string, input: { clientId: string; kind: JobKind; targetId?: string; expectedVersion?: number; idempotencyKey: string; payload?: Record<string, unknown> }) {
  return request<{ job: ContentJob; replayed: boolean }>('/api/content/jobs', token, { method: 'POST', body: JSON.stringify(input) });
}

export function getContentJob(token: string, id: string, signal?: AbortSignal) {
  return request<{ job: ContentJob }>(`/api/content/jobs/${encodeURIComponent(id)}`, token, { signal });
}

export function getContentJobs(token: string, filters: { clientId?: string; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal) {
  return request<Page<ContentJob>>(`/api/content/jobs${queryString(filters)}`, token, { signal });
}
