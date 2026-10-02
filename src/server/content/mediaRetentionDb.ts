// Database access for the Postiz media cleanup. Read-only on posts: the only write is the audit log.
// Uses the editorial pg pool (never the core psql path).
import type { Pool } from 'pg';
import type { LinkedState, MediaReference } from './mediaRetention.js';
import type { DeletedMediaEntry } from './mediaCleanup.js';

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/** Latest of the given dates; null when none is usable. */
function latestDate(values: unknown[]): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    const date = toDate(value);
    if (date && (!result || date > result)) result = date;
  }
  return result;
}

export function mediaUrls(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  const urls: string[] = [];
  for (const item of media) {
    const candidate = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { url?: unknown }).url : null;
    if (typeof candidate === 'string' && candidate.trim()) urls.push(candidate.trim());
  }
  return urls;
}

interface PublicationRow {
  id: string;
  content_id: string;
  status: string;
  media: unknown;
  published_at: unknown;
  confirmed_scheduled_at: unknown;
  desired_scheduled_at: unknown;
  updated_at: unknown;
}

/**
 * Collects every media URL referenced by editorial.publications.media, editorial.social_posts.media and the content
 * header image (editorial.contents.seo.headerImageUrl). The timestamp of a publication is the LATEST of published_at,
 * confirmed/desired scheduled time and updated_at; of a social post or content, its updated_at.
 */
export async function loadMediaReferences(pool: Pick<Pool, 'query'>): Promise<MediaReference[]> {
  const publications = (await pool.query<PublicationRow>(
    `SELECT id, content_id, status, media, published_at, confirmed_scheduled_at, desired_scheduled_at, updated_at
       FROM editorial.publications`,
  )).rows;
  const socialPosts = (await pool.query(
    `SELECT id, status, media, updated_at, publication_id FROM editorial.social_posts`,
  )).rows;
  const contents = (await pool.query(
    `SELECT id, status, seo ->> 'headerImageUrl' AS header_image_url, updated_at FROM editorial.contents`,
  )).rows;

  const stateOf = (row: PublicationRow): LinkedState => ({
    status: row.status,
    at: latestDate([row.published_at, row.confirmed_scheduled_at, row.desired_scheduled_at, row.updated_at]),
  });
  const publicationsById = new Map(publications.map((row) => [row.id, stateOf(row)]));
  const publicationsByContent = new Map<string, LinkedState[]>();
  for (const row of publications) {
    const list = publicationsByContent.get(row.content_id) ?? [];
    list.push(stateOf(row));
    publicationsByContent.set(row.content_id, list);
  }

  const references: MediaReference[] = [];
  for (const row of publications) {
    const state = stateOf(row);
    for (const url of mediaUrls(row.media)) references.push({ source: 'publication', url, status: state.status, at: state.at });
  }
  for (const row of socialPosts) {
    const linked = row.publication_id && publicationsById.has(row.publication_id) ? [publicationsById.get(row.publication_id)!] : [];
    for (const url of mediaUrls(row.media)) {
      references.push({ source: 'social_post', url, status: row.status, at: toDate(row.updated_at), linked });
    }
  }
  for (const row of contents) {
    const header = typeof row.header_image_url === 'string' ? row.header_image_url.trim() : '';
    if (!header) continue;
    references.push({
      source: 'content',
      url: header,
      status: row.status,
      at: toDate(row.updated_at),
      linked: publicationsByContent.get(row.id) ?? [],
    });
  }
  return references;
}

export async function recordMediaCleanup(pool: Pick<Pool, 'query'>, entry: DeletedMediaEntry): Promise<void> {
  await pool.query(
    `INSERT INTO editorial.media_cleanup_log (url, file_name, bytes, reason) VALUES ($1, $2, $3, $4)`,
    [entry.url, entry.fileName, entry.bytes, entry.reason],
  );
}
