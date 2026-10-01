import { createHash } from 'node:crypto';

export const JOB_KINDS = ['generate_plan', 'generate_content', 'publish', 'reschedule', 'cancel', 'reconcile', 'generate_rrss_plan', 'generate_rrss'] as const;
export const CALENDAR_STATUSES = ['draft', 'active', 'archived'] as const;
export const PLAN_STATUSES = ['proposed', 'approved', 'generating', 'review', 'ready', 'generation_failed', 'archived'] as const;
export const CONTENT_STATUSES = ['draft', 'review', 'approved', 'archived'] as const;
export const PUBLICATION_STATUSES = ['pending', 'sending', 'scheduled', 'published', 'failed', 'unknown', 'cancel_requested', 'cancelled', 'draft'] as const;

export const CALENDAR_KINDS = ['blog', 'rrss'] as const;
/** Networks a social idea can target (and the RRSS plan inputs can list). */
export const RRSS_NETWORKS = ['gmb', 'facebook', 'instagram'] as const;
/** Networks a social post draft can be stored with: an account whose instance_key names no known network is `other`. */
export const SOCIAL_NETWORKS = ['gmb', 'facebook', 'instagram', 'other'] as const;
export const RRSS_FORMATS = ['post', 'reel', 'carousel', 'story'] as const;
export const SOCIAL_POST_STATUSES = ['review', 'approved', 'scheduled', 'discarded'] as const;
export const MAX_SOCIAL_COPY_LENGTH = 20_000;

export type JobKind = typeof JOB_KINDS[number];
export type CalendarKind = typeof CALENDAR_KINDS[number];
export type SocialNetwork = typeof SOCIAL_NETWORKS[number];

export class ContentApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function requireObject(value: unknown, label = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentApiError(400, 'INVALID_PAYLOAD', `${label} debe ser un objeto`);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} es obligatorio`);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} excede ${max} caracteres`);
  return normalized;
}

export function optionalString(value: unknown, field: string, max = 20_000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} debe ser texto o null`);
  if (value.length > max) throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} excede ${max} caracteres`);
  return value;
}

export function requirePositiveVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ContentApiError(400, 'VERSION_REQUIRED', 'version debe ser un entero positivo');
  }
  return Number(value);
}

export function parseLimit(value: unknown, fallback = 50, maximum = 200): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ContentApiError(400, 'INVALID_LIMIT', 'limit debe ser un entero positivo');
  return Math.min(parsed, maximum);
}

export function encodeCursor(value: { at: string; id: string }) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): { at: string; id: string } | null {
  if (value === undefined || value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (typeof parsed?.at !== 'string' || typeof parsed?.id !== 'string') throw new Error('invalid');
    return parsed;
  } catch {
    throw new ContentApiError(400, 'INVALID_CURSOR', 'cursor no es válido');
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function requestHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

const SECRET_KEY = /(token|secret|password|authorization|credential|webhook.?url)/i;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(item)]));
}

export function sanitizeError(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.slice(0, 4_000)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]');
}

export function assertEnum<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} no es válido`);
  }
  return value as T[number];
}

/**
 * Social network of a Postiz publishing account, from its instance_key only (never `platform`,
 * which holds the content vertical, e.g. 'blog'). Same precedence as publish.v1.json's
 * "Preparar publicacion": facebook, then instagram, then the GMB markers.
 */
export function networkFromInstanceKey(instanceKey: unknown): SocialNetwork {
  const key = typeof instanceKey === 'string' ? instanceKey.toLowerCase() : '';
  if (key.includes('facebook')) return 'facebook';
  if (key.includes('instagram')) return 'instagram';
  if (key.includes('gmb') || key.includes('business') || key.includes('google')) return 'gmb';
  return 'other';
}

/** A de-duplicated list of RRSS target networks; `code` lets workflow results report INVALID_RESULT. */
export function normalizeRrssNetworks(value: unknown, field = 'networks', code = 'INVALID_PAYLOAD'): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !(RRSS_NETWORKS as readonly string[]).includes(item))) {
    throw new ContentApiError(400, code, `${field} debe ser una lista con: ${RRSS_NETWORKS.join(', ')}`);
  }
  return [...new Set(value as string[])];
}

export const SOCIAL_MEDIA_TYPES = ['image', 'video'] as const;
export const MAX_SOCIAL_MEDIA_ITEMS = 10;
export const MAX_SOCIAL_MEDIA_NAME_LENGTH = 200;
export type SocialMediaItem = { url: string; type?: typeof SOCIAL_MEDIA_TYPES[number]; name?: string };

/**
 * Social post media: a list of `{url, type?, name?}` with an HTTP(S) URL, an optional `image`|`video`
 * type and an optional display name; any other key is dropped.
 */
export function normalizeSocialMedia(value: unknown, field = 'media', code = 'INVALID_PAYLOAD'): SocialMediaItem[] {
  if (!Array.isArray(value)) throw new ContentApiError(400, code, `${field} debe ser una lista`);
  if (value.length > MAX_SOCIAL_MEDIA_ITEMS) throw new ContentApiError(400, code, `${field} admite como máximo ${MAX_SOCIAL_MEDIA_ITEMS} elementos`);
  return value.map((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const url = record.url;
    if (typeof url !== 'string' || url.length > 2048) throw new ContentApiError(400, code, `${field} requiere una url por elemento`);
    let normalized: SocialMediaItem;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported protocol');
      normalized = { url: parsed.toString() };
    } catch {
      throw new ContentApiError(400, code, `${field} debe contener URLs HTTP o HTTPS válidas`);
    }
    if (record.type !== undefined && record.type !== null) {
      if (typeof record.type !== 'string' || !(SOCIAL_MEDIA_TYPES as readonly string[]).includes(record.type)) throw new ContentApiError(400, code, `${field}: type debe ser image o video`);
      normalized.type = record.type as SocialMediaItem['type'];
    }
    if (record.name !== undefined && record.name !== null) {
      if (typeof record.name !== 'string' || record.name.length > MAX_SOCIAL_MEDIA_NAME_LENGTH) throw new ContentApiError(400, code, `${field}: name debe ser texto de como máximo ${MAX_SOCIAL_MEDIA_NAME_LENGTH} caracteres`);
      normalized.name = record.name;
    }
    return normalized;
  });
}

/** Non-empty social copy of at most MAX_SOCIAL_COPY_LENGTH characters (kept verbatim, not trimmed). */
export function requireSocialCopy(value: unknown, field = 'copy', code = 'INVALID_PAYLOAD'): string {
  if (typeof value !== 'string' || !value.trim()) throw new ContentApiError(400, code, `${field} es obligatorio`);
  if (value.length > MAX_SOCIAL_COPY_LENGTH) throw new ContentApiError(400, code, `${field} excede ${MAX_SOCIAL_COPY_LENGTH} caracteres`);
  return value;
}
