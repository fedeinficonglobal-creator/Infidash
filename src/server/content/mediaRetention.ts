// Pure decision logic for the Postiz media cleanup (no I/O). A file is EXPIRED only when every Infidash row that
// references it is finished and old enough. When in doubt the file is kept.

export type MediaReferenceSource = 'publication' | 'social_post' | 'content';

export interface LinkedState {
  status: string;
  at: Date | null;
}

export interface MediaReference {
  source: MediaReferenceSource;
  /** Media URL exactly as stored in the row. */
  url: string;
  /** Status of the referencing row (editorial.publications / social_posts / contents). */
  status: string;
  /** Last relevant timestamp of the row itself (see the repository for what each source supplies). */
  at: Date | null;
  /**
   * social_post: its linked publication (if any). content: all of its publications.
   * A row is only finished when every linked publication is finished too.
   */
  linked?: LinkedState[];
}

// editorial.publications.status enum: pending, sending, scheduled, published, failed, unknown, cancel_requested,
// cancelled, draft. Terminal ones: published, failed, cancelled.
export const PUBLICATION_TERMINAL_STATUSES: readonly string[] = ['published', 'failed', 'cancelled'];
// editorial.social_posts.status enum: review, approved, scheduled, discarded. Terminal: discarded, or scheduled once
// its linked publication is terminal.
// editorial.contents.status enum: draft, review, approved, archived. Terminal: archived, or approved once it has
// publications and all of them are terminal (approved is the normal end state of a published content).

export const ALLOWED_MEDIA_EXTENSIONS: readonly string[] = ['.mp4', '.mov', '.m4v', '.webm', '.jpg', '.jpeg', '.png', '.webp'];

export type UploadUrlMapping =
  | { ok: true; relativePath: string }
  | { ok: false; reason: 'foreign' | 'unsafe' | 'extension' };

interface ParsedLocation {
  host: string | null;
  path: string;
}

function parseLocation(value: string): ParsedLocation | null {
  const withoutSuffix = value.trim().split(/[?#]/)[0];
  const absolute = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(withoutSuffix);
  if (absolute) return { host: absolute[1].toLowerCase(), path: absolute[2] ?? '/' };
  if (withoutSuffix.startsWith('/') && !withoutSuffix.startsWith('//')) return { host: null, path: withoutSuffix };
  return null;
}

/**
 * Maps a stored media URL to a path relative to the uploads directory. The URL is parsed as text on purpose
 * (WHATWG URL would silently resolve "../"), then decoded and validated segment by segment.
 * A path-only prefix matches any host; a full-URL prefix must match the host as well.
 */
export function mapUploadUrlToRelativePath(url: string, urlPrefix: string): UploadUrlMapping {
  const prefix = parseLocation(urlPrefix);
  const target = parseLocation(url);
  if (!prefix || !target) return { ok: false, reason: 'foreign' };
  if (prefix.host && prefix.host !== target.host) return { ok: false, reason: 'foreign' };

  const prefixPath = prefix.path.replace(/\/+$/, '');
  if (!target.path.startsWith(`${prefixPath}/`)) return { ok: false, reason: 'foreign' };

  const rawRemainder = target.path.slice(prefixPath.length + 1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawRemainder);
  } catch {
    return { ok: false, reason: 'unsafe' };
  }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0') || decoded.startsWith('/') || /^[a-z]:/i.test(decoded)) {
    return { ok: false, reason: 'unsafe' };
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes(':'))) {
    return { ok: false, reason: 'unsafe' };
  }
  const last = segments[segments.length - 1].toLowerCase();
  if (!ALLOWED_MEDIA_EXTENSIONS.some((extension) => last.endsWith(extension) && last.length > extension.length)) {
    return { ok: false, reason: 'extension' };
  }
  return { ok: true, relativePath: segments.join('/') };
}

const isPublicationTerminal = (status: string) => PUBLICATION_TERMINAL_STATUSES.includes(status);

function latest(dates: Array<Date | null>): Date | null {
  let result: Date | null = null;
  for (const date of dates) {
    if (!date || Number.isNaN(date.getTime())) return null;
    if (!result || date > result) result = date;
  }
  return result;
}

/** Whether the referencing row is finished, plus the last relevant timestamp (null when any timestamp is unusable). */
export function classifyReference(reference: MediaReference): { terminal: boolean; at: Date | null } {
  const linked = reference.linked ?? [];
  const linkedFinished = linked.every((entry) => isPublicationTerminal(entry.status));
  let ownFinished: boolean;
  switch (reference.source) {
    case 'publication':
      ownFinished = isPublicationTerminal(reference.status);
      break;
    case 'social_post':
      ownFinished = reference.status === 'discarded' || (reference.status === 'scheduled' && linked.length > 0);
      break;
    case 'content':
      ownFinished = reference.status === 'archived' || (reference.status === 'approved' && linked.length > 0);
      break;
    default:
      ownFinished = false;
  }
  return {
    terminal: ownFinished && linkedFinished,
    at: latest([reference.at, ...linked.map((entry) => entry.at)]),
  };
}

export interface ExpiredMedia {
  relativePath: string;
  /** First URL seen for the file, as stored. */
  url: string;
  referenceCount: number;
  lastActivityAt: Date;
}

export interface KeptMedia {
  relativePath: string;
  reason: 'non_terminal' | 'too_recent' | 'unknown_timestamp';
  referenceCount: number;
}

export interface MediaExpiryResult {
  expired: ExpiredMedia[];
  kept: KeptMedia[];
  /** References that are not under the uploads prefix. */
  ignored: number;
  /** References under the prefix that cannot be mapped safely (traversal, unsupported extension). */
  skipped: Array<{ url: string; reason: 'unsafe' | 'extension' }>;
}

export function evaluateMediaExpiry(input: {
  references: MediaReference[];
  urlPrefix: string;
  retentionDays: number;
  now: Date;
}): MediaExpiryResult {
  const cutoff = input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;
  const groups = new Map<string, MediaReference[]>();
  const result: MediaExpiryResult = { expired: [], kept: [], ignored: 0, skipped: [] };

  for (const reference of input.references) {
    const mapping = mapUploadUrlToRelativePath(reference.url, input.urlPrefix);
    if (mapping.ok === false) {
      if (mapping.reason === 'foreign') result.ignored += 1;
      else result.skipped.push({ url: reference.url, reason: mapping.reason });
      continue;
    }
    const group = groups.get(mapping.relativePath);
    if (group) group.push(reference);
    else groups.set(mapping.relativePath, [reference]);
  }

  for (const [relativePath, references] of groups) {
    const classified = references.map(classifyReference);
    const base = { relativePath, referenceCount: references.length };
    if (classified.some((entry) => !entry.terminal)) {
      result.kept.push({ ...base, reason: 'non_terminal' });
      continue;
    }
    if (classified.some((entry) => !entry.at)) {
      result.kept.push({ ...base, reason: 'unknown_timestamp' });
      continue;
    }
    const lastActivityAt = classified.reduce((max, entry) => (entry.at! > max ? entry.at! : max), classified[0].at!);
    if (lastActivityAt.getTime() > cutoff) {
      result.kept.push({ ...base, reason: 'too_recent' });
      continue;
    }
    result.expired.push({ ...base, url: references[0].url, lastActivityAt });
  }

  result.expired.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  result.kept.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return result;
}
