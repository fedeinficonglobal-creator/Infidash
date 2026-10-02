import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Backup retention: keep the newest backup of each of the last N UTC days plus the newest of each of the last M ISO
 * weeks. Only files named exactly like the ones createBackupFile produces are ever considered; everything else in
 * the directory is ignored and never deleted. The single newest backup is always kept.
 */

export const DEFAULT_KEEP_DAILY = 14;
export const DEFAULT_KEEP_WEEKLY = 8;
const MAX_KEEP_DAILY = 365;
const MAX_KEEP_WEEKLY = 104;

// infidash-<label>-<ISO timestamp with ':' and '.' replaced by '-'>.sql[.gz]
const BACKUP_FILE_PATTERN = /^infidash-([a-z0-9-]+?)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql(\.gz)?$/;

export interface ParsedBackupName {
  name: string;
  label: string;
  /** ISO timestamp recovered from the file name (UTC). */
  createdAt: string;
  compressed: boolean;
}

export function parseBackupFileName(fileName: string): ParsedBackupName | null {
  const match = BACKUP_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  const [, label, date, hh, mm, ss, ms, gz] = match;
  const createdAt = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time) || new Date(time).toISOString() !== createdAt) return null;
  return { name: fileName, label, createdAt, compressed: Boolean(gz) };
}

/** ISO 8601 week key (`YYYY-Www`) for a UTC instant. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber); // the Thursday of this ISO week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface RetentionSettings {
  keepDaily: number;
  keepWeekly: number;
}

function parseBoundedInteger(raw: string | undefined, max: number, fallback: number) {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  return value >= 0 && value <= max ? value : fallback;
}

export function parseRetentionSettings(env: Record<string, string | undefined> = process.env): RetentionSettings {
  return {
    keepDaily: parseBoundedInteger(env.BACKUP_KEEP_DAILY, MAX_KEEP_DAILY, DEFAULT_KEEP_DAILY),
    keepWeekly: parseBoundedInteger(env.BACKUP_KEEP_WEEKLY, MAX_KEEP_WEEKLY, DEFAULT_KEEP_WEEKLY),
  };
}

export interface RetentionPlan {
  kept: string[];
  deleted: string[];
}

/** Pure decision: which of the given file names to keep and delete. Non-backup names appear in neither list. */
export function planRetention(fileNames: readonly string[], settings: RetentionSettings): RetentionPlan {
  const backups = fileNames
    .map(parseBackupFileName)
    .filter((entry): entry is ParsedBackupName => entry !== null)
    // Newest first; the name breaks ties deterministically.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));

  const keep = new Set<string>();
  if (backups.length > 0) keep.add(backups[0].name);

  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const backup of backups) {
    const day = backup.createdAt.slice(0, 10);
    if (!days.has(day)) {
      days.add(day);
      if (days.size <= settings.keepDaily) keep.add(backup.name);
    }
    const week = isoWeekKey(new Date(backup.createdAt));
    if (!weeks.has(week)) {
      weeks.add(week);
      if (weeks.size <= settings.keepWeekly) keep.add(backup.name);
    }
  }

  return {
    kept: backups.filter((b) => keep.has(b.name)).map((b) => b.name),
    deleted: backups.filter((b) => !keep.has(b.name)).map((b) => b.name),
  };
}

export interface RetentionDeps {
  readdir?: (dir: string) => Promise<string[]>;
  unlink?: (filePath: string) => Promise<void>;
  log?: (level: 'info' | 'warn', message: string, meta: { name: string; error?: string }) => void;
}

export interface RetentionResult extends RetentionPlan {
  failed: string[];
}

/** Applies the plan. A file that cannot be deleted is reported and skipped; it never aborts the run. */
export async function applyRetention(dir: string, settings: RetentionSettings, deps: RetentionDeps = {}): Promise<RetentionResult> {
  const readdir = deps.readdir ?? (async (target: string) => {
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  });
  const unlink = deps.unlink ?? ((target: string) => fs.promises.unlink(target));
  const log = deps.log ?? (() => {});

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kept: [], deleted: [], failed: [] };
    throw error;
  }

  const plan = planRetention(names, settings);
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const fileName of plan.deleted) {
    try {
      // The name already matched the strict pattern, so it cannot contain separators or traversal.
      await unlink(path.join(dir, fileName));
      deleted.push(fileName);
      log('info', 'backup eliminado por retencion', { name: fileName });
    } catch (error) {
      failed.push(fileName);
      log('warn', 'no se pudo eliminar un backup antiguo', { name: fileName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { kept: plan.kept, deleted, failed };
}

export interface BackupListEntry {
  name: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
}

/** Lists recognized backups (newest first) with their size. File names only, never paths. */
export async function listBackupEntries(dir: string): Promise<BackupListEntry[]> {
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: BackupListEntry[] = [];
  for (const parsed of names.map(parseBackupFileName)) {
    if (!parsed) continue;
    try {
      const stats = await fs.promises.stat(path.join(dir, parsed.name));
      entries.push({ name: parsed.name, label: parsed.label, createdAt: parsed.createdAt, sizeBytes: stats.size });
    } catch {
      // Deleted between readdir and stat: skip.
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}
