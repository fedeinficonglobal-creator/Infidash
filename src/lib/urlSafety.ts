import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { UserFacingError } from './userFacingError.js';

/**
 * SSRF guard for URLs that an administrator can configure (integration probes, CTA links...).
 *
 * `assertPublicHttpUrl` is the syntactic check (no network). `assertResolvesToPublicAddress` adds the DNS
 * check against names that point at internal addresses. `safeFetch` combines both and re-validates every
 * redirect hop. Note: DNS is resolved once before the request, so a resolver that answers differently the
 * second time (rebinding) is not fully excluded; the checks reduce the attack surface, they are not a sandbox.
 */

const PUBLIC_URL_MESSAGE = 'La URL debe ser pública (http o https) y no puede apuntar a la red interna';
const TOO_MANY_REDIRECTS_MESSAGE = 'La URL redirige demasiadas veces';
const DOWNGRADE_MESSAGE = 'La URL redirige de https a http, lo que no está permitido';

/** Development-only escape hatch: INFIDASH_ALLOW_PRIVATE_URLS=1 disables the internal-host checks. */
export function privateUrlsAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.INFIDASH_ALLOW_PRIVATE_URLS === '1';
}

export interface UrlSafetyOptions {
  /** Overrides the INFIDASH_ALLOW_PRIVATE_URLS environment switch (mainly for tests). */
  allowPrivate?: boolean;
}

export type HostResolver = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function parseIPv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return null;
  return octets as [number, number, number, number];
}

export function isBlockedIPv4(octets: readonly number[]) {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

/** Expands an IPv6 literal (no brackets, no zone) into eight 16-bit groups, or null when it is not valid. */
function expandIPv6(value: string): number[] | null {
  let text = value;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (chunk: string) => (chunk === '' ? [] : chunk.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN));
  return numbers.some((n) => Number.isNaN(n)) ? null : numbers;
}

function isBlockedIPv6(groups: readonly number[]) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embedded = (hi: number, lo: number) => isBlockedIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  if (groups.every((group) => group === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return embedded(g6, g7); // IPv4-mapped ::ffff:a.b.c.d
    if (g5 === 0) return g6 === 0 && g7 === 1 ? true : embedded(g6, g7); // ::1 and IPv4-compatible ::a.b.c.d
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7); // NAT64
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  return (g0 >> 8) === 0xff; // ff00::/8 multicast
}

/** True when the IP literal (v4 or v6, optionally bracketed) is internal, reserved or malformed. */
export function isBlockedAddress(address: string) {
  const text = address.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = parseIPv4(text);
  if (v4) return isBlockedIPv4(v4);
  if (isIP(text) === 6) {
    const groups = expandIPv6(text.toLowerCase());
    return groups ? isBlockedIPv6(groups) : true;
  }
  return true;
}

function isBlockedHostname(rawHostname: string) {
  const host = rawHostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host.startsWith('[') || isIP(host) !== 0 || parseIPv4(host)) return isBlockedAddress(host);
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return !host.includes('.'); // bare single-label names such as "intranet"
}

/** Syntactic check: http(s) only, no userinfo, and the (canonicalized) host must not be internal. */
export function assertPublicHttpUrl(raw: string | URL, options: UrlSafetyOptions = {}): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(String(raw).trim());
  } catch {
    throw new UserFacingError(PUBLIC_URL_MESSAGE);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new UserFacingError(PUBLIC_URL_MESSAGE);
  }
  if (!(options.allowPrivate ?? privateUrlsAllowed()) && isBlockedHostname(url.hostname)) {
    throw new UserFacingError(PUBLIC_URL_MESSAGE);
  }
  return url;
}

async function defaultResolve(hostname: string) {
  return dns.lookup(hostname, { all: true });
}

/**
 * Rejects when the host is an internal IP or when ANY address it resolves to is internal (a public name
 * pointing at an internal address). A lookup that fails outright is not rejected here: the request itself
 * will fail to connect, and unresolvable test or typo hosts keep their existing error messages.
 */
export async function assertResolvesToPublicAddress(
  hostname: string,
  options: UrlSafetyOptions & { resolve?: HostResolver } = {},
) {
  if (options.allowPrivate ?? privateUrlsAllowed()) return;
  const host = hostname.replace(/\.$/, '');
  if (host.startsWith('[') || isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw new UserFacingError(PUBLIC_URL_MESSAGE);
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await (options.resolve ?? defaultResolve)(host);
  } catch {
    return;
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) throw new UserFacingError(PUBLIC_URL_MESSAGE);
}

export interface SafeFetchOptions extends UrlSafetyOptions {
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
  maxRedirects?: number;
}

/** fetch that validates the URL (syntax and DNS) and every redirect hop before following it. */
export async function safeFetch(url: string | URL, init: RequestInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  const guard = { allowPrivate: options.allowPrivate, resolve: options.resolve };
  let current = assertPublicHttpUrl(url, guard);
  await assertResolvesToPublicAddress(current.hostname, guard);
  let requestInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hops = 0; ; hops += 1) {
    const response = await fetchImpl(current.toString(), requestInit);
    const location = response.status >= 300 && response.status < 400 ? response.headers?.get('location') : null;
    if (!location) return response;
    try { void Promise.resolve(response.body?.cancel()).catch(() => undefined); } catch { /* best effort */ }
    if (hops >= maxRedirects) throw new UserFacingError(TOO_MANY_REDIRECTS_MESSAGE);

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new UserFacingError(PUBLIC_URL_MESSAGE);
    }
    assertPublicHttpUrl(next, guard);
    if (current.protocol === 'https:' && next.protocol === 'http:') throw new UserFacingError(DOWNGRADE_MESSAGE);
    await assertResolvesToPublicAddress(next.hostname, guard);

    const nextInit: RequestInit = { ...requestInit };
    if (next.origin !== current.origin && nextInit.headers) {
      const headers = new Headers(nextInit.headers);
      headers.delete('authorization');
      nextInit.headers = headers;
    }
    const method = String(nextInit.method ?? 'GET').toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      nextInit.method = 'GET';
      delete nextInit.body;
    }
    requestInit = nextInit;
    current = next;
  }
}
