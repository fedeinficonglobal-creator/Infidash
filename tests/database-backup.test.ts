import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createBackupFile, sanitizeBackupLabel, type BackupSpawn } from '../src/lib/databaseBackup.js';

class FakePgDump extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killSignals: Array<NodeJS.Signals | number | undefined> = [];
  kill(signal?: NodeJS.Signals | number) {
    this.killSignals.push(signal);
    return true;
  }
}

function withBackupDir(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'infidash-backup-'));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function spawnFake(script: (child: FakePgDump) => void) {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const children: FakePgDump[] = [];
  const spawnImpl = ((command: string, args: readonly string[]) => {
    const child = new FakePgDump();
    calls.push({ command, args });
    children.push(child);
    setImmediate(() => script(child));
    return child;
  }) as unknown as BackupSpawn;
  return { spawnImpl, calls, children };
}

const connectionString = 'postgres://user:secret@localhost:5432/infidash_test';
const now = () => new Date('2026-10-01T10:00:00.000Z');

test('a successful backup streams pg_dump output to a file and reports only its name', async () => {
  await withBackupDir(async (dir) => {
    const { spawnImpl, calls } = spawnFake((child) => {
      child.stdout.write('-- dump part 1\n');
      child.stdout.end('-- dump part 2\n');
      child.emit('close', 0, null);
    });

    const result = await createBackupFile({ connectionString, backupDir: dir, label: 'Mi Copia', spawnImpl, now });

    assert.equal(calls[0].command, 'pg_dump');
    assert.ok(calls[0].args.includes('--no-owner'));
    assert.equal(result.label, 'mi-copia');
    assert.equal(result.createdAt, '2026-10-01T10:00:00.000Z');
    assert.match(result.name, /^infidash-mi-copia-.*\.sql$/);
    assert.equal(result.sizeBytes, Buffer.byteLength('-- dump part 1\n-- dump part 2\n'));
    assert.equal(readFileSync(join(dir, result.name), 'utf8'), '-- dump part 1\n-- dump part 2\n');
    assert.ok(!JSON.stringify(result).includes(dir), 'the response must not contain the backup directory');
    assert.equal('path' in result, false);
  });
});

test('a non-zero exit rejects with the streamed stderr and removes the partial file', async () => {
  await withBackupDir(async (dir) => {
    const { spawnImpl } = spawnFake((child) => {
      child.stdout.write('-- partial\n');
      child.stderr.write('pg_dump: error: connection refused');
      child.stdout.end();
      child.emit('close', 1, null);
    });

    await assert.rejects(
      createBackupFile({ connectionString, backupDir: dir, spawnImpl, now }),
      /connection refused/,
    );
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('a spawn failure (pg_dump missing) rejects and leaves no file behind', async () => {
  await withBackupDir(async (dir) => {
    const { spawnImpl } = spawnFake((child) => {
      child.emit('error', Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }));
    });

    await assert.rejects(createBackupFile({ connectionString, backupDir: dir, spawnImpl, now }), /ENOENT/);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('a backup that exceeds the timeout kills pg_dump and removes the partial file', async () => {
  await withBackupDir(async (dir) => {
    const { spawnImpl, children } = spawnFake((child) => {
      child.stdout.write('-- never finishes\n');
    });

    await assert.rejects(
      createBackupFile({ connectionString, backupDir: dir, spawnImpl, now, timeoutMs: 25 }),
      /timed out/,
    );
    assert.equal(children[0].killSignals.length >= 1, true);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('a pre-existing backup with the same name is never overwritten or deleted', async () => {
  await withBackupDir(async (dir) => {
    const ok = spawnFake((child) => {
      child.stdout.end('-- first\n');
      child.emit('close', 0, null);
    });
    const first = await createBackupFile({ connectionString, backupDir: dir, spawnImpl: ok.spawnImpl, now });

    const second = spawnFake(() => assert.fail('pg_dump must not start when the target file already exists'));
    await assert.rejects(createBackupFile({ connectionString, backupDir: dir, spawnImpl: second.spawnImpl, now }));
    assert.equal(readFileSync(join(dir, first.name), 'utf8'), '-- first\n');
  });
});

test('backup labels are normalized to a safe file-name fragment', () => {
  assert.equal(sanitizeBackupLabel(undefined), 'manual');
  assert.equal(sanitizeBackupLabel('  Ñandú / ../etc  '), 'nandu-etc');
  assert.equal(sanitizeBackupLabel('***'), 'manual');
});
