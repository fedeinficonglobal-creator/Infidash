// Filesystem side of the Postiz media cleanup: configuration parsing, safe URL -> file resolution, deletion and the
// disk usage check. The decision of WHAT is expired lives in mediaRetention.ts; database reads are injected.
import { lstat, realpath, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { evaluateMediaExpiry, type MediaReference } from './mediaRetention.js';

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_WARN_PERCENT = 80;

export interface CleanupConfig {
  apply: boolean;
  retentionDays: number;
  uploadDir: string;
  /** Empty in disk-check mode when not configured. */
  urlPrefix: string;
  checkDisk: boolean;
  warnPercent: number;
  minFreeGb: number | null;
}

function readFlag(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseBoundedInteger(raw: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${label} debe ser un entero entre ${min} y ${max}.`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${label} debe ser un entero entre ${min} y ${max}.`);
  return value;
}

export function parseCleanupConfig(argv: string[], env: NodeJS.ProcessEnv): CleanupConfig {
  const minFreeRaw = readFlag(argv, 'min-free-gb');
  const checkDisk = argv.includes('--check-disk') || minFreeRaw !== null;

  const daysFlag = readFlag(argv, 'days');
  const retentionDays = daysFlag !== null
    ? parseBoundedInteger(daysFlag, '--days', 1, 365)
    : env.POSTIZ_MEDIA_RETENTION_DAYS?.trim()
      ? parseBoundedInteger(env.POSTIZ_MEDIA_RETENTION_DAYS, 'POSTIZ_MEDIA_RETENTION_DAYS', 1, 365)
      : DEFAULT_RETENTION_DAYS;

  const warnRaw = readFlag(argv, 'warn-percent');
  const warnPercent = warnRaw !== null ? parseBoundedInteger(warnRaw, '--warn-percent', 1, 100) : DEFAULT_WARN_PERCENT;
  let minFreeGb: number | null = null;
  if (minFreeRaw !== null) {
    const parsed = Number(minFreeRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--min-free-gb debe ser un número mayor que 0.');
    minFreeGb = parsed;
  }

  const uploadDir = env.POSTIZ_UPLOAD_DIR?.trim() ?? '';
  if (!uploadDir) throw new Error('POSTIZ_UPLOAD_DIR es obligatorio (directorio de uploads de Postiz).');
  const urlPrefix = env.POSTIZ_UPLOAD_URL_PREFIX?.trim() ?? '';
  if (!checkDisk && !urlPrefix) {
    throw new Error('POSTIZ_UPLOAD_URL_PREFIX es obligatorio (prefijo de URL que corresponde a POSTIZ_UPLOAD_DIR).');
  }

  return { apply: argv.includes('--apply'), retentionDays, uploadDir, urlPrefix, checkDisk, warnPercent, minFreeGb };
}

// --- Path resolution ----------------------------------------------------------------------------------------

export type ResolvedUploadFile =
  | { status: 'file'; path: string; bytes: number }
  | { status: 'missing' | 'not_file' | 'unsafe' };

function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves an already validated relative path inside the uploads directory. Anything that is not a plain regular
 * file that really lives inside the real uploads directory (symlinks, symlinked parents, directories) is refused.
 */
export async function resolveUploadFile(uploadDir: string, relativePath: string): Promise<ResolvedUploadFile> {
  const segments = relativePath.split('/');
  if (!relativePath || path.isAbsolute(relativePath) || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return { status: 'unsafe' };
  }
  const root = await realpath(uploadDir);
  const target = path.join(root, ...segments);
  if (!isInside(root, target)) return { status: 'unsafe' };

  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return { status: 'missing' };
    throw error;
  }
  if (stats.isSymbolicLink()) return { status: 'unsafe' };
  if (!stats.isFile()) return { status: 'not_file' };
  if (!isInside(root, await realpath(target))) return { status: 'unsafe' };
  return { status: 'file', path: target, bytes: stats.size };
}

// --- Cleanup run --------------------------------------------------------------------------------------------

export interface DeletedMediaEntry {
  url: string;
  relativePath: string;
  fileName: string;
  bytes: number;
  reason: string;
}

export interface MediaCleanupReport {
  apply: boolean;
  retentionDays: number;
  referencesRead: number;
  /** Files judged expired (before checking they exist on disk). */
  candidates: number;
  /** Files deleted (apply) or that would be deleted (dry-run). */
  deleted: DeletedMediaEntry[];
  /** Expired files that were already gone. */
  missing: Array<{ relativePath: string }>;
  kept: Array<{ relativePath: string; reason: string }>;
  ignored: number;
  skipped: Array<{ url: string; reason: string }>;
  errors: Array<{ relativePath: string; error: string }>;
  bytesFreed: number;
}

export interface MediaCleanupOptions {
  uploadDir: string;
  urlPrefix: string;
  retentionDays: number;
  apply: boolean;
  now?: Date;
  loadReferences: () => Promise<MediaReference[]>;
  /** Audit hook, called once per file after it was deleted (apply only). */
  recordDeletion?: (entry: DeletedMediaEntry) => Promise<void>;
  unlinkFile?: (file: string) => Promise<void>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runMediaCleanup(options: MediaCleanupOptions): Promise<MediaCleanupReport> {
  const references = await options.loadReferences();
  const evaluation = evaluateMediaExpiry({
    references,
    urlPrefix: options.urlPrefix,
    retentionDays: options.retentionDays,
    now: options.now ?? new Date(),
  });
  const report: MediaCleanupReport = {
    apply: options.apply,
    retentionDays: options.retentionDays,
    referencesRead: references.length,
    candidates: evaluation.expired.length,
    deleted: [],
    missing: [],
    kept: evaluation.kept.map((entry) => ({ relativePath: entry.relativePath, reason: entry.reason })),
    ignored: evaluation.ignored,
    skipped: [...evaluation.skipped],
    errors: [],
    bytesFreed: 0,
  };
  const removeFile = options.unlinkFile ?? unlink;

  for (const media of evaluation.expired) {
    try {
      const resolved = await resolveUploadFile(options.uploadDir, media.relativePath);
      if (resolved.status === 'missing') {
        report.missing.push({ relativePath: media.relativePath });
        continue;
      }
      if (resolved.status !== 'file') {
        report.skipped.push({ url: media.url, reason: resolved.status });
        continue;
      }
      const entry: DeletedMediaEntry = {
        url: media.url,
        relativePath: media.relativePath,
        fileName: path.posix.basename(media.relativePath),
        bytes: resolved.bytes,
        reason: `expired: all ${media.referenceCount} reference(s) terminal, last activity ${media.lastActivityAt.toISOString()}, retention ${options.retentionDays}d`,
      };
      if (options.apply) {
        await removeFile(resolved.path);
        report.deleted.push(entry);
        report.bytesFreed += entry.bytes;
        try {
          await options.recordDeletion?.(entry);
        } catch (error) {
          report.errors.push({ relativePath: media.relativePath, error: `borrado correcto pero sin registro de auditoría: ${message(error)}` });
        }
      } else {
        report.deleted.push(entry);
        report.bytesFreed += entry.bytes;
      }
    } catch (error) {
      report.errors.push({ relativePath: media.relativePath, error: message(error) });
    }
  }
  return report;
}

// --- Disk usage ---------------------------------------------------------------------------------------------

export interface StatfsLike {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

export interface DiskCheckResult {
  dir: string;
  totalBytes: number;
  freeBytes: number;
  freeGb: number;
  usedPercent: number;
  ok: boolean;
  messages: string[];
}

export async function checkDiskUsage(options: {
  dir: string;
  warnPercent: number;
  minFreeGb?: number | null;
  statfs?: (dir: string) => Promise<StatfsLike>;
}): Promise<DiskCheckResult> {
  const stats = await (options.statfs ?? statfs)(options.dir);
  const used = stats.blocks - stats.bfree;
  // Same definition as df: used / (used + available to unprivileged users).
  const usedPercent = used + stats.bavail > 0 ? (used * 100) / (used + stats.bavail) : 0;
  const freeBytes = stats.bavail * stats.bsize;
  const freeGb = freeBytes / 1024 ** 3;
  const messages: string[] = [];
  if (usedPercent >= options.warnPercent) {
    messages.push(`El disco está al ${usedPercent.toFixed(1)}% (umbral ${options.warnPercent}%).`);
  }
  if (options.minFreeGb != null && freeGb < options.minFreeGb) {
    messages.push(`Quedan ${freeGb.toFixed(1)} GB libres (mínimo ${options.minFreeGb} GB).`);
  }
  return {
    dir: options.dir,
    totalBytes: stats.blocks * stats.bsize,
    freeBytes,
    freeGb,
    usedPercent,
    ok: messages.length === 0,
    messages,
  };
}
