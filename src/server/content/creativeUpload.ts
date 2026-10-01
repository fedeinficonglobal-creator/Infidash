import type { Readable } from 'node:stream';
import { ContentApiError, MAX_SOCIAL_MEDIA_NAME_LENGTH } from './contracts.js';

const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * MB;
export const MAX_VIDEO_BYTES = 200 * MB;
/** Multipart file-size ceiling: the largest per-type limit. */
export const MAX_CREATIVE_BYTES = MAX_VIDEO_BYTES;

/** Accepted creative types and their per-type size limit. */
export const CREATIVE_TYPES: Record<string, { kind: 'image' | 'video'; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', maxBytes: MAX_IMAGE_BYTES },
  'image/png': { kind: 'image', maxBytes: MAX_IMAGE_BYTES },
  'image/webp': { kind: 'image', maxBytes: MAX_IMAGE_BYTES },
  'video/mp4': { kind: 'video', maxBytes: MAX_VIDEO_BYTES },
  'video/quicktime': { kind: 'video', maxBytes: MAX_VIDEO_BYTES },
};

export function creativeKind(mimetype: string) { return CREATIVE_TYPES[mimetype]?.kind ?? 'image'; }

const ascii = (buffer: Buffer, start: number, end: number) => buffer.subarray(start, end).toString('latin1');
// ISO base media (MP4/MOV) files start with a size + box type; QuickTime may also open with these atoms.
const QUICKTIME_ATOMS = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/** Whether the file's leading bytes match its declared type, so a renamed file cannot pass as a creative. */
export function matchesSignature(mimetype: string, buffer: Buffer) {
  switch (mimetype) {
    case 'image/jpeg': return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png': return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP';
    case 'video/mp4': return buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp';
    case 'video/quicktime': return buffer.length >= 8 && QUICKTIME_ATOMS.has(ascii(buffer, 4, 8));
    default: return false;
  }
}

/** A display name for the stored creative: the base file name, trimmed to the media name limit. */
export function creativeName(filename: string | undefined) {
  const base = (filename ?? '').split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim() ?? '';
  return (base || 'creatividad').slice(0, MAX_SOCIAL_MEDIA_NAME_LENGTH);
}

const invalidType = () => new ContentApiError(400, 'INVALID_MEDIA_TYPE', 'Formato no admitido: sube imágenes JPG, PNG o WEBP (máx. 10 MB) o vídeos MP4 o MOV (máx. 200 MB)');
const tooLarge = (kind: 'image' | 'video') => new ContentApiError(413, 'MEDIA_TOO_LARGE', kind === 'image' ? 'La imagen supera el máximo de 10 MB' : 'El vídeo supera el máximo de 200 MB');

/**
 * Reads one multipart file into memory, enforcing the declared type, its per-type size limit and
 * the file signature. The stream is drained (never left hanging) when the file is refused early.
 */
export async function readCreative(part: { file: Readable & { truncated?: boolean }; mimetype: string; filename?: string }) {
  const mimetype = (part.mimetype ?? '').toLowerCase().split(';')[0].trim();
  const accepted = CREATIVE_TYPES[mimetype];
  if (!accepted) { part.file.resume(); throw invalidType(); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of part.file) {
    size += (chunk as Buffer).length;
    if (size > accepted.maxBytes) { part.file.resume(); throw tooLarge(accepted.kind); }
    chunks.push(chunk as Buffer);
  }
  if (part.file.truncated) throw tooLarge(accepted.kind);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length || !matchesSignature(mimetype, buffer)) throw invalidType();
  return { buffer, mimetype, kind: accepted.kind, name: creativeName(part.filename) };
}
