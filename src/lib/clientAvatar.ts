/** Tailwind class pairs for client avatars without a logo. Literal strings so Tailwind keeps them. */
export const CLIENT_AVATAR_PALETTE: readonly string[] = Object.freeze([
  'bg-sky-600 text-white',
  'bg-indigo-600 text-white',
  'bg-emerald-600 text-white',
  'bg-amber-500 text-slate-900',
  'bg-rose-600 text-white',
  'bg-violet-600 text-white',
  'bg-teal-600 text-white',
  'bg-slate-700 text-white',
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

/** Deterministic palette entry for a client slug. */
export function clientColor(slug: string) {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return CLIENT_AVATAR_PALETTE[hash % CLIENT_AVATAR_PALETTE.length];
}

/** Returns the logo URL, or null when the client has none (empty or the generated ui-avatars placeholder). */
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
