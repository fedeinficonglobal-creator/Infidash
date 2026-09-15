import { createHash } from 'node:crypto';

export const JOB_KINDS = ['generate_plan', 'generate_content', 'publish', 'reschedule', 'cancel', 'reconcile'] as const;
export const CALENDAR_STATUSES = ['draft', 'active', 'archived'] as const;
export const PLAN_STATUSES = ['proposed', 'approved', 'generating', 'review', 'ready', 'generation_failed', 'archived'] as const;
export const CONTENT_STATUSES = ['draft', 'review', 'approved', 'archived'] as const;
export const PUBLICATION_STATUSES = ['pending', 'sending', 'scheduled', 'published', 'failed', 'unknown', 'cancel_requested', 'cancelled', 'draft'] as const;

export type JobKind = typeof JOB_KINDS[number];

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
