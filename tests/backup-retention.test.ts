import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRetention,
  isoWeekKey,
  parseBackupFileName,
  parseRetentionSettings,
  planRetention,
} from '../src/lib/backupRetention.js';

const name = (iso: string, label = 'auto', ext = '.sql.gz') => `infidash-${label}-${iso.replace(/[:.]/g, '-')}${ext}`;

test('only files matching the exact backup naming pattern are parsed', () => {
  const parsed = parseBackupFileName(name('2026-10-01T10:00:00.000Z', 'mi-copia'));
  assert.deepEqual(parsed && { label: parsed.label, createdAt: parsed.createdAt, compressed: parsed.compressed }, {
    label: 'mi-copia',
    createdAt: '2026-10-01T10:00:00.000Z',
    compressed: true,
  });
  assert.equal(parseBackupFileName(name('2026-10-01T10:00:00.000Z', 'manual', '.sql'))?.compressed, false);
  for (const other of [
    'notes.txt',
    'infidash-auto-2026-10-01.sql',
    'x-infidash-auto-2026-10-01T10-00-00-000Z.sql',
    'infidash-auto-2026-10-01T10-00-00-000Z.sql.bak',
    'infidash-auto-2026-10-01T10-00-00-000Z.sql.gz.part',
    '../infidash-a-2026-10-01T10-00-00-000Z.sql',
  ]) {
    assert.equal(parseBackupFileName(other), null, other);
  }
});

test('isoWeekKey follows ISO 8601 across year boundaries', () => {
  assert.equal(isoWeekKey(new Date('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(isoWeekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(isoWeekKey(new Date('2026-12-28T00:00:00Z')), '2026-W53');
  assert.equal(isoWeekKey(new Date('2026-10-05T12:00:00Z')), '2026-W41');
});

test('keeps the newest backup per day for N days plus the newest per week for M weeks, deletes the rest', () => {
  const names: string[] = [];
  for (let day = 1; day <= 30; day += 1) {
    const d = String(day).padStart(2, '0');
    names.push(name(`2026-09-${d}T03:00:00.000Z`));
    names.push(name(`2026-09-${d}T01:00:00.000Z`, 'manual'));
  }
  const plan = planRetention(names, { keepDaily: 3, keepWeekly: 2 });
  // Daily: Sep 30, 29, 28 (newest of each day). Weekly: ISO week 40 (Sep 28-30, already kept) and week 39 (Sep 27).
  assert.deepEqual([...plan.kept].sort(), [
    name('2026-09-27T03:00:00.000Z'),
    name('2026-09-28T03:00:00.000Z'),
    name('2026-09-29T03:00:00.000Z'),
    name('2026-09-30T03:00:00.000Z'),
  ].sort());
  assert.equal(plan.deleted.length, names.length - 4);
  assert.ok(plan.deleted.includes(name('2026-09-30T01:00:00.000Z', 'manual')));
});

test('the newest backup is never deleted, even with zero retention', () => {
  const names = [name('2026-09-01T03:00:00.000Z'), name('2026-09-02T03:00:00.000Z', 'auto', '.sql')];
  const plan = planRetention(names, { keepDaily: 0, keepWeekly: 0 });
  assert.deepEqual(plan.kept, [name('2026-09-02T03:00:00.000Z', 'auto', '.sql')]);
  assert.deepEqual(plan.deleted, [name('2026-09-01T03:00:00.000Z')]);
});

test('unrelated files are neither kept nor deleted', () => {
  const plan = planRetention(['README.txt', 'dump.sql', name('2026-09-01T03:00:00.000Z')], { keepDaily: 1, keepWeekly: 0 });
  assert.deepEqual(plan.deleted, []);
  assert.deepEqual(plan.kept, [name('2026-09-01T03:00:00.000Z')]);
});

test('retention settings validate integers and fall back to defaults', () => {
  assert.deepEqual(parseRetentionSettings({}), { keepDaily: 14, keepWeekly: 8 });
  assert.deepEqual(parseRetentionSettings({ BACKUP_KEEP_DAILY: '7', BACKUP_KEEP_WEEKLY: '0' }), { keepDaily: 7, keepWeekly: 0 });
  assert.deepEqual(parseRetentionSettings({ BACKUP_KEEP_DAILY: '366', BACKUP_KEEP_WEEKLY: '105' }), { keepDaily: 14, keepWeekly: 8 });
  assert.deepEqual(parseRetentionSettings({ BACKUP_KEEP_DAILY: '-1', BACKUP_KEEP_WEEKLY: '2.5' }), { keepDaily: 14, keepWeekly: 8 });
  assert.deepEqual(parseRetentionSettings({ BACKUP_KEEP_DAILY: 'abc', BACKUP_KEEP_WEEKLY: ' 12 ' }), { keepDaily: 14, keepWeekly: 12 });
  assert.deepEqual(parseRetentionSettings({ BACKUP_KEEP_DAILY: '365', BACKUP_KEEP_WEEKLY: '104' }), { keepDaily: 365, keepWeekly: 104 });
});

test('applyRetention unlinks only planned files, tolerates per-file errors and logs each deletion', async () => {
  const old1 = name('2026-09-01T03:00:00.000Z');
  const old2 = name('2026-09-02T03:00:00.000Z');
  const newest = name('2026-09-03T03:00:00.000Z');
  const unlinked: string[] = [];
  const logs: string[] = [];
  const result = await applyRetention('/backups', { keepDaily: 1, keepWeekly: 0 }, {
    readdir: async () => ['notes.txt', old1, old2, newest],
    unlink: async (file) => {
      if (file.endsWith(old1)) throw new Error('EPERM');
      unlinked.push(file);
    },
    log: (level, message, meta) => logs.push(`${level}:${message}:${meta.name}`),
  });
  assert.equal(unlinked.length, 1);
  assert.ok(unlinked[0].endsWith(old2));
  assert.deepEqual(result.kept, [newest]);
  assert.deepEqual(result.deleted, [old2]);
  assert.deepEqual(result.failed, [old1]);
  assert.equal(logs.length, 2);
});
