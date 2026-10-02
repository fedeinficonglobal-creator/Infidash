import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LEADS_RAW_PAYLOAD_DAYS,
  DEFAULT_LEADS_RETENTION_MONTHS,
  computeLeadsCutoffs,
  createLeadsRetentionRunner,
  purgeLeads,
  resolveLeadsRetention,
  subtractMonthsUtc,
} from '../src/lib/leadsRetention.js';

test('defaults are 24 months and 90 days', () => {
  assert.equal(DEFAULT_LEADS_RETENTION_MONTHS, 24);
  assert.equal(DEFAULT_LEADS_RAW_PAYLOAD_DAYS, 90);
  assert.deepEqual(resolveLeadsRetention({}), { retentionMonths: 24, rawPayloadDays: 90 });
});

test('LEADS_RETENTION_MONTHS accepts integers 1..120 and falls back to 24 otherwise (0 never disables)', () => {
  const months = (value: string | undefined) => resolveLeadsRetention({ LEADS_RETENTION_MONTHS: value }).retentionMonths;
  assert.equal(months('1'), 1);
  assert.equal(months(' 36 '), 36);
  assert.equal(months('120'), 120);
  for (const bad of ['0', '-1', '121', '1.5', 'abc', '', '12m', '1e2', undefined]) assert.equal(months(bad), 24, String(bad));
});

test('LEADS_RAW_PAYLOAD_DAYS accepts integers 1..3650 and falls back to 90 otherwise', () => {
  const days = (value: string | undefined) => resolveLeadsRetention({ LEADS_RAW_PAYLOAD_DAYS: value }).rawPayloadDays;
  assert.equal(days('1'), 1);
  assert.equal(days('3650'), 3650);
  assert.equal(days('30'), 30);
  for (const bad of ['0', '-5', '3651', '2.5', 'x', '', undefined]) assert.equal(days(bad), 90, String(bad));
});

test('subtractMonthsUtc clamps to the last day of shorter months', () => {
  assert.equal(subtractMonthsUtc(new Date('2026-03-31T10:00:00.000Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(subtractMonthsUtc(new Date('2028-03-31T10:00:00.000Z'), 1).toISOString(), '2028-02-29T10:00:00.000Z');
  assert.equal(subtractMonthsUtc(new Date('2026-10-02T00:00:00.000Z'), 24).toISOString(), '2024-10-02T00:00:00.000Z');
  assert.equal(subtractMonthsUtc(new Date('2026-01-15T00:00:00.000Z'), 2).toISOString(), '2025-11-15T00:00:00.000Z');
});

test('computeLeadsCutoffs uses the injected clock', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  const cutoffs = computeLeadsCutoffs(now, { retentionMonths: 24, rawPayloadDays: 90 });
  assert.equal(cutoffs.deleteBefore.toISOString(), '2024-10-02T12:00:00.000Z');
  assert.equal(cutoffs.blankPayloadBefore.toISOString(), '2026-07-04T12:00:00.000Z');
});

function fakeDb(counts: number[]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let index = 0;
  return {
    calls,
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: counts[index++] ?? 0 };
    },
  };
}

test('purgeLeads deletes in batches until a short batch, then blanks raw payloads, with bound parameters only', async () => {
  const db = fakeDb([2, 2, 1, 2, 0]);
  const cutoffs = { deleteBefore: new Date('2024-10-02T00:00:00.000Z'), blankPayloadBefore: new Date('2026-07-04T00:00:00.000Z') };
  const result = await purgeLeads(db, cutoffs, 2);
  assert.deepEqual(result, { deleted: 5, payloadsBlanked: 2 });
  assert.equal(db.calls.length, 5);
  assert.match(db.calls[0].text, /DELETE FROM leads/);
  assert.match(db.calls[0].text, /received_at < \$1::timestamptz/);
  assert.deepEqual(db.calls[0].values, ['2024-10-02T00:00:00.000Z', 2]);
  assert.match(db.calls[3].text, /UPDATE leads SET raw_payload_json = '\{\}'/);
  assert.match(db.calls[3].text, /raw_payload_json <> '\{\}'/);
  assert.deepEqual(db.calls[3].values, ['2026-07-04T00:00:00.000Z', 2]);
  for (const call of db.calls) assert.doesNotMatch(call.text, /2024|2026/);
});

function runnerDeps(overrides: Record<string, unknown> = {}) {
  const logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  return {
    logs,
    deps: {
      config: { retentionMonths: 24, rawPayloadDays: 90 },
      now: () => new Date('2026-10-02T12:00:00.000Z'),
      purge: async () => ({ deleted: 3, payloadsBlanked: 4 }),
      withLock: async <T>(fn: () => Promise<T>) => ({ acquired: true as const, value: await fn() }),
      log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => { logs.push({ level, message, meta }); },
      ...overrides,
    },
  };
}

test('runner purges with computed cutoffs and logs counts only', async () => {
  let received: unknown;
  const { deps, logs } = runnerDeps({ purge: async (cutoffs: unknown) => { received = cutoffs; return { deleted: 3, payloadsBlanked: 4 }; } });
  const runner = createLeadsRetentionRunner(deps);
  assert.equal(await runner.tick(), 'ok');
  assert.equal((received as { deleteBefore: Date }).deleteBefore.toISOString(), '2024-10-02T12:00:00.000Z');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'info');
  assert.deepEqual(logs[0].meta, { deleted: 3, payloadsBlanked: 4, retentionMonths: 24, rawPayloadDays: 90 });
});

test('runner skips when another instance holds the lock', async () => {
  let purged = false;
  const { deps } = runnerDeps({ withLock: async () => ({ acquired: false as const }), purge: async () => { purged = true; return { deleted: 0, payloadsBlanked: 0 }; } });
  assert.equal(await createLeadsRetentionRunner(deps).tick(), 'locked');
  assert.equal(purged, false);
});

test('runner logs failures without throwing', async () => {
  const { deps, logs } = runnerDeps({ purge: async () => { throw new Error('boom'); } });
  assert.equal(await createLeadsRetentionRunner(deps).tick(), 'failed');
  assert.equal(logs[0].level, 'error');
  assert.equal(logs[0].meta?.error, 'boom');
});

test('runner is silent when there is nothing to purge and never overlaps itself', async () => {
  const { deps, logs } = runnerDeps({ purge: async () => ({ deleted: 0, payloadsBlanked: 0 }) });
  assert.equal(await createLeadsRetentionRunner(deps).tick(), 'ok');
  assert.equal(logs.length, 0);

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow = runnerDeps({ purge: async () => { await gate; return { deleted: 0, payloadsBlanked: 0 }; } });
  const runner = createLeadsRetentionRunner(slow.deps);
  const first = runner.tick();
  assert.equal(await runner.tick(), 'busy');
  release();
  assert.equal(await first, 'ok');
});
