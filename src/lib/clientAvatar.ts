/**
 * Background colours for initials avatars. Every entry keeps white text at a WCAG contrast of at least 4.5:1
 * (guarded by tests/frontend-hygiene.test.ts). Hex values so the contrast can be verified.
 */
export const CLIENT_AVATAR_PALETTE: readonly string[] = Object.freeze([
  '#0369a1', // sky-700
  '#4f46e5', // indigo-600
  '#047857', // emerald-700
  '#b45309', // amber-700
  '#be123c', // rose-700
  '#7c3aed', // violet-600
  '#0f766e', // teal-700
  '#334155', // slate-700
]);

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizeForSearch(value: string) {
  return stripAccents(value).toLocaleLowerCase('es').trim();
}

/** Up to two uppercase letters: first letter of the first two words, or the first two letters of a single word. */
export function clientInitials(name: string) {
  const words = stripAccents(name)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const initials = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return initials.toLocaleUpperCase('es');
}

/** Deterministic palette background (hex) for a client slug or name. */
export function clientColor(slug: string) {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return CLIENT_AVATAR_PALETTE[hash % CLIENT_AVATAR_PALETTE.length];
}

/**
 * Returns the logo URL, or null when the client has none. Old rows may still store a generated
 * ui-avatars.com placeholder; those count as "no logo" so that host is never requested.
 */
export function clientLogoUrl(logo: string | null | undefined) {
  const url = logo?.trim();
  if (!url || /^https?:\/\/ui-avatars\.com\//i.test(url)) return null;
  return url;
}

const clientNameCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Alphabetical (Spanish) order by name, ignoring case and accents; returns a new array. */
export function sortClients<T extends { name: string }>(clients: T[]): T[] {
  return [...clients].sort((a, b) => clientNameCollator.compare(a.name.trim(), b.name.trim()));
}

/** Case- and accent-insensitive name filter; an empty query returns every client. */
export function filterClients<T extends { name: string }>(clients: T[], query: string): T[] {
  const needle = normalizeForSearch(query);
  if (!needle) return clients;
  return clients.filter((client) => normalizeForSearch(client.name).includes(needle));
}
