import type { EditorialReadiness } from '../services/contentApi.js';
import type { RrssFormat, RrssNetwork, SocialMedia, SocialNetwork, SocialPost } from '../services/rrssApi.js';
import { canRunJob } from './content.js';

export const RRSS_NETWORKS: readonly RrssNetwork[] = ['gmb', 'facebook', 'instagram'];
export const RRSS_FORMATS: readonly RrssFormat[] = ['post', 'reel', 'carousel', 'story'];
export const RRSS_PAGE_SIZE = 20;
export const MAX_POST_MEDIA = 10;

export function networkLabel(network: string) {
  return ({ gmb: 'Google Business', facebook: 'Facebook', instagram: 'Instagram', other: 'Otra red' } as Record<string, string>)[network] ?? network;
}

export function formatLabel(format: string | null | undefined) {
  if (!format) return 'Sin formato';
  return ({ post: 'Post', reel: 'Reel', carousel: 'Carrusel', story: 'Historia' } as Record<string, string>)[format] ?? format;
}

/**
 * Frontend copy of the server's networkFromInstanceKey (src/server/content/contracts.ts): the social
 * network of a Postiz account comes from its instance_key only, never from `platform`.
 */
export function networkFromInstanceKey(instanceKey: unknown): SocialNetwork {
  const key = typeof instanceKey === 'string' ? instanceKey.toLowerCase() : '';
  if (key.includes('facebook')) return 'facebook';
  if (key.includes('instagram')) return 'instagram';
  if (key.includes('gmb') || key.includes('business') || key.includes('google')) return 'gmb';
  return 'other';
}

/** Accounts preselected in «Generar posts»: those whose network is one of the idea's networks. */
export function preselectAccountIds(accounts: ReadonlyArray<{ id: string; instanceKey: string }>, networks: ReadonlyArray<string>) {
  return accounts.filter((account) => networks.includes(networkFromInstanceKey(account.instanceKey))).map((account) => account.id);
}

/** Recommended copy length per network, shown as the counter's limit. */
export function copyLimit(network: string) {
  return ({ gmb: 1500, instagram: 2200, facebook: 63206 } as Record<string, number>)[network] ?? 20_000;
}

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm)$/i;
export function mediaKind(item: Pick<SocialMedia, 'url' | 'type'>): 'image' | 'video' {
  if (item.type === 'image' || item.type === 'video') return item.type;
  let path = item.url;
  try { path = new URL(item.url).pathname; } catch { /* keep the raw value */ }
  return VIDEO_EXTENSION.test(path) ? 'video' : 'image';
}

const MB = 1024 * 1024;
/** Same limits as the server (src/server/content/creativeUpload.ts). */
export const CREATIVE_LIMITS: Record<string, { kind: 'image' | 'video'; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', maxBytes: 10 * MB },
  'image/png': { kind: 'image', maxBytes: 10 * MB },
  'image/webp': { kind: 'image', maxBytes: 10 * MB },
  'video/mp4': { kind: 'video', maxBytes: 200 * MB },
  'video/quicktime': { kind: 'video', maxBytes: 200 * MB },
};
export const CREATIVE_ACCEPT = Object.keys(CREATIVE_LIMITS).join(',');

/** Spanish error for a creative the server would refuse, or null when it can be uploaded. */
export function validateCreativeFile(file: { type: string; size: number }) {
  const limit = CREATIVE_LIMITS[file.type];
  if (!limit) return 'Formato no admitido: usa JPG, PNG, WEBP, MP4 o MOV';
  if (file.size > limit.maxBytes) return limit.kind === 'image' ? 'La imagen supera el máximo de 10 MB' : 'El vídeo supera el máximo de 200 MB';
  return null;
}

/** «3 borradores · 1 programado» for an idea row. */
export function draftsSummary(posts: ReadonlyArray<{ status: string }>) {
  if (!posts.length) return 'Sin borradores';
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;
  const drafts = `${posts.length} ${posts.length === 1 ? 'borrador' : 'borradores'}`;
  return scheduled ? `${drafts} · ${scheduled} ${scheduled === 1 ? 'programado' : 'programados'}` : drafts;
}

/** A scheduled draft shows its publication's outcome (published, cancelled, failed) instead of «Programado». */
export function socialPostDisplayStatus(post: Pick<SocialPost, 'status' | 'publicationStatus'>) {
  if (post.status !== 'scheduled') return post.status;
  if (post.publicationStatus === 'published' || post.publicationStatus === 'cancelled' || post.publicationStatus === 'failed') return post.publicationStatus;
  return 'scheduled';
}

export function socialPostStatusLabel(status: string) {
  return ({ review: 'Revisión', approved: 'Aprobado', scheduled: 'Programado', published: 'Publicado', cancelled: 'Cancelado', discarded: 'Descartado', failed: 'Error al publicar' } as Record<string, string>)[status] ?? status;
}

/** Drafts are editable (copy and media) until they are scheduled or discarded. */
export function canEditPost(post: Pick<SocialPost, 'status'>) { return post.status === 'review' || post.status === 'approved'; }

/** Approved drafts can be scheduled; so can scheduled ones whose publication was cancelled or failed. */
export function canSchedulePost(post: Pick<SocialPost, 'status' | 'publicationStatus'>) {
  return post.status === 'approved' || (post.status === 'scheduled' && (post.publicationStatus === 'cancelled' || post.publicationStatus === 'failed'));
}

/** «Generar posts» needs a bound generate_rrss workflow and an idea that may move to generating. */
export function canGeneratePosts(item: { status: string }, readiness: EditorialReadiness | null | undefined) {
  return canRunJob(readiness, 'generate_rrss') && ['approved', 'review', 'ready', 'generation_failed'].includes(item.status);
}

export function moveMediaItem<T>(media: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= media.length || target < 0 || target >= media.length) return [...media];
  const next = [...media];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeMediaItem<T>(media: readonly T[], index: number): T[] {
  return media.filter((_, position) => position !== index);
}

/** Stable per request, so a retried click replays the same schedule instead of creating a second one. */
export function socialScheduleKey(post: Pick<SocialPost, 'id' | 'version'>, desiredScheduledAt: string, externalUrl?: string) {
  return `social-schedule:${post.id}:${post.version}:${desiredScheduledAt}:${externalUrl ?? ''}`;
}
