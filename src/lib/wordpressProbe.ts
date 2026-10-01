import { safeFetch, type UrlSafetyOptions } from './urlSafety.js';
import { UserFacingError } from './userFacingError.js';

export async function testWordPressConnection(integration: any, credentials: Record<string, unknown>, fetchImpl: typeof fetch = globalThis.fetch, urlOptions: UrlSafetyOptions = {}) {
  const siteUrl = String(integration.config?.siteUrl ?? '').trim().replace(/\/+$/, '');
  if (!siteUrl) {
    return { ok: false, error: 'Falta la URL del sitio' };
  }

  const restNamespace = String(integration.config?.restNamespace ?? '/wp-json/wp/v2').trim() || '/wp-json/wp/v2';
  const url = `${siteUrl}${restNamespace.startsWith('/') ? '' : '/'}${restNamespace}`;
  const username = typeof credentials.username === 'string' ? credentials.username.trim() : '';
  const applicationPassword = typeof credentials.applicationPassword === 'string' ? credentials.applicationPassword.trim() : '';

  const headers = new Headers({ accept: 'application/json' });
  if (username && applicationPassword) {
    headers.set('authorization', `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString('base64')}`);
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new DOMException('WordPress connection timeout', 'AbortError')), 8000);
  try {
    const response = await safeFetch(url, { method: 'GET', headers, signal: controller.signal }, { fetchImpl, ...urlOptions });
    if (!response.ok) {
      return { ok: false, error: `WordPress respondió ${response.status} ${response.statusText}` };
    }
    return { ok: true, error: null };
  } catch (error) {
    if (error instanceof UserFacingError) {
      return { ok: false, error: error.message };
    }
    console.error('[infidash] wordpress probe failed', error);
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return { ok: false, error: timedOut ? 'WordPress no respondió a tiempo' : 'No se pudo conectar con WordPress' };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
