import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Subset of `child_process.spawn` used here, injectable so the logic is testable without pg_dump. */
export type BackupSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

export interface BackupResult {
  /** File name only. The backup directory is internal and never leaves the server. */
  name: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
}

export interface CreateBackupOptions {
  connectionString: string;
  backupDir: string;
  label?: string | null;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: BackupSpawn;
  timeoutMs?: number;
  now?: () => Date;
}

export const DEFAULT_BACKUP_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL_BYTES = 8 * 1024;

export function sanitizeBackupLabel(label?: string | null) {
  if (!label) {
    return 'manual';
  }

  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'manual';
}

/** Environment for libpq clients (pg_dump): maps DATABASE_SSL to PGSSLMODE and bounds the connect time. */
export function buildPgClientEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  if (!env.PGSSLMODE && env.DATABASE_SSL) {
    env.PGSSLMODE = env.DATABASE_SSL;
  }
  if (!env.PGCONNECT_TIMEOUT) {
    env.PGCONNECT_TIMEOUT = '5';
  }
  return env;
}

/**
 * Runs pg_dump asynchronously (the event loop stays free while a backup is in progress) and streams its stdout straight
 * to a new file. stderr is kept (tail only) for the error message, a timeout kills the process, and any failure removes
 * the partial file. A pre-existing file with the same name is never overwritten or deleted.
 */
export async function createBackupFile(options: CreateBackupOptions): Promise<BackupResult> {
  const now = options.now ?? (() => new Date());
  const spawnImpl = options.spawnImpl ?? (spawn as unknown as BackupSpawn);
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_TIMEOUT_MS;
  const label = sanitizeBackupLabel(options.label);
  const createdAt = now().toISOString();
  const name = `infidash-${label}-${createdAt.replace(/[:.]/g, '-')}.sql`;
  const filePath = path.join(options.backupDir, name);

  await fs.promises.mkdir(options.backupDir, { recursive: true });
  // 'wx' fails (EEXIST) before pg_dump starts if the name is taken, so cleanup below only ever removes our own file.
  const handle = await fs.promises.open(filePath, 'wx');
  const out = handle.createWriteStream();

  let child: ChildProcess | null = null;
  let exited = false;
  let timer: NodeJS.Timeout | undefined;
  try {
    child = spawnImpl(
      'pg_dump',
      ['--dbname', options.connectionString, '--format=plain', '--no-owner', '--no-privileges'],
      { env: buildPgClientEnv(options.env), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const running = child;

    let stderrTail = '';
    running.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    running.stdout?.pipe(out);

    const finished = new Promise<void>((resolve, reject) => {
      running.once('error', (error) => { exited = true; reject(error); });
      running.once('close', (code, signal) => {
        exited = true;
        if (code === 0) resolve();
        else reject(new Error(stderrTail.trim() || `pg_dump exited with ${code === null ? `signal ${signal}` : `code ${code}`}`));
      });
    });
    const written = new Promise<void>((resolve, reject) => {
      out.once('finish', () => resolve());
      out.once('error', reject);
    });
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`pg_dump timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([Promise.all([finished, written]), timedOut]);
  } catch (error) {
    if (child && !exited) child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      if (out.closed) return resolve();
      out.once('close', () => resolve());
      out.destroy();
    });
    await fs.promises.rm(filePath, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const stats = await fs.promises.stat(filePath);
  return { name, label, createdAt, sizeBytes: stats.size };
}
