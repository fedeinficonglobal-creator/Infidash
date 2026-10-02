import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  evaluateMediaExpiry,
  mapUploadUrlToRelativePath,
  type MediaReference,
} from '../src/server/content/mediaRetention.js';
import {
  checkDiskUsage,
  parseCleanupConfig,
  resolveUploadFile,
  runMediaCleanup,
} from '../src/server/content/mediaCleanup.js';

const PREFIX = 'https://postiz.example.com/uploads';
const NOW = new Date('2026-10-10T12:00:00Z');
const OLD = new Date('2026-09-01T00:00:00Z');
const RECENT = new Date('2026-10-08T00:00:00Z');
const url = (name: string) => `${PREFIX}/${name}`;

const publication = (name: string, status: string, at: Date | null = OLD): MediaReference => ({ source: 'publication', url: url(name), status, at });
const socialPost = (name: string, status: string, at: Date | null = OLD, linked: MediaReference['linked'] = []): MediaReference => ({ source: 'social_post', url: url(name), status, at, linked });
const content = (name: string, status: string, at: Date | null = OLD, linked: MediaReference['linked'] = []): MediaReference => ({ source: 'content', url: url(name), status, at, linked });

const evaluate = (references: MediaReference[], retentionDays = 7) => evaluateMediaExpiry({ references, urlPrefix: PREFIX, retentionDays, now: NOW });

// --- Pure expiry decision ---------------------------------------------------------------------------------

test('a URL whose every referencing row is terminal and older than the retention is expired', () => {
  const result = evaluate([publication('a.mp4', 'published'), publication('b.jpg', 'cancelled'), publication('c.png', 'failed'), socialPost('d.webp', 'discarded')]);
  assert.deepEqual(result.expired.map((entry) => entry.relativePath).sort(), ['a.mp4', 'b.jpg', 'c.png', 'd.webp']);
  assert.equal(result.kept.length, 0);
});

test('one scheduled referencing row keeps the file', () => {
  const result = evaluate([publication('a.mp4', 'published'), publication('a.mp4', 'scheduled')]);
  assert.equal(result.expired.length, 0);
  assert.deepEqual(result.kept.map((entry) => [entry.relativePath, entry.reason]), [['a.mp4', 'non_terminal']]);
});

test('every non-terminal status keeps the file', () => {
  for (const status of ['pending', 'sending', 'scheduled', 'unknown', 'cancel_requested', 'draft', 'something_new']) {
    assert.equal(evaluate([publication('a.mp4', status)]).expired.length, 0, status);
  }
  for (const status of ['review', 'approved', 'scheduled']) {
    assert.equal(evaluate([socialPost('a.mp4', status)]).expired.length, 0, `social ${status}`);
  }
});

test('a URL shared by two posts where one is pending is kept', () => {
  const result = evaluate([socialPost('shared.mp4', 'discarded'), socialPost('shared.mp4', 'review')]);
  assert.equal(result.expired.length, 0);
  assert.equal(result.kept[0].reason, 'non_terminal');
});

test('a terminal row that is too recent keeps the file, and the newest referencing row decides', () => {
  assert.deepEqual(evaluate([publication('a.mp4', 'published', RECENT)]).kept.map((entry) => entry.reason), ['too_recent']);
  assert.equal(evaluate([publication('b.mp4', 'published', OLD), publication('b.mp4', 'failed', RECENT)]).expired.length, 0);
  assert.equal(evaluate([publication('c.mp4', 'published', RECENT)], 1).expired.length, 1);
});

test('a terminal row without a usable timestamp keeps the file', () => {
  const result = evaluate([publication('a.mp4', 'published', null)]);
  assert.equal(result.expired.length, 0);
  assert.equal(result.kept[0].reason, 'unknown_timestamp');
});

test('URLs outside the uploads prefix are ignored, never expired or reported as kept', () => {
  const result = evaluate([
    { source: 'publication', url: 'https://cdn.other.com/uploads/a.mp4', status: 'published', at: OLD },
    { source: 'publication', url: 'https://postiz.example.com/other/a.mp4', status: 'published', at: OLD },
    { source: 'publication', url: 'https://postiz.example.com/uploadsX/a.mp4', status: 'published', at: OLD },
  ]);
  assert.equal(result.expired.length, 0);
  assert.equal(result.kept.length, 0);
  assert.equal(result.ignored, 3);
});

test('a header image referenced by a content row stays while the content or its publications are not finished', () => {
  const done = { status: 'published', at: OLD };
  // Same file referenced by the publication (terminal) and by an approved content with no publication yet.
  assert.equal(evaluate([publication('h.jpg', 'published'), content('h.jpg', 'approved', OLD, [])]).expired.length, 0);
  // Content still in review, even if its publication is done.
  assert.equal(evaluate([publication('h.jpg', 'published'), content('h.jpg', 'review', OLD, [done])]).expired.length, 0);
  // Content approved with a pending publication.
  assert.equal(evaluate([content('h.jpg', 'approved', OLD, [{ status: 'scheduled', at: OLD }])]).expired.length, 0);
  // Approved content whose publications are all terminal and old: expired.
  assert.equal(evaluate([publication('h.jpg', 'published'), content('h.jpg', 'approved', OLD, [done])]).expired.length, 1);
  // Archived content: expired once old.
  assert.equal(evaluate([content('h.jpg', 'archived', OLD, [])]).expired.length, 1);
  // A recent linked publication keeps an otherwise old content.
  assert.equal(evaluate([content('h.jpg', 'approved', OLD, [{ status: 'published', at: RECENT }])]).expired.length, 0);
});

test('a scheduled social post is finished only when its linked publication is terminal', () => {
  assert.equal(evaluate([socialPost('s.mp4', 'scheduled', OLD, [])]).expired.length, 0);
  assert.equal(evaluate([socialPost('s.mp4', 'scheduled', OLD, [{ status: 'scheduled', at: OLD }])]).expired.length, 0);
  assert.equal(evaluate([socialPost('s.mp4', 'scheduled', OLD, [{ status: 'published', at: OLD }])]).expired.length, 1);
  assert.equal(evaluate([socialPost('s.mp4', 'scheduled', OLD, [{ status: 'published', at: RECENT }])]).expired.length, 0);
});

test('encoded variants of the same file are treated as one URL, and query strings are ignored', () => {
  const result = evaluate([
    { source: 'publication', url: `${PREFIX}/my%20file.mp4`, status: 'published', at: OLD },
    { source: 'publication', url: `${PREFIX}/my file.mp4?x=1`, status: 'scheduled', at: OLD },
  ]);
  assert.equal(result.expired.length, 0);
  assert.equal(result.kept.length, 1);
});

test('unsafe or unsupported references are skipped, never expired', () => {
  const result = evaluate([
    { source: 'publication', url: `${PREFIX}/../secret.mp4`, status: 'published', at: OLD },
    { source: 'publication', url: `${PREFIX}/doc.pdf`, status: 'published', at: OLD },
  ]);
  assert.equal(result.expired.length, 0);
  assert.equal(result.skipped.length, 2);
});

// --- URL to path mapper -----------------------------------------------------------------------------------

test('the mapper accepts full-URL and path-only prefixes', () => {
  assert.deepEqual(mapUploadUrlToRelativePath(`${PREFIX}/2026/10/a.MP4`, PREFIX), { ok: true, relativePath: '2026/10/a.MP4' });
  assert.deepEqual(mapUploadUrlToRelativePath(`${PREFIX}/a.mp4`, `${PREFIX}/`), { ok: true, relativePath: 'a.mp4' });
  assert.deepEqual(mapUploadUrlToRelativePath('/uploads/a.png', '/uploads'), { ok: true, relativePath: 'a.png' });
  assert.deepEqual(mapUploadUrlToRelativePath(`${PREFIX}/a.png`, '/uploads'), { ok: true, relativePath: 'a.png' });
  assert.deepEqual(mapUploadUrlToRelativePath(`${PREFIX}/a%20b.webm#frag`, PREFIX), { ok: true, relativePath: 'a b.webm' });
});

test('the mapper rejects traversal, absolute paths, backslashes and wrong extensions', () => {
  const reason = (input: string) => {
    const result = mapUploadUrlToRelativePath(input, PREFIX);
    return result.ok ? 'ok' : result.reason;
  };
  assert.equal(reason(`${PREFIX}/../a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/x/../../a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/%2e%2e/a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/%2E%2E%2Fa.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/..%5Ca.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/x\\a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}//etc/a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/%2Fetc%2Fa.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/C:/a.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/a%00.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/%E0%A4%A.mp4`), 'unsafe');
  assert.equal(reason(`${PREFIX}/a.exe`), 'extension');
  assert.equal(reason(`${PREFIX}/a`), 'extension');
  assert.equal(reason(`${PREFIX}/`), 'unsafe');
  assert.equal(reason('https://cdn.other.com/uploads/a.mp4'), 'foreign');
  assert.equal(reason('not a url'), 'foreign');
});

test('every allowed extension maps', () => {
  for (const extension of ['mp4', 'mov', 'm4v', 'webm', 'jpg', 'jpeg', 'png', 'webp']) {
    assert.equal(mapUploadUrlToRelativePath(`${PREFIX}/a.${extension}`, PREFIX).ok, true, extension);
  }
});

// --- Filesystem -------------------------------------------------------------------------------------------

async function withTempDirectory<T>(operation: (root: string, uploads: string) => Promise<T>) {
  const root = await mkdtemp(path.join(tmpdir(), 'infidash-media-'));
  const uploads = path.join(root, 'uploads');
  await mkdir(uploads, { recursive: true });
  try {
    return await operation(root, uploads);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolveUploadFile resolves regular files, reports missing ones and refuses directories', async () => {
  await withTempDirectory(async (_root, uploads) => {
    await mkdir(path.join(uploads, '2026'));
    await writeFile(path.join(uploads, '2026', 'a.mp4'), 'x'.repeat(10));
    const found = await resolveUploadFile(uploads, '2026/a.mp4');
    assert.equal(found.status, 'file');
    if (found.status === 'file') assert.equal(found.bytes, 10);
    assert.equal((await resolveUploadFile(uploads, '2026/missing.mp4')).status, 'missing');
    await mkdir(path.join(uploads, 'dir.mp4'));
    assert.equal((await resolveUploadFile(uploads, 'dir.mp4')).status, 'not_file');
    assert.equal((await resolveUploadFile(uploads, '../x.mp4')).status, 'unsafe');
  });
});

test('resolveUploadFile refuses symlinks that escape the uploads directory', async (context) => {
  await withTempDirectory(async (root, uploads) => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.mp4'), 'secret');
    try {
      await symlink(path.join(outside, 'secret.mp4'), path.join(uploads, 'link.mp4'), 'file');
      await symlink(outside, path.join(uploads, 'linkdir'), 'junction');
    } catch {
      context.skip('symlinks are not permitted on this OS/account');
      return;
    }
    assert.equal((await resolveUploadFile(uploads, 'link.mp4')).status, 'unsafe');
    assert.equal((await resolveUploadFile(uploads, 'linkdir/secret.mp4')).status, 'unsafe');
    assert.ok(existsSync(path.join(outside, 'secret.mp4')));
  });
});

const dueReferences = (names: string[], status = 'published') => names.map((name) => publication(name, status));

test('dry-run reports but deletes nothing; apply deletes only expired files; a second run is idempotent', async () => {
  await withTempDirectory(async (_root, uploads) => {
    await mkdir(path.join(uploads, '2026'));
    for (const name of ['2026/old.mp4', '2026/pending.mp4', '2026/recent.mp4', '2026/unreferenced.mp4', 'foreign-ok.png']) {
      await writeFile(path.join(uploads, name), 'x'.repeat(100));
    }
    const references = [
      ...dueReferences(['2026/old.mp4']),
      publication('2026/pending.mp4', 'scheduled'),
      publication('2026/recent.mp4', 'published', RECENT),
      publication('2026/ghost.mp4', 'published'),
      { source: 'publication' as const, url: 'https://elsewhere.com/uploads/foreign-ok.png', status: 'published', at: OLD },
    ];
    const logged: string[] = [];
    const base = {
      uploadDir: uploads, urlPrefix: PREFIX, retentionDays: 7, now: NOW,
      loadReferences: async () => references,
      recordDeletion: async (entry: { url: string }) => { logged.push(entry.url); },
    };

    const dry = await runMediaCleanup({ ...base, apply: false });
    assert.equal(dry.apply, false);
    assert.equal(dry.candidates, 2);
    assert.equal(dry.bytesFreed, 100);
    assert.equal(dry.deleted.length, 1);
    assert.equal(dry.missing.length, 1);
    assert.ok(existsSync(path.join(uploads, '2026', 'old.mp4')));
    assert.deepEqual(logged, []);

    const applied = await runMediaCleanup({ ...base, apply: true });
    assert.equal(applied.deleted.length, 1);
    assert.equal(applied.bytesFreed, 100);
    assert.deepEqual(applied.errors, []);
    assert.equal(existsSync(path.join(uploads, '2026', 'old.mp4')), false);
    for (const survivor of ['2026/pending.mp4', '2026/recent.mp4', '2026/unreferenced.mp4', 'foreign-ok.png']) {
      assert.ok(existsSync(path.join(uploads, survivor)), survivor);
    }
    assert.deepEqual(logged, [url('2026/old.mp4')]);
    assert.ok(applied.kept.some((entry) => entry.relativePath === '2026/pending.mp4' && entry.reason === 'non_terminal'));

    const second = await runMediaCleanup({ ...base, apply: true });
    assert.equal(second.deleted.length, 0);
    assert.equal(second.missing.length, 2);
    assert.equal(second.bytesFreed, 0);
    assert.equal(logged.length, 1);
  });
});

test('a failing deletion is reported without aborting the run and logging failures count as errors', async () => {
  await withTempDirectory(async (_root, uploads) => {
    await writeFile(path.join(uploads, 'a.mp4'), 'x');
    await writeFile(path.join(uploads, 'b.mp4'), 'x');
    const report = await runMediaCleanup({
      uploadDir: uploads, urlPrefix: PREFIX, retentionDays: 7, now: NOW, apply: true,
      loadReferences: async () => dueReferences(['a.mp4', 'b.mp4']),
      unlinkFile: async (file) => { if (file.endsWith('a.mp4')) throw new Error('EBUSY'); await rm(file); },
      recordDeletion: async () => { throw new Error('db down'); },
    });
    assert.equal(report.errors.length, 2);
    assert.ok(existsSync(path.join(uploads, 'a.mp4')));
    assert.equal(existsSync(path.join(uploads, 'b.mp4')), false);
    assert.equal(report.deleted.length, 1);
  });
});

// --- Configuration ----------------------------------------------------------------------------------------

test('parseCleanupConfig applies defaults, validates the retention and requires the paths', () => {
  const env = { POSTIZ_UPLOAD_DIR: '/data/uploads', POSTIZ_UPLOAD_URL_PREFIX: PREFIX };
  const config = parseCleanupConfig([], env);
  assert.deepEqual(
    { apply: config.apply, days: config.retentionDays, check: config.checkDisk, warn: config.warnPercent },
    { apply: false, days: 7, check: false, warn: 80 },
  );
  assert.equal(parseCleanupConfig(['--apply', '--days=30'], env).retentionDays, 30);
  assert.equal(parseCleanupConfig([], { ...env, POSTIZ_MEDIA_RETENTION_DAYS: '14' }).retentionDays, 14);
  assert.equal(parseCleanupConfig(['--days=3'], { ...env, POSTIZ_MEDIA_RETENTION_DAYS: '14' }).retentionDays, 3);
  for (const bad of ['0', '366', '1.5', 'abc', '-2']) {
    assert.throws(() => parseCleanupConfig([`--days=${bad}`], env), /POSTIZ_MEDIA_RETENTION_DAYS|--days/);
  }
  assert.throws(() => parseCleanupConfig([], { POSTIZ_UPLOAD_URL_PREFIX: PREFIX }), /POSTIZ_UPLOAD_DIR/);
  assert.throws(() => parseCleanupConfig([], { POSTIZ_UPLOAD_DIR: '/x' }), /POSTIZ_UPLOAD_URL_PREFIX/);
  // The disk check needs only the directory.
  const disk = parseCleanupConfig(['--check-disk', '--warn-percent=70', '--min-free-gb=5'], { POSTIZ_UPLOAD_DIR: '/x' });
  assert.deepEqual({ check: disk.checkDisk, warn: disk.warnPercent, free: disk.minFreeGb }, { check: true, warn: 70, free: 5 });
  assert.equal(parseCleanupConfig(['--min-free-gb=5'], { POSTIZ_UPLOAD_DIR: '/x' }).checkDisk, true);
  assert.throws(() => parseCleanupConfig(['--check-disk', '--warn-percent=0'], { POSTIZ_UPLOAD_DIR: '/x' }), /--warn-percent/);
});

// --- Disk check -------------------------------------------------------------------------------------------

const GB = 1024 ** 3;
const fakeStatfs = (totalGb: number, availableGb: number) => async () => ({ bsize: 4096, blocks: (totalGb * GB) / 4096, bfree: (availableGb * GB) / 4096, bavail: (availableGb * GB) / 4096 });

test('checkDiskUsage flags usage at or above the warn percent and free space below the minimum', async () => {
  const below = await checkDiskUsage({ dir: '/x', warnPercent: 80, statfs: fakeStatfs(80, 40) });
  assert.equal(below.ok, true);
  assert.equal(below.usedPercent, 50);
  assert.equal(below.freeGb, 40);

  const atLimit = await checkDiskUsage({ dir: '/x', warnPercent: 80, statfs: fakeStatfs(100, 20) });
  assert.equal(atLimit.ok, false);
  assert.match(atLimit.messages.join(' '), /80/);

  const lowFree = await checkDiskUsage({ dir: '/x', warnPercent: 99, minFreeGb: 10, statfs: fakeStatfs(100, 5) });
  assert.equal(lowFree.ok, false);
  assert.match(lowFree.messages.join(' '), /10/);

  const fine = await checkDiskUsage({ dir: '/x', warnPercent: 80, minFreeGb: 10, statfs: fakeStatfs(100, 60) });
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.messages, []);
});
