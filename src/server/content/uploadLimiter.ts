import { ContentApiError } from './contracts.js';

export const DEFAULT_MAX_CONCURRENT_UPLOADS = 3;
const MIN_CONCURRENT_UPLOADS = 1;
const MAX_CONCURRENT_UPLOADS = 10;

/** Parses INFIDASH_MAX_CONCURRENT_UPLOADS: an integer clamped to 1..10, the default when absent or invalid. */
export function maxConcurrentUploadsFromEnv(env: Record<string, string | undefined> = process.env) {
  const raw = env.INFIDASH_MAX_CONCURRENT_UPLOADS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_CONCURRENT_UPLOADS;
  return Math.min(MAX_CONCURRENT_UPLOADS, Math.max(MIN_CONCURRENT_UPLOADS, Number(raw)));
}

export interface UploadLimiter {
  /** Takes a slot or throws 503 UPLOAD_BUSY at once (no queueing). The returned release is idempotent. */
  acquire(): () => void;
  readonly active: number;
}

export function createUploadLimiter(max: number = DEFAULT_MAX_CONCURRENT_UPLOADS): UploadLimiter {
  let active = 0;
  return {
    acquire() {
      if (active >= max) throw new ContentApiError(503, 'UPLOAD_BUSY', 'Hay demasiadas subidas en curso, inténtalo de nuevo en unos segundos');
      active += 1;
      let released = false;
      return () => { if (!released) { released = true; active -= 1; } };
    },
    get active() { return active; },
  };
}
