import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGzip } from 'node:zlib';

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

/**
 * Dump format flags. The README restore procedure (`gunzip -c file.sql.gz | psql`) depends on these: plain SQL, no
 * ownership or GRANT statements, and no --clean/--create (restores go into an empty scratch database).
 */
export const PG_DUMP_FORMAT_ARGS = ['--format=plain', '--no-owner', '--no-privileges'] as const;

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

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** Removes the connection string, its password (raw and URL-decoded) and any `scheme://user:pass@` from text. */
export function scrubBackupSecrets(text: string, connectionString: string): string {
  let result = text;
  const secrets = new Set<string>();
  if (connectionString) secrets.add(connectionString);
  try {
    const url = new URL(connectionString);
    if (url.password) {
      secrets.add(url.password);
      try { secrets.add(decodeURIComponent(url.password)); } catch { /* keep the raw form only */ }
    }
  } catch { /* not a URL (keyword/value DSN): the full string is still masked */ }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 3) result = result.split(secret).join('[redacted]');
  }
  return result.replace(URL_CREDENTIALS, '$1[redacted]@');
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
 * Runs pg_dump asynchronously (the event loop stays free while a backup is in progress) and streams its stdout through
 * gzip into a new `.sql.gz` file. stderr is kept (tail only) for the error message, a timeout kills the process, and any failure removes
 * the partial file. A pre-existing file with the same name is never overwritten or deleted.
 */
export async function createBackupFile(options: CreateBackupOptions): Promise<BackupResult> {
  const now = options.now ?? (() => new Date());
  const spawnImpl = options.spawnImpl ?? (spawn as unknown as BackupSpawn);
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_TIMEOUT_MS;
  const label = sanitizeBackupLabel(options.label);
  const createdAt = now().toISOString();
  const name = `infidash-${label}-${createdAt.replace(/[:.]/g, '-')}.sql.gz`;
  const filePath = path.join(options.backupDir, name);

  await fs.promises.mkdir(options.backupDir, { recursive: true });
  // 'wx' fails (EEXIST) before pg_dump starts if the name is taken, so cleanup below only ever removes our own file.
  const handle = await fs.promises.open(filePath, 'wx');
  const out = handle.createWriteStream();
  const gzip = createGzip();
  gzip.pipe(out);

  let child: ChildProcess | null = null;
  let exited = false;
  let timer: NodeJS.Timeout | undefined;
  try {
    child = spawnImpl(
      'pg_dump',
      ['--dbname', options.connectionString, ...PG_DUMP_FORMAT_ARGS],
      { env: buildPgClientEnv(options.env), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const running = child;

    let stderrTail = '';
    running.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    running.stdout?.pipe(gzip);

    const finished = new Promise<void>((resolve, reject) => {
      running.once('error', (error) => { exited = true; reject(error); });
      running.once('close', (code, signal) => {
        exited = true;
        if (code === 0) resolve();
        else reject(new Error(scrubBackupSecrets(stderrTail.trim(), options.connectionString) || `pg_dump exited with ${code === null ? `signal ${signal}` : `code ${code}`}`));
      });
    });
    const written = new Promise<void>((resolve, reject) => {
      out.once('finish', () => resolve());
      out.once('error', reject);
      gzip.once('error', reject);
    });
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`pg_dump timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([Promise.all([finished, written]), timedOut]);
  } catch (error) {
    if (child && !exited) child.kill('SIGKILL');
    gzip.destroy();
    await new Promise<void>((resolve) => {
      if (out.closed) return resolve();
      out.once('close', () => resolve());
      out.destroy();
    });
    await fs.promises.rm(filePath, { force: true });
    // Spawn errors and the like could echo arguments: never let the connection string leave this function.
    if (error instanceof Error) error.message = scrubBackupSecrets(error.message, options.connectionString);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const stats = await fs.promises.stat(filePath);
  return { name, label, createdAt, sizeBytes: stats.size };
}
