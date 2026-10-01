import { queryString, request, type ContentJob, type Page, type PlanStatus, type PublicationStatus } from './contentApi.js';

export type RrssNetwork = 'gmb' | 'facebook' | 'instagram';
export type SocialNetwork = RrssNetwork | 'other';
export type RrssFormat = 'post' | 'reel' | 'carousel' | 'story';
export type SocialPostStatus = 'review' | 'approved' | 'scheduled' | 'discarded';

/** One creative of a draft; `type`/`name` are optional (older or AI media may only carry the URL). */
export interface SocialMedia { url: string; type?: 'image' | 'video'; name?: string; }

/** Compact draft summary embedded in each idea of the RRSS listing. */
export interface SocialPostSummary { id: string; accountId: string; network: SocialNetwork; status: SocialPostStatus; }

/** An RRSS idea: a plan item of an `rrss` calendar. */
export interface RrssIdea {
  id: string;
  clientId: string;
  calendarId: string;
  calendarTitle: string;
  title: string;
  theme: string | null;
  rationale: string | null;
  format: string | null;
  keywords: string[];
  cta: string | null;
  plannedAt: string | null;
  status: PlanStatus;
  networks: RrssNetwork[];
  version: number;
  createdAt: string;
  updatedAt: string;
  socialPosts: SocialPostSummary[];
}

export interface SocialPost {
  id: string;
  clientId: string;
  planItemId: string;
  accountId: string;
  accountLabel?: string;
  network: SocialNetwork;
  copy: string;
  media: SocialMedia[];
  status: SocialPostStatus;
  publicationId: string | null;
  publicationStatus?: PublicationStatus | null;
  publicationScheduledAt?: string | null;
  generationJobId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Plain values and string arrays: camelize() leaves them untouched. */
export interface RrssPlanInputs { topic: string; keywords: string[]; networks: string[]; postsPerWeek: number | null; weeksHorizon: number; }

export interface RrssIdeaInput { title: string; theme?: string | null; rationale?: string | null; format?: RrssFormat | null; networks?: RrssNetwork[]; cta?: string | null; plannedAt?: string; }

const clientPath = (clientId: string) => `/api/clients/${encodeURIComponent(clientId)}`;
const postPath = (id: string) => `/api/social-posts/${encodeURIComponent(id)}`;

export function getRrssItems(token: string, clientId: string, filters: { status?: string; format?: string; search?: string; cursor?: string; limit?: number }, signal?: AbortSignal) {
  return request<Page<RrssIdea>>(`${clientPath(clientId)}/rrss/items${queryString(filters)}`, token, { signal });
}

export function createRrssIdea(token: string, clientId: string, input: RrssIdeaInput) {
  return request<{ planItem: RrssIdea }>(`${clientPath(clientId)}/rrss/items`, token, { method: 'POST', body: JSON.stringify(input) });
}

export function getRrssPlanInputs(token: string, clientId: string, signal?: AbortSignal) {
  return request<RrssPlanInputs>(`${clientPath(clientId)}/rrss-plan-inputs`, token, { signal });
}

export function saveRrssPlanInputs(token: string, clientId: string, input: RrssPlanInputs) {
  return request<RrssPlanInputs>(`${clientPath(clientId)}/rrss-plan-inputs`, token, { method: 'PUT', body: JSON.stringify(input) });
}

export function getSocialPosts(token: string, planItemId: string, signal?: AbortSignal) {
  return request<{ socialPosts: SocialPost[] }>(`/api/content/plan-items/${encodeURIComponent(planItemId)}/social-posts`, token, { signal });
}

export function updateSocialPost(token: string, id: string, input: { copy?: string; media?: SocialMedia[]; expectedVersion: number }) {
  return request<{ socialPost: SocialPost }>(postPath(id), token, { method: 'PATCH', body: JSON.stringify(input) });
}

export function approveSocialPost(token: string, id: string, expectedVersion: number) {
  return request<{ socialPost: SocialPost }>(`${postPath(id)}/approve`, token, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function discardSocialPost(token: string, id: string, expectedVersion: number) {
  return request<{ socialPost: SocialPost }>(`${postPath(id)}/discard`, token, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function scheduleSocialPost(token: string, id: string, input: { desiredScheduledAt: string; externalUrl?: string; expectedVersion: number; idempotencyKey: string }) {
  return request<{ socialPost: SocialPost; publication: { id: string; status: PublicationStatus; confirmedScheduledAt: string | null }; job: ContentJob; replayed: boolean }>(`${postPath(id)}/schedule`, token, { method: 'POST', body: JSON.stringify(input) });
}

/** One creative per request, as multipart field `file`; the server forwards it to Postiz. */
export function uploadSocialPostMedia(token: string, id: string, file: File) {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<{ socialPost: SocialPost }>(`${postPath(id)}/media`, token, { method: 'POST', body: form });
}
