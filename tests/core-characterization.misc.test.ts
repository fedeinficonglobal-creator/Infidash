import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Characterization tests for the UX (Clarity) snapshots, operational plans, report runs and RRSS channels of the
// core data layer (src/lib/database.ts). They pin the behavior the psql shim had so the move to the pg pool does not
// silently change observable results. Every call is awaited so the same file runs against sync and async versions.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

async function makeClient(label: string) {
  const { createClient } = await loadDatabase();
  return await createClient({ name: `${label} ${unique()}` });
}

async function makeUser() {
  const { createUser } = await loadDatabase();
  return await createUser({ email: `misc-${unique()}@example.test`, name: 'Misc', password: 'correct horse battery 1', role: 'admin' });
}

// ---------------------------------------------------------------- UX snapshots

test('upsertUxSnapshot returns null for an unknown client and writes nothing', async () => {
  const { upsertUxSnapshot, listUxSnapshots } = await loadDatabase();
  assert.equal(await upsertUxSnapshot({ clientId: MISSING_ID, snapshotDate: '2026-01-01' }), null);
  assert.deepEqual(await listUxSnapshots(MISSING_ID), []);
});

test('upsertUxSnapshot applies defaults, trims the date and returns the stored row', async () => {
  const { upsertUxSnapshot, listUxSnapshots } = await loadDatabase();
  const client = await makeClient('UX defaults');
  const created = await upsertUxSnapshot({ clientId: client.id, snapshotDate: ' 2026-01-02 ' });

  assert.ok(created);
  assert.equal(created.clientId, client.id);
  assert.equal(created.snapshotDate, '2026-01-02');
  assert.equal(created.sessions, 0);
  assert.equal(created.pageViews, 0);
  assert.equal(created.rageClicks, 0);
  assert.equal(created.deadClicks, 0);
  assert.equal(created.scrollDepthAvg, 0);
  assert.equal(created.engagedSessions, 0);
  assert.equal(created.conversions, 0);
  assert.equal(created.conversionRate, 0);
  assert.equal(created.notes, null);
  assert.equal(created.source, 'clarity');
  assert.equal(created.payloadJson, '{}');
  assert.equal(created.createdAt, created.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
  assert.deepEqual(Object.keys(created).sort(), [
    'clientId', 'conversionRate', 'conversions', 'createdAt', 'deadClicks', 'engagedSessions', 'id', 'notes', 'pageViews',
    'payloadJson', 'rageClicks', 'scrollDepthAvg', 'sessions', 'snapshotDate', 'source', 'updatedAt',
  ]);
  assert.deepEqual(await listUxSnapshots(client.id), [created]);
});

test('upsertUxSnapshot honors a caller supplied id on insert and trims a blank source back to clarity', async () => {
  const { upsertUxSnapshot } = await loadDatabase();
  const client = await makeClient('UX id');
  const id = crypto.randomUUID();
  const created = await upsertUxSnapshot({ clientId: client.id, snapshotDate: '2026-01-03', id, source: '   ', notes: 'nota "x" \' y' });
  assert.equal(created?.id, id);
  assert.equal(created?.source, 'clarity');
  assert.equal(created?.notes, 'nota "x" \' y');
});

test('upsertUxSnapshot rounds fractional values into INTEGER columns, keeps REAL values and maps non-finite values to 0', async () => {
  const { upsertUxSnapshot } = await loadDatabase();
  const client = await makeClient('UX numbers');
  const rounded = await upsertUxSnapshot({
    clientId: client.id, snapshotDate: '2026-01-04', sessions: 12.7, pageViews: 3.2, rageClicks: 1.5, deadClicks: 0.4,
    engagedSessions: 9.9, conversions: 2.6, scrollDepthAvg: 55.5, conversionRate: 0.25,
  });
  assert.equal(rounded?.sessions, 13);
  assert.equal(rounded?.pageViews, 3);
  assert.equal(rounded?.rageClicks, 2);
  assert.equal(rounded?.deadClicks, 0);
  assert.equal(rounded?.engagedSessions, 10);
  assert.equal(rounded?.conversions, 3);
  assert.equal(rounded?.scrollDepthAvg, 55.5);
  assert.equal(rounded?.conversionRate, 0.25);

  const nonFinite = await upsertUxSnapshot({
    clientId: client.id, snapshotDate: '2026-01-05', sessions: Number.NaN, pageViews: Number.POSITIVE_INFINITY,
    scrollDepthAvg: Number.NEGATIVE_INFINITY, conversionRate: Number.NaN,
  });
  assert.equal(nonFinite?.sessions, 0);
  assert.equal(nonFinite?.pageViews, 0);
  assert.equal(nonFinite?.scrollDepthAvg, 0);
  assert.equal(nonFinite?.conversionRate, 0);
});

test('upsertUxSnapshot on an existing (client, date) updates in place and keeps id and createdAt', async () => {
  const { upsertUxSnapshot, listUxSnapshots } = await loadDatabase();
  const client = await makeClient('UX update');
  const first = await upsertUxSnapshot({ clientId: client.id, snapshotDate: '2026-01-06', sessions: 10, notes: 'first', source: 'manual', payloadJson: '{"a":1}' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await upsertUxSnapshot({ clientId: client.id, snapshotDate: '2026-01-06', sessions: 20, id: crypto.randomUUID() });

  assert.ok(first && second);
  assert.equal(second.id, first.id, 'a supplied id never replaces the stored one');
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.updatedAt > first.updatedAt);
  assert.equal(second.sessions, 20);
  assert.equal(second.notes, null, 'omitted optional fields are overwritten, not merged');
  assert.equal(second.source, 'clarity');
  assert.equal(second.payloadJson, '{}');
  assert.equal((await listUxSnapshots(client.id)).length, 1);
});

test('listUxSnapshots orders by snapshot date descending; the unscoped list spans clients', async () => {
  const { upsertUxSnapshot, listUxSnapshots, getLatestUxSnapshot } = await loadDatabase();
  const client = await makeClient('UX list');
  const other = await makeClient('UX list other');
  for (const date of ['2026-02-01', '2026-02-03', '2026-02-02']) await upsertUxSnapshot({ clientId: client.id, snapshotDate: date, sessions: 1 });
  await upsertUxSnapshot({ clientId: other.id, snapshotDate: '2026-02-09', sessions: 1 });

  assert.deepEqual((await listUxSnapshots(client.id)).map((snapshot) => snapshot.snapshotDate), ['2026-02-03', '2026-02-02', '2026-02-01']);
  assert.equal((await getLatestUxSnapshot(client.id))?.snapshotDate, '2026-02-03');
  assert.equal((await getLatestUxSnapshot(other.id))?.snapshotDate, '2026-02-09');
  assert.equal(await getLatestUxSnapshot(MISSING_ID), null);

  const all = await listUxSnapshots();
  assert.ok(all.some((snapshot) => snapshot.clientId === client.id));
  assert.ok(all.some((snapshot) => snapshot.clientId === other.id));
});

// ---------------------------------------------------------------- operational plans

test('getOperationalPlan returns a version 0 placeholder when nothing is stored', async () => {
  const { getOperationalPlan } = await loadDatabase();
  const client = await makeClient('Plan empty');
  assert.deepEqual(await getOperationalPlan(client.id, 'web', '2026-03'), {
    clientId: client.id, domain: 'web', periodKey: '2026-03', version: 0, rows: [], updatedAt: null,
  });
});

test('saveOperationalPlan creates version 1, then bumps the version only when the caller holds the current one', async () => {
  const { saveOperationalPlan, getOperationalPlan } = await loadDatabase();
  const client = await makeClient('Plan versions');
  const rows = [{ id: 'r1', text: `O'Brien "q" \\ ? $1 Ünï 日本語` }] as any[];

  const created = await saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-03', version: 0, rows });
  assert.ok(created);
  assert.equal(created.version, 1);
  assert.deepEqual(created.rows, rows);
  assert.ok(typeof created.updatedAt === 'string' && !Number.isNaN(Date.parse(created.updatedAt)));
  assert.deepEqual(await getOperationalPlan(client.id, 'web', '2026-03'), created);

  // Version 0 against an existing row is a conflict.
  assert.equal(await saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-03', version: 0, rows: [] }), null);
  // A stale version is rejected and leaves the row untouched.
  assert.equal(await saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-03', version: 5, rows: [] }), null);
  assert.deepEqual(await getOperationalPlan(client.id, 'web', '2026-03'), created);

  const bumped = await saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-03', version: 1, rows: [] });
  assert.equal(bumped?.version, 2);
  assert.deepEqual(bumped?.rows, []);
  assert.equal(await saveOperationalPlan({ clientId: client.id, domain: 'web', periodKey: '2026-03', version: 1, rows }), null);
});

test('saveOperationalPlan refuses a positive version for a plan that does not exist and keeps domains and periods apart', async () => {
  const { saveOperationalPlan, getOperationalPlan } = await loadDatabase();
  const client = await makeClient('Plan scope');
  assert.equal(await saveOperationalPlan({ clientId: client.id, domain: 'rrss', periodKey: '2026-04', version: 1, rows: [] }), null);
  assert.equal((await getOperationalPlan(client.id, 'rrss', '2026-04')).version, 0);

  await saveOperationalPlan({ clientId: client.id, domain: 'rrss', periodKey: '2026-04', version: 0, rows: [{ id: 'a' }] as any[] });
  assert.equal((await getOperationalPlan(client.id, 'web', '2026-04')).version, 0);
  assert.equal((await getOperationalPlan(client.id, 'rrss', '2026-05')).version, 0);
  assert.equal((await getOperationalPlan(client.id, 'rrss', '2026-04')).version, 1);
});

// ---------------------------------------------------------------- report runs

test('saveReportRun stores the PDF byte for byte and returns the run without the payload', async () => {
  const { saveReportRun, getReportRun, getReportRunPdf } = await loadDatabase();
  const client = await makeClient('Report save');
  const user = await makeUser();
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x27, 0x5c, 0x3f]);

  const run = await saveReportRun({ clientId: client.id, from: '2026-01-01', to: '2026-01-31', createdByUserId: user.id, pdf });
  assert.match(run.id, /^[0-9a-f-]{36}$/);
  assert.equal(run.clientId, client.id);
  assert.equal(run.from, '2026-01-01');
  assert.equal(run.to, '2026-01-31');
  assert.equal(run.createdByUserId, user.id);
  assert.equal(run.bytes, pdf.length);
  assert.ok(!Number.isNaN(Date.parse(run.generatedAt)));
  assert.equal(run.lastSentAt, null);
  assert.equal(run.lastSentTo, null);
  assert.equal(run.lastSendError, null);
  assert.deepEqual(Object.keys(run).sort(), ['bytes', 'clientId', 'createdByUserId', 'from', 'generatedAt', 'id', 'lastSendError', 'lastSentAt', 'lastSentTo', 'to']);

  assert.deepEqual(await getReportRun(client.id, run.id), run);
  const stored = await getReportRunPdf(client.id, run.id);
  assert.ok(Buffer.isBuffer(stored));
  assert.ok(stored.equals(pdf));
});

test('report run lookups are scoped to the owning client and return null when missing', async () => {
  const { saveReportRun, getReportRun, getReportRunPdf } = await loadDatabase();
  const client = await makeClient('Report scope');
  const other = await makeClient('Report scope other');
  const user = await makeUser();
  const run = await saveReportRun({ clientId: client.id, from: '2026-01-01', to: '2026-01-02', createdByUserId: user.id, pdf: Buffer.from('x') });

  assert.equal(await getReportRun(other.id, run.id), null);
  assert.equal(await getReportRunPdf(other.id, run.id), null);
  assert.equal(await getReportRun(client.id, MISSING_ID), null);
  assert.equal(await getReportRunPdf(client.id, MISSING_ID), null);
});

test('listReportRuns orders by generation time then id descending and honors limit and the before cursor', async () => {
  const { saveReportRun, listReportRuns } = await loadDatabase();
  const client = await makeClient('Report list');
  const other = await makeClient('Report list other');
  const user = await makeUser();
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await saveReportRun({ clientId: client.id, from: '2026-01-01', to: `2026-01-0${index + 1}`, createdByUserId: user.id, pdf: Buffer.from(`pdf${index}`) });
  }
  await saveReportRun({ clientId: other.id, from: '2026-01-01', to: '2026-01-09', createdByUserId: user.id, pdf: Buffer.from('other') });

  const all = await listReportRuns(client.id);
  assert.equal(all.length, 4);
  assert.ok(all.every((run) => run.clientId === client.id));
  const expected = [...all].sort((a, b) => (a.generatedAt === b.generatedAt ? (a.id < b.id ? 1 : -1) : a.generatedAt < b.generatedAt ? 1 : -1));
  assert.deepEqual(all.map((run) => run.id), expected.map((run) => run.id));

  assert.deepEqual((await listReportRuns(client.id, 2)).map((run) => run.id), all.slice(0, 2).map((run) => run.id));
  const cursor = { at: all[1].generatedAt, id: all[1].id };
  assert.deepEqual((await listReportRuns(client.id, 50, cursor)).map((run) => run.id), all.slice(2).map((run) => run.id));
  assert.deepEqual((await listReportRuns(client.id, 1, cursor)).map((run) => run.id), [all[2].id]);
  assert.deepEqual(await listReportRuns(MISSING_ID), []);
});

test('recordReportSend records the outcome for the owning client only and overwrites it on each send', async () => {
  const { saveReportRun, getReportRun, recordReportSend } = await loadDatabase();
  const client = await makeClient('Report send');
  const other = await makeClient('Report send other');
  const user = await makeUser();
  const run = await saveReportRun({ clientId: client.id, from: '2026-01-01', to: '2026-01-02', createdByUserId: user.id, pdf: Buffer.from('x') });

  await recordReportSend(other.id, run.id, 'nobody@example.test', null);
  assert.equal((await getReportRun(client.id, run.id))?.lastSentAt, null);

  await recordReportSend(client.id, run.id, `o'brien@example.test`, 'Entrega no confirmada');
  const failed = await getReportRun(client.id, run.id);
  assert.equal(failed?.lastSentTo, `o'brien@example.test`);
  assert.equal(failed?.lastSendError, 'Entrega no confirmada');
  assert.ok(failed?.lastSentAt && !Number.isNaN(Date.parse(failed.lastSentAt)));

  await recordReportSend(client.id, run.id, 'ok@example.test', null);
  const sent = await getReportRun(client.id, run.id);
  assert.equal(sent?.lastSentTo, 'ok@example.test');
  assert.equal(sent?.lastSendError, null);
  assert.equal(sent?.bytes, run.bytes);
});

// ---------------------------------------------------------------- RRSS channels

test('saveRrssChannel returns null for an unknown client', async () => {
  const { saveRrssChannel, listRrssChannels } = await loadDatabase();
  assert.equal(await saveRrssChannel({ clientId: MISSING_ID, platformKey: 'instagram', label: 'IG' }), null);
  assert.equal(await saveRrssChannel({ clientId: '', id: crypto.randomUUID(), platformKey: 'instagram', label: 'IG' }), null);
  assert.deepEqual(await listRrssChannels(MISSING_ID), []);
});

test('saveRrssChannel creates with trimmed values and defaults, and an identical key updates the same row', async () => {
  const { saveRrssChannel, listRrssChannels } = await loadDatabase();
  const client = await makeClient('RRSS save');
  const created = await saveRrssChannel({ clientId: client.id, platformKey: ' instagram ', label: ' Mi "IG" ' });

  assert.ok(created);
  assert.equal(created.clientId, client.id);
  assert.equal(created.platformKey, 'instagram');
  assert.equal(created.label, 'Mi "IG"');
  assert.equal(created.isActive, true);
  assert.equal(created.sortOrder, 0);
  assert.equal(created.createdAt, created.updatedAt);
  assert.deepEqual(Object.keys(created).sort(), ['clientId', 'createdAt', 'id', 'isActive', 'label', 'platformKey', 'sortOrder', 'updatedAt']);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await saveRrssChannel({ clientId: client.id, platformKey: 'instagram', label: 'Mi "IG"', isActive: false, sortOrder: 4 });
  assert.equal(updated?.id, created.id);
  assert.equal(updated?.isActive, false);
  assert.equal(updated?.sortOrder, 4);
  assert.equal(updated?.createdAt, created.createdAt);
  assert.ok(updated && updated.updatedAt > created.updatedAt);
  assert.equal((await listRrssChannels(client.id)).length, 1);
});

test('saveRrssChannel rounds a fractional sort order and maps NaN to 0', async () => {
  const { saveRrssChannel } = await loadDatabase();
  const client = await makeClient('RRSS sort');
  assert.equal((await saveRrssChannel({ clientId: client.id, platformKey: 'a', label: 'A', sortOrder: 2.7 }))?.sortOrder, 3);
  assert.equal((await saveRrssChannel({ clientId: client.id, platformKey: 'b', label: 'B', sortOrder: Number.NaN }))?.sortOrder, 0);
  assert.equal((await saveRrssChannel({ clientId: client.id, platformKey: 'c', label: 'C', sortOrder: Number.POSITIVE_INFINITY }))?.sortOrder, 0);
});

test('saveRrssChannel by id updates that row, and an unknown id inserts with the given id', async () => {
  const { saveRrssChannel, listRrssChannels } = await loadDatabase();
  const client = await makeClient('RRSS id');
  const created = await saveRrssChannel({ clientId: client.id, platformKey: 'facebook', label: 'FB' });
  assert.ok(created);

  const renamed = await saveRrssChannel({ id: created.id, clientId: client.id, platformKey: ' tiktok ', label: ' TT ', sortOrder: 2 });
  assert.equal(renamed?.id, created.id);
  assert.equal(renamed?.platformKey, 'tiktok');
  assert.equal(renamed?.label, 'TT');
  assert.equal(renamed?.sortOrder, 2);

  const fresh = crypto.randomUUID();
  const inserted = await saveRrssChannel({ id: fresh, clientId: client.id, platformKey: 'linkedin', label: 'LI' });
  assert.equal(inserted?.id, fresh);
  assert.equal((await listRrssChannels(client.id)).length, 2);
});

test('saveRrssChannel surfaces the unique violation when a rename collides with another channel', async () => {
  const { saveRrssChannel } = await loadDatabase();
  const client = await makeClient('RRSS collide');
  await saveRrssChannel({ clientId: client.id, platformKey: 'x', label: 'One' });
  const second = await saveRrssChannel({ clientId: client.id, platformKey: 'x', label: 'Two' });
  assert.ok(second);
  await assert.rejects(
    saveRrssChannel({ id: second.id, clientId: client.id, platformKey: 'x', label: 'One' }),
    /duplicate key/i,
  );
});

test('listRrssChannels orders by sort order then creation time and is scoped to the client', async () => {
  const { saveRrssChannel, listRrssChannels } = await loadDatabase();
  const client = await makeClient('RRSS list');
  const other = await makeClient('RRSS list other');
  await saveRrssChannel({ clientId: client.id, platformKey: 'p', label: 'Third', sortOrder: 5 });
  await saveRrssChannel({ clientId: client.id, platformKey: 'p', label: 'First', sortOrder: 1 });
  await saveRrssChannel({ clientId: client.id, platformKey: 'p', label: 'Second', sortOrder: 1 });
  await saveRrssChannel({ clientId: other.id, platformKey: 'p', label: 'Elsewhere', sortOrder: 0 });

  const labels = (await listRrssChannels(client.id)).map((channel) => channel.label);
  assert.equal(labels[2], 'Third');
  assert.deepEqual([...labels.slice(0, 2)].sort(), ['First', 'Second']);
  assert.equal(labels.length, 3);
});
