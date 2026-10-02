import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBackupScheduler,
  parseScheduleHour,
  resolveBackupSchedule,
  withAdvisoryLock,
  type BackupSchedulerDeps,
} from '../src/lib/backupScheduler.js';

const file = (iso: string, label = 'auto') => `infidash-${label}-${iso.replace(/[:.]/g, '-')}.sql.gz`;

function harness(overrides: Partial<BackupSchedulerDeps> & { clock?: { value: string } } = {}) {
  const clock = overrides.clock ?? { value: '2026-10-02T04:00:00.000Z' };
  const state = { files: [] as string[], taken: [] as string[], retentionRuns: 0, logs: [] as string[], lockCalls: 0 };
  const deps: BackupSchedulerDeps = {
    config: { enabled: true, hourUtc: 3, keepDaily: 14, keepWeekly: 8 },
    now: () => new Date(clock.value),
    listFileNames: async () => state.files,
    takeBackup: async (label) => {
      state.taken.push(label);
      const createdAt = clock.value;
      const name = file(createdAt, label);
      state.files.push(name);
      return { name, label, createdAt, sizeBytes: 123 };
    },
    runRetention: async () => {
      state.retentionRuns += 1;
      return { kept: [], deleted: [], failed: [] };
    },
    withLock: async (fn) => {
      state.lockCalls += 1;
      return { acquired: true, value: await fn() };
    },
    log: (level, message) => state.logs.push(`${level}:${message}`),
    ...overrides,
  };
  return { scheduler: createBackupScheduler(deps), state, clock };
}

test('schedule hour parsing accepts only integers 0..23 and defaults to disabled', () => {
  assert.equal(parseScheduleHour(undefined), null);
  assert.equal(parseScheduleHour(''), null);
  assert.equal(parseScheduleHour('abc'), null);
  assert.equal(parseScheduleHour('24'), null);
  assert.equal(parseScheduleHour('-1'), null);
  assert.equal(parseScheduleHour('2.5'), null);
  assert.equal(parseScheduleHour('0'), 0);
  assert.equal(parseScheduleHour(' 23 '), 23);
  assert.deepEqual(resolveBackupSchedule({}), { enabled: false, hourUtc: null, keepDaily: 14, keepWeekly: 8 });
  assert.deepEqual(resolveBackupSchedule({ INFIDASH_BACKUP_SCHEDULE_HOUR: '3', BACKUP_KEEP_DAILY: '5' }), {
    enabled: true, hourUtc: 3, keepDaily: 5, keepWeekly: 8,
  });
});

test('a disabled scheduler never lists, locks or dumps', async () => {
  const { scheduler, state } = harness({ config: { enabled: false, hourUtc: null, keepDaily: 14, keepWeekly: 8 } });
  assert.equal(await scheduler.tick(), 'disabled');
  assert.equal(state.lockCalls, 0);
  assert.deepEqual(state.taken, []);
});

test('before the configured UTC hour nothing runs', async () => {
  const { scheduler, state } = harness({ clock: { value: '2026-10-02T02:59:59.000Z' } });
  assert.equal(await scheduler.tick(), 'too-early');
  assert.deepEqual(state.taken, []);
});

test('after the hour it takes one auto backup, applies retention and records the result; the next tick is a no-op', async () => {
  const { scheduler, state } = harness();
  assert.equal(await scheduler.tick(), 'ok');
  assert.deepEqual(state.taken, ['auto']);
  assert.equal(state.retentionRuns, 1);
  const last = scheduler.getLastRun();
  assert.equal(last?.ok, true);
  assert.equal(last?.sizeBytes, 123);
  assert.equal(last?.at, '2026-10-02T04:00:00.000Z');
  assert.equal(await scheduler.tick(), 'already-done');
  assert.deepEqual(state.taken, ['auto']);
});

test('an auto backup already on disk for today (e.g. before a restart) prevents another one; yesterday or manual ones do not', async () => {
  const a = harness();
  a.state.files = [file('2026-10-02T03:00:00.000Z')];
  assert.equal(await a.scheduler.tick(), 'already-done');

  const b = harness();
  b.state.files = [file('2026-10-01T03:00:00.000Z'), file('2026-10-02T03:30:00.000Z', 'manual')];
  assert.equal(await b.scheduler.tick(), 'ok');
});

test('when another instance holds the lock this one skips, and a backup finished meanwhile is detected after locking', async () => {
  const locked = harness({ withLock: async () => ({ acquired: false }) });
  assert.equal(await locked.scheduler.tick(), 'locked');
  assert.deepEqual(locked.state.taken, []);

  const raced = harness();
  const original = raced.state;
  const h = harness({
    withLock: async (fn) => {
      original.files.push(file('2026-10-02T03:55:00.000Z')); // the other instance finishes right before we lock
      return { acquired: true, value: await fn() };
    },
    listFileNames: async () => original.files,
  });
  assert.equal(await h.scheduler.tick(), 'already-done');
  assert.deepEqual(h.state.taken, []);
});

test('failures are recorded, logged as errors and retried at most 3 times per UTC day', async () => {
  let attempts = 0;
  const { scheduler, clock, state } = harness({
    takeBackup: async () => {
      attempts += 1;
      throw new Error('pg_dump failed');
    },
  });
  assert.equal(await scheduler.tick(), 'failed');
  assert.equal(await scheduler.tick(), 'failed');
  assert.equal(await scheduler.tick(), 'failed');
  assert.equal(await scheduler.tick(), 'attempts-exhausted');
  assert.equal(attempts, 3);
  assert.equal(scheduler.getLastRun()?.ok, false);
  assert.equal(scheduler.getLastRun()?.error, 'pg_dump failed');
  assert.ok(state.logs.some((line) => line.startsWith('error:')));
  assert.equal(state.retentionRuns, 0);

  clock.value = '2026-10-03T03:10:00.000Z'; // a new UTC day resets the budget
  assert.equal(await scheduler.tick(), 'failed');
  assert.equal(attempts, 4);
});

test('a retention failure does not turn a successful backup into a failed run', async () => {
  const { scheduler } = harness({ runRetention: async () => { throw new Error('EACCES'); } });
  assert.equal(await scheduler.tick(), 'ok');
  assert.equal(scheduler.getLastRun()?.ok, true);
});

test('overlapping ticks in the same process do not run two backups', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { scheduler, state } = harness({
    takeBackup: async (label) => {
      await gate;
      state.taken.push(label);
      return { name: file('2026-10-02T04:00:00.000Z'), label, createdAt: '2026-10-02T04:00:00.000Z', sizeBytes: 1 };
    },
  });
  const first = scheduler.tick();
  assert.equal(await scheduler.tick(), 'busy');
  release();
  assert.equal(await first, 'ok');
  assert.deepEqual(state.taken, ['auto']);
});

test('withAdvisoryLock releases the lock and the client even when the work throws, and skips when not acquired', async () => {
  const queries: string[] = [];
  let released = 0;
  const makePool = (acquired: boolean) => ({
    connect: async () => ({
      query: async (text: string) => {
        queries.push(text);
        return { rows: [{ locked: acquired }] };
      },
      release: () => { released += 1; },
    }),
  });

  await assert.rejects(withAdvisoryLock(makePool(true), 42, async () => { throw new Error('boom'); }), /boom/);
  assert.ok(queries.some((q) => q.includes('pg_try_advisory_lock')));
  assert.ok(queries.some((q) => q.includes('pg_advisory_unlock')));
  assert.equal(released, 1);

  queries.length = 0;
  const skipped = await withAdvisoryLock(makePool(false), 42, async () => 'never');
  assert.deepEqual(skipped, { acquired: false });
  assert.ok(!queries.some((q) => q.includes('pg_advisory_unlock')));
  assert.equal(released, 2);
});
