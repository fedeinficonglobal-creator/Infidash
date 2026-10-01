import { openAsBlob } from 'node:fs';
import { ContentApiError } from './contracts.js';

/** Agency-wide Postiz public API access; the key only ever lives in server env. */
export interface PostizConfig { apiUrl: string; apiKey: string; publicUrl: string; }
/** Either an in-memory buffer or a file on disk (streamed to Postiz without loading it into memory). */
export type PostizUploadFile = { filename: string; mimetype: string } & ({ buffer: Buffer } | { path: string });
export type PostizUploader = (file: PostizUploadFile) => Promise<{ url: string }>;
type FetchImpl = typeof fetch;

/** Large videos can take a while to reach Postiz; this only bounds a hung connection. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/**
 * POSTIZ_API_URL (base of the public API, e.g. https://postiz.example/api), POSTIZ_API_KEY and an
 * optional POSTIZ_PUBLIC_URL used to absolutize relative upload paths (default: the API origin).
 * Returns null when Postiz is not configured.
 */
export function postizConfigFromEnv(env: Record<string, string | undefined> = process.env): PostizConfig | null {
  const apiUrl = httpUrl(env.POSTIZ_API_URL?.trim() ?? '');
  const apiKey = env.POSTIZ_API_KEY?.trim();
  if (!apiUrl || !apiKey) return null;
  const publicUrl = env.POSTIZ_PUBLIC_URL?.trim() ? httpUrl(env.POSTIZ_PUBLIC_URL.trim()) : null;
  return { apiUrl: withoutTrailingSlash(apiUrl.toString()), apiKey, publicUrl: withoutTrailingSlash((publicUrl ?? new URL(apiUrl.origin)).toString()) };
}

function uploadFailed(detail: string) {
  return new ContentApiError(502, 'POSTIZ_UPLOAD_FAILED', `No se pudo subir el archivo a Postiz: ${detail}`);
}

/**
 * Forwards one file to `${apiUrl}/public/v1/upload` and returns the absolute public URL of the
 * stored file (Postiz answers with `path`, or `url`). Every failure is a 502 whose message never
 * includes the API key or the raw Postiz response.
 */
export function createPostizUploader(config: PostizConfig, fetchImpl: FetchImpl = fetch): PostizUploader {
  return async (file) => {
    const form = new FormData();
    let blob: Blob;
    try {
      // A path-backed Blob is read lazily from disk while fetch sends it, never loaded into memory.
      blob = 'path' in file ? await openAsBlob(file.path, { type: file.mimetype }) : new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    } catch {
      throw uploadFailed('no se pudo leer el archivo temporal');
    }
    form.append('file', blob, file.filename);
    let response: Response;
    try {
      response = await fetchImpl(`${config.apiUrl}/public/v1/upload`, { method: 'POST', headers: { Authorization: config.apiKey }, body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    } catch {
      throw uploadFailed('no se pudo conectar con el servidor');
    }
    if (!response.ok) throw uploadFailed(`el servidor respondió ${response.status}`);
    const payload = await response.json().catch(() => null) as { path?: unknown; url?: unknown } | null;
    const raw = typeof payload?.path === 'string' && payload.path.trim() ? payload.path.trim() : typeof payload?.url === 'string' && payload.url.trim() ? payload.url.trim() : null;
    if (!raw) throw uploadFailed('la respuesta no incluye la ruta del archivo');
    let absolute: URL | null;
    try { absolute = httpUrl(new URL(raw, `${config.publicUrl}/`).toString()); } catch { absolute = null; }
    if (!absolute) throw uploadFailed('la ruta devuelta no es una URL HTTP o HTTPS');
    return { url: absolute.toString() };
  };
}
