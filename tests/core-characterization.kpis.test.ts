import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Characterization tests for the monthly KPI functions of the core data layer (src/lib/database.ts): saves, manual
// close/reopen, cycle close/reopen, scheduler catch-up and the audit events. They pin the behavior the psql shim had so
// the move to the pg pool does not silently change observable results. Every call is awaited so the same file runs
// against sync and async versions.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

async function makeClient(label: string) {
  const { createClient } = await loadDatabase();
  return await createClient({ name: `${label} ${unique()}` });
}

async function saveKpi(clientId: string, monthKey: string, departmentKey: 'publicidad' | 'web' | 'rrss', metricKey: string, extra: Record<string, unknown> = {}) {
  const { saveMonthlyKpi } = await loadDatabase();
  const kpi = await saveMonthlyKpi({ clientId, departmentKey, metricKey, monthKey, ...extra });
  assert.ok(kpi);
  return kpi;
}

// ---------------------------------------------------------------- list / get / save

test('listMonthlyKpis orders by month desc, department asc, metric asc and filters by month', async () => {
  const { listMonthlyKpis } = await loadDatabase();
  const client = await makeClient('KPI order');
  await saveKpi(client.id, '2026-01', 'web', 'sessions');
  await saveKpi(client.id, '2026-02', 'web', 'sessions');
  await saveKpi(client.id, '2026-02', 'publicidad', 'roas');
  await saveKpi(client.id, '2026-02', 'publicidad', 'clicks');

  assert.deepEqual(
    (await listMonthlyKpis(client.id)).map((kpi) => `${kpi.monthKey}/${kpi.departmentKey}/${kpi.metricKey}`),
    ['2026-02/publicidad/clicks', '2026-02/publicidad/roas', '2026-02/web/sessions', '2026-01/web/sessions'],
  );
  assert.deepEqual(
    (await listMonthlyKpis(client.id, '2026-02')).map((kpi) => `${kpi.departmentKey}/${kpi.metricKey}`),
    ['publicidad/clicks', 'publicidad/roas', 'web/sessions'],
  );
  assert.deepEqual(await listMonthlyKpis(client.id, '2030-01'), []);
  assert.deepEqual(await listMonthlyKpis(MISSING_ID), []);
});

test('getMonthlyKpiById returns the record or null', async () => {
  const { getMonthlyKpiById } = await loadDatabase();
  const client = await makeClient('KPI get');
  const kpi = await saveKpi(client.id, '2026-03', 'web', 'sessions');
  assert.deepEqual(await getMonthlyKpiById(kpi.id), kpi);
  assert.equal(await getMonthlyKpiById(MISSING_ID), null);
});

test('saveMonthlyKpi returns null for an unknown client and rejects an invalid month', async () => {
  const { saveMonthlyKpi, listMonthlyKpis } = await loadDatabase();
  assert.equal(await saveMonthlyKpi({ clientId: MISSING_ID, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-03' }), null);

  const client = await makeClient('KPI month');
  await assert.rejects(async () => saveMonthlyKpi({ clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-13' }), /Mes inv/);
  assert.deepEqual(await listMonthlyKpis(client.id), []);
});

test('saveMonthlyKpi applies defaults, trims keys and stores the full record shape', async () => {
  const client = await makeClient('KPI defaults');
  const kpi = await saveKpi(client.id, '2026-03', 'web', '  sessions  ');

  assert.equal(kpi.metricKey, 'sessions');
  assert.equal(kpi.status, 'unknown');
  assert.equal(kpi.targetValue, null);
  assert.equal(kpi.targetText, null);
  assert.equal(kpi.actualValue, null);
  assert.equal(kpi.actualText, null);
  assert.equal(kpi.differenceValue, null);
  assert.equal(kpi.differencePct, null);
  assert.equal(kpi.notes, null);
  assert.equal(kpi.closedAt, null);
  assert.equal(kpi.createdByUserId, null);
  assert.equal(kpi.updatedByUserId, null);
  assert.equal(kpi.createdAt, kpi.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(kpi.createdAt)));
  assert.deepEqual(Object.keys(kpi).sort(), [
    'actualText', 'actualValue', 'clientId', 'closedAt', 'createdAt', 'createdByUserId', 'departmentKey', 'differencePct',
    'differenceValue', 'id', 'metricKey', 'monthKey', 'notes', 'status', 'targetText', 'targetValue', 'updatedAt', 'updatedByUserId',
  ]);
});

test('saveMonthlyKpi round-trips numbers and stores non-finite numbers as null', async () => {
  const client = await makeClient('KPI numbers');
  const kpi = await saveKpi(client.id, '2026-03', 'publicidad', 'roas', {
    targetValue: 1000.5, actualValue: 12.25, differenceValue: -3.5, differencePct: 0.5, status: 'warning', notes: 'nota',
    targetText: 'objetivo', actualText: 'real',
  });
  assert.equal(kpi.targetValue, 1000.5);
  assert.equal(kpi.actualValue, 12.25);
  assert.equal(kpi.differenceValue, -3.5);
  assert.equal(kpi.differencePct, 0.5);
  assert.equal(kpi.status, 'warning');
  assert.equal(kpi.notes, 'nota');
  assert.equal(kpi.targetText, 'objetivo');
  assert.equal(kpi.actualText, 'real');

  const nonFinite = await saveKpi(client.id, '2026-03', 'publicidad', 'cpa', {
    targetValue: Number.NaN, actualValue: Number.POSITIVE_INFINITY, differenceValue: Number.NEGATIVE_INFINITY,
  });
  assert.equal(nonFinite.targetValue, null);
  assert.equal(nonFinite.actualValue, null);
  assert.equal(nonFinite.differenceValue, null);
});

test('saveMonthlyKpi updates by natural key keeping id and createdAt, and by id keeping the stored status', async () => {
  const { saveMonthlyKpi, listMonthlyKpis } = await loadDatabase();
  const client = await makeClient('KPI update');
  const first = await saveKpi(client.id, '2026-03', 'web', 'sessions', { status: 'fail', actualValue: 1 });

  const second = await saveKpi(client.id, '2026-03', 'web', 'sessions', { actualValue: 2 });
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.status, 'fail', 'an omitted status keeps the stored one');
  assert.equal(second.actualValue, 2);
  assert.equal(second.targetValue, null, 'omitted values are reset to null');

  const third = await saveMonthlyKpi({ id: first.id, clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-03', status: 'success', notes: 'x' });
  assert.equal(third?.id, first.id);
  assert.equal(third?.status, 'success');
  assert.equal(third?.notes, 'x');
  assert.equal((await listMonthlyKpis(client.id)).length, 1);
});

test('saveMonthlyKpi rejects an id that belongs to another client', async () => {
  const { saveMonthlyKpi } = await loadDatabase();
  const owner = await makeClient('KPI owner');
  const other = await makeClient('KPI other');
  const kpi = await saveKpi(owner.id, '2026-03', 'web', 'sessions');
  await assert.rejects(
    async () => saveMonthlyKpi({ id: kpi.id, clientId: other.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-03' }),
    /no pertenece a este cliente/,
  );
});

test('saveMonthlyKpi refuses to write into a closed month and into a closed KPI', async () => {
  const { saveMonthlyKpi, closeMonthlyKpi, closeMonthlyKpiCycle } = await loadDatabase();
  const client = await makeClient('KPI closed');
  const kpi = await saveKpi(client.id, '2026-03', 'web', 'sessions');
  const other = await saveKpi(client.id, '2026-04', 'web', 'sessions');

  await closeMonthlyKpi(kpi.id);
  await assert.rejects(
    async () => saveMonthlyKpi({ id: kpi.id, clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-03' }),
    /El KPI está cerrado/,
  );
  assert.ok(await closeMonthlyKpiCycle(client.id, '2026-04', 'actor', new Date('2026-04-26T10:00:00.000Z')));
  await assert.rejects(
    async () => saveMonthlyKpi({ clientId: client.id, departmentKey: 'rrss', metricKey: 'followers', monthKey: '2026-04' }),
    /El mes está cerrado/,
  );
  await assert.rejects(
    async () => saveMonthlyKpi({ id: other.id, clientId: client.id, departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-04' }),
    /El mes está cerrado/,
  );
});

// ---------------------------------------------------------------- manual close / reopen

test('closeMonthlyKpi returns null for unknown ids and writes one closed event with a snapshot', async () => {
  const { closeMonthlyKpi, listMonthlyKpiEvents } = await loadDatabase();
  assert.equal(await closeMonthlyKpi(MISSING_ID), null);

  const client = await makeClient('KPI close');
  const kpi = await saveKpi(client.id, '2026-03', 'web', 'sessions', { actualValue: 7.5 });
  const closed = await closeMonthlyKpi(kpi.id, '2026-03-31T22:00:00.000Z', 'actor-1');
  assert.equal(closed?.closedAt, '2026-03-31T22:00:00.000Z');
  assert.equal(closed?.actualValue, 7.5);

  const again = await closeMonthlyKpi(kpi.id, '2030-01-01T00:00:00.000Z', 'actor-2');
  assert.equal(again?.closedAt, '2026-03-31T22:00:00.000Z');

  const events = await listMonthlyKpiEvents(kpi.id);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['action', 'actor_user_id', 'client_id', 'id', 'kpi_id', 'month_key', 'occurred_at', 'reason', 'snapshot_json']);
  assert.equal(events[0].action, 'closed');
  assert.equal(events[0].actor_user_id, 'actor-1');
  assert.equal(events[0].reason, null);
  assert.equal(events[0].kpi_id, kpi.id);
  assert.equal(events[0].client_id, client.id);
  assert.equal(events[0].month_key, '2026-03');
  const snapshot = JSON.parse(String(events[0].snapshot_json));
  assert.equal(snapshot.id, kpi.id);
  assert.equal(snapshot.closed_at, '2026-03-31T22:00:00.000Z');
  assert.equal(snapshot.actual_value, 7.5);
});

test('reopenMonthlyKpi validates the reason, the id and the state, and trims the stored reason', async () => {
  const { closeMonthlyKpi, reopenMonthlyKpi, listMonthlyKpiEvents } = await loadDatabase();
  const client = await makeClient('KPI reopen');
  const kpi = await saveKpi(client.id, '2026-03', 'web', 'sessions');

  await assert.rejects(async () => reopenMonthlyKpi(kpi.id, 'admin', '   '), /motivo de hasta 500 caracteres/);
  await assert.rejects(async () => reopenMonthlyKpi(kpi.id, 'admin', 'x'.repeat(501)), /motivo de hasta 500 caracteres/);
  assert.equal(await reopenMonthlyKpi(MISSING_ID, 'admin', 'motivo'), null);
  await assert.rejects(async () => reopenMonthlyKpi(kpi.id, 'admin', 'motivo'), /El KPI ya está abierto/);

  await closeMonthlyKpi(kpi.id, '2026-03-31T22:00:00.000Z', 'actor-1');
  const reopened = await reopenMonthlyKpi(kpi.id, 'admin-1', '  Corrección  ');
  assert.equal(reopened?.closedAt, null);

  const events = await listMonthlyKpiEvents(kpi.id);
  const event = events.find((candidate) => candidate.action === 'reopened');
  assert.ok(event);
  assert.equal(event.reason, 'Corrección');
  assert.equal(event.actor_user_id, 'admin-1');
  assert.equal(JSON.parse(String(event.snapshot_json)).closed_at, null);
  await assert.rejects(async () => reopenMonthlyKpi(kpi.id, 'admin', 'otra vez'), /El KPI ya está abierto/);
});

// ---------------------------------------------------------------- cycles

test('closeMonthlyKpiCycle returns null for an unknown client or a month without KPIs', async () => {
  const { closeMonthlyKpiCycle } = await loadDatabase();
  assert.equal(await closeMonthlyKpiCycle(MISSING_ID, '2026-03', 'actor'), null);
  const client = await makeClient('KPI empty cycle');
  assert.equal(await closeMonthlyKpiCycle(client.id, '2026-03', 'actor'), null);
});

test('closeMonthlyKpiCycle closes every KPI of the month, audits each, prepares next month and is idempotent', async () => {
  const { closeMonthlyKpiCycle, listMonthlyKpis, listMonthlyKpiEvents, listMonthlyKpiCycles } = await loadDatabase();
  const client = await makeClient('KPI cycle');
  const a = await saveKpi(client.id, '2026-03', 'web', 'sessions', { targetValue: 100.5, actualValue: 90, status: 'warning', notes: 'n', targetText: 't' });
  const b = await saveKpi(client.id, '2026-03', 'rrss', 'followers', { targetValue: 50 });
  const existingNext = await saveKpi(client.id, '2026-04', 'rrss', 'followers', { actualValue: 5, targetValue: 1 });

  const cycle = await closeMonthlyKpiCycle(client.id, '2026-03', 'actor-1', new Date('2026-03-26T10:00:00.000Z'));
  assert.deepEqual(cycle, {
    clientId: client.id, monthKey: '2026-03', closedAt: '2026-03-26T10:00:00.000Z', closedByUserId: 'actor-1',
    reopenedAt: null, reopenedByUserId: null, reopenReason: null,
  });

  const march = await listMonthlyKpis(client.id, '2026-03');
  assert.equal(march.length, 2);
  for (const kpi of march) {
    assert.equal(kpi.closedAt, '2026-03-26T10:00:00.000Z');
    assert.equal(kpi.updatedAt, '2026-03-26T10:00:00.000Z');
  }
  for (const kpi of [a, b]) {
    const events = await listMonthlyKpiEvents(kpi.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'closed');
    assert.equal(events[0].actor_user_id, 'actor-1');
    assert.equal(events[0].occurred_at, '2026-03-26T10:00:00.000Z');
  }

  const april = await listMonthlyKpis(client.id, '2026-04');
  assert.equal(april.length, 2);
  const preparedWeb = april.find((kpi) => kpi.metricKey === 'sessions');
  assert.ok(preparedWeb);
  assert.equal(preparedWeb.departmentKey, 'web');
  assert.equal(preparedWeb.targetValue, 100.5);
  assert.equal(preparedWeb.targetText, 't');
  assert.equal(preparedWeb.actualValue, null);
  assert.equal(preparedWeb.status, 'unknown');
  assert.equal(preparedWeb.notes, null);
  assert.equal(preparedWeb.closedAt, null);
  assert.equal(preparedWeb.createdByUserId, null);
  assert.equal(preparedWeb.createdAt, '2026-03-26T10:00:00.000Z');
  assert.notEqual(preparedWeb.id, a.id);
  const untouched = april.find((kpi) => kpi.metricKey === 'followers');
  assert.equal(untouched?.id, existingNext.id, 'an existing next-month KPI is never overwritten');
  assert.equal(untouched?.actualValue, 5);
  assert.equal(untouched?.targetValue, 1);

  const repeated = await closeMonthlyKpiCycle(client.id, '2026-03', 'actor-2', new Date('2026-03-30T10:00:00.000Z'));
  assert.deepEqual(repeated, cycle, 'closing a closed cycle keeps the original close');
  assert.equal((await listMonthlyKpiEvents(a.id)).length, 1);
  assert.equal((await listMonthlyKpis(client.id, '2026-04')).length, 2);
  assert.equal((await listMonthlyKpiCycles(client.id)).length, 1);
});

test('listMonthlyKpiCycles orders by month desc and is empty for unknown clients', async () => {
  const { closeMonthlyKpiCycle, listMonthlyKpiCycles } = await loadDatabase();
  assert.deepEqual(await listMonthlyKpiCycles(MISSING_ID), []);
  const client = await makeClient('KPI cycle list');
  await saveKpi(client.id, '2026-01', 'web', 'sessions');
  await saveKpi(client.id, '2026-05', 'web', 'sessions');
  await closeMonthlyKpiCycle(client.id, '2026-01', 'actor', new Date('2026-01-26T10:00:00.000Z'));
  await closeMonthlyKpiCycle(client.id, '2026-05', 'actor', new Date('2026-05-26T10:00:00.000Z'));
  assert.deepEqual((await listMonthlyKpiCycles(client.id)).map((cycle) => cycle.monthKey), ['2026-05', '2026-01']);
});

test('reopenMonthlyKpiCycle validates, reopens every KPI with audit events and allows closing again', async () => {
  const { closeMonthlyKpiCycle, reopenMonthlyKpiCycle, listMonthlyKpis, listMonthlyKpiEvents } = await loadDatabase();
  const client = await makeClient('KPI cycle reopen');
  const kpi = await saveKpi(client.id, '2020-03', 'web', 'sessions');

  await assert.rejects(async () => reopenMonthlyKpiCycle(client.id, '2020-03', 'admin', ' '), /motivo de hasta 500 caracteres/);
  await assert.rejects(async () => reopenMonthlyKpiCycle(client.id, '2020-03', 'admin', 'x'.repeat(501)), /motivo de hasta 500 caracteres/);
  assert.equal(await reopenMonthlyKpiCycle(client.id, '2020-03', 'admin', 'motivo'), null, 'nothing closed yet and no cycle row');

  await closeMonthlyKpiCycle(client.id, '2020-03', 'actor-1', new Date('2020-03-26T10:00:00.000Z'));
  const reopened = await reopenMonthlyKpiCycle(client.id, '2020-03', 'admin-1', '  Corrección  ');
  assert.ok(reopened);
  assert.equal(reopened.closedAt, null);
  assert.equal(reopened.closedByUserId, null);
  assert.equal(reopened.reopenedByUserId, 'admin-1');
  assert.equal(reopened.reopenReason, 'Corrección');
  assert.ok(reopened.reopenedAt && !Number.isNaN(Date.parse(reopened.reopenedAt)));
  assert.equal((await listMonthlyKpis(client.id, '2020-03'))[0]?.closedAt, null);

  await assert.rejects(async () => reopenMonthlyKpiCycle(client.id, '2020-03', 'admin-1', 'otra vez'), /El ciclo ya está abierto/);

  const events = await listMonthlyKpiEvents(kpi.id);
  assert.deepEqual(events.map((event) => event.action), ['reopened', 'closed'], 'newest event first');
  assert.equal(events[0].reason, 'Corrección');
  assert.equal(events[0].actor_user_id, 'admin-1');

  const reclosed = await closeMonthlyKpiCycle(client.id, '2020-03', 'actor-2', new Date('2020-04-02T10:00:00.000Z'));
  assert.equal(reclosed?.closedAt, '2020-04-02T10:00:00.000Z');
  assert.equal(reclosed?.closedByUserId, 'actor-2');
  assert.equal(reclosed?.reopenedAt, null);
  assert.equal(reclosed?.reopenReason, null);
  assert.deepEqual((await listMonthlyKpiEvents(kpi.id)).map((event) => event.action).sort(), ['closed', 'closed', 'reopened']);
});

test('reopenMonthlyKpiCycle also reopens a month whose KPIs were closed manually without a cycle row', async () => {
  const { closeMonthlyKpi, reopenMonthlyKpiCycle, listMonthlyKpis, listMonthlyKpiCycles, listMonthlyKpiEvents } = await loadDatabase();
  const client = await makeClient('KPI legacy reopen');
  const kpi = await saveKpi(client.id, '2026-03', 'web', 'sessions');
  await closeMonthlyKpi(kpi.id, '2026-03-31T22:00:00.000Z', 'actor-1');
  assert.deepEqual(await listMonthlyKpiCycles(client.id), []);

  const cycle = await reopenMonthlyKpiCycle(client.id, '2026-03', 'admin-1', 'Legado');
  assert.equal(cycle?.closedAt, null);
  assert.equal(cycle?.reopenedByUserId, 'admin-1');
  assert.equal(cycle?.reopenReason, 'Legado');
  assert.equal((await listMonthlyKpis(client.id, '2026-03'))[0]?.closedAt, null);
  assert.deepEqual((await listMonthlyKpiEvents(kpi.id)).map((event) => event.action).sort(), ['closed', 'reopened']);
});

// ---------------------------------------------------------------- scheduler catch-up

test('closeDueMonthlyKpiCycles closes at most 10 months per call and reports whether more are pending', async () => {
  const { closeDueMonthlyKpiCycles, listMonthlyKpis } = await loadDatabase();
  const client = await makeClient('KPI due');
  for (let month = 1; month <= 11; month += 1) {
    await saveKpi(client.id, `2025-${String(month).padStart(2, '0')}`, 'web', 'sessions');
  }
  const now = new Date('2026-09-25T10:00:00.000Z');

  const first = await closeDueMonthlyKpiCycles(now, client.id);
  assert.deepEqual(first, { dueMonth: '2026-09', closed: 10, pending: true });
  assert.equal((await listMonthlyKpis(client.id, '2025-10'))[0]?.closedAt, now.toISOString());
  assert.equal((await listMonthlyKpis(client.id, '2025-11'))[0]?.closedAt, null);

  const second = await closeDueMonthlyKpiCycles(now, client.id);
  assert.deepEqual(second, { dueMonth: '2026-09', closed: 10, pending: true });
  const third = await closeDueMonthlyKpiCycles(now, client.id);
  assert.deepEqual(third, { dueMonth: '2026-09', closed: 1, pending: false });
  assert.deepEqual(await closeDueMonthlyKpiCycles(now, client.id), { dueMonth: '2026-09', closed: 0, pending: false });
  assert.equal((await listMonthlyKpis(client.id, '2026-10')).length, 1, 'the month after the due one is prepared but not closed');
  assert.equal((await listMonthlyKpis(client.id, '2026-10'))[0]?.closedAt, null);
});

test('closeDueMonthlyKpiCycles only touches the requested client', async () => {
  const { closeDueMonthlyKpiCycles, listMonthlyKpis } = await loadDatabase();
  const mine = await makeClient('KPI due mine');
  const other = await makeClient('KPI due other');
  await saveKpi(mine.id, '2026-06', 'web', 'sessions');
  await saveKpi(other.id, '2026-06', 'web', 'sessions');
  const result = await closeDueMonthlyKpiCycles(new Date('2026-09-25T10:00:00.000Z'), mine.id);
  assert.ok(result.closed >= 1);
  assert.ok((await listMonthlyKpis(mine.id, '2026-06'))[0]?.closedAt);
  assert.equal((await listMonthlyKpis(other.id, '2026-06'))[0]?.closedAt, null);
});
