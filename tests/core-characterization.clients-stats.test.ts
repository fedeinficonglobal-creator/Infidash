import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Characterization tests for the core data layer (src/lib/database.ts): clients, daily stats,
// dashboard aggregates and SQL-literal edge cases. They pin CURRENT behavior so the psql shim can be
// replaced by a pg pool without silently changing observable results. Do not "fix" assertions here
// unless the production behavior is changed on purpose.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

// Strings that stress the manual SQL-literal inlining (quotes, backslashes, comments, placeholders, unicode).
const NASTY_NAME = `O'Brien "Quoted" back\\slash \\' end -- not a comment; DROP TABLE clients; /* c */ ?@name $1 $& $$ :notavar Ünï 日本語 🚀`;

async function makeClient(label: string, extra: Record<string, unknown> = {}) {
  const { createClient } = await loadDatabase();
  return await createClient({ name: `${label} ${unique()}`, ...extra });
}

// ---------------------------------------------------------------- clients

test('createClient trims the name, builds an accent-free slug with an 8-hex suffix and applies defaults', async () => {
  const { createClient, listClients } = await loadDatabase();
  const tag = `char${unique()}`.toLowerCase();
  const created = await createClient({ name: `  Café Ñandú ${tag}  ` });

  assert.equal(created.name, `Café Ñandú ${tag}`);
  assert.match(created.slug, new RegExp(`^cafe-nandu-${tag}-[0-9a-f]{8}$`));
  assert.equal(created.logoUrl, null);
  assert.equal(created.industry, null);
  assert.equal(created.healthScore, 80);
  assert.deepEqual(created.kpiThresholds, { revenue: 10000, roas: 4, conversions: 100, cpa: 15 });
  assert.equal(created.createdAt, created.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
  assert.deepEqual(Object.keys(created).sort(), [
    'createdAt', 'healthScore', 'id', 'industry', 'kpiThresholds', 'logoUrl', 'name', 'slug', 'updatedAt',
  ]);

  // The value returned by createClient equals what is read back for a plain input.
  const [stored] = await listClients({ clientIds: [created.id] });
  assert.deepEqual(stored, created);
});

test('createClient falls back to the "client" slug base when the name has no alphanumerics', async () => {
  const { createClient } = await loadDatabase();
  const created = await createClient({ name: '!!! ???' });
  assert.match(created.slug, /^client-[0-9a-f]{8}$/);
});

test('createClient clamps healthScore to 0..100 and uses 80 for non-finite values', async () => {
  const { createClient, listClients } = await loadDatabase();
  const cases: Array<[number | undefined, number]> = [
    [150, 100], [-5, 0], [0, 0], [42, 42], [Number.NaN, 80], [Number.POSITIVE_INFINITY, 80], [undefined, 80],
  ];
  for (const [input, expected] of cases) {
    const created = await createClient({ name: `Health ${unique()}`, healthScore: input });
    assert.equal(created.healthScore, expected, `healthScore ${String(input)}`);
    assert.equal((await listClients({ clientIds: [created.id] }))[0]?.healthScore, expected);
  }
});

test('createClient returns the unrounded in-memory healthScore while the INTEGER column stores the rounded value', async () => {
  const { createClient, listClients } = await loadDatabase();
  // KNOWN BUG: the value returned by createClient (55.5) differs from what is persisted and listed (56),
  // because the result is built from the input record rather than re-read from PostgreSQL.
  const created = await createClient({ name: `Fractional ${unique()}`, healthScore: 55.5 });
  assert.equal(created.healthScore, 55.5);
  assert.equal((await listClients({ clientIds: [created.id] }))[0]?.healthScore, 56);
});

test('createClient merges partial kpiThresholds over the defaults and persists them as JSON', async () => {
  const { listClients } = await loadDatabase();
  const client = await makeClient('Thresholds', { kpiThresholds: { revenue: 500, cpa: 7.5 } });
  assert.deepEqual(client.kpiThresholds, { revenue: 500, roas: 4, conversions: 100, cpa: 7.5 });
  assert.deepEqual((await listClients({ clientIds: [client.id] }))[0]?.kpiThresholds, client.kpiThresholds);
});

test('listClients orders by name ascending and honours the clientIds scope', async () => {
  const { createClient, listClients } = await loadDatabase();
  const tag = `ord${unique()}`;
  const charlie = await createClient({ name: `${tag}-charlie` });
  const alpha = await createClient({ name: `${tag}-alpha` });
  const bravo = await createClient({ name: `${tag}-bravo` });
  const other = await createClient({ name: `${tag}-zulu-unscoped` });

  const scoped = await listClients({ clientIds: [charlie.id, alpha.id, bravo.id] });
  assert.deepEqual(scoped.map((client) => client.id), [alpha.id, bravo.id, charlie.id]);

  // clientIds === null or undefined means "no scope": every client is returned.
  for (const options of [undefined, {}, { clientIds: null }]) {
    const everything = await listClients(options);
    assert.ok(everything.some((client) => client.id === other.id));
    assert.ok(everything.some((client) => client.id === alpha.id));
  }

  // An empty scope returns nothing (the IN clause becomes `(NULL)`).
  assert.deepEqual(await listClients({ clientIds: [] }), []);
  // Unknown ids are ignored.
  assert.deepEqual(await listClients({ clientIds: [MISSING_ID] }), []);
});

test('listClients treats scope ids as data, never as SQL', async () => {
  const { listClients } = await loadDatabase();
  const client = await makeClient('Scope injection');
  assert.deepEqual(await listClients({ clientIds: [`x') OR 1=1 --`] }), []);
  assert.deepEqual((await listClients({ clientIds: [`x'`, client.id] })).map((row) => row.id), [client.id]);
});

test('getClientBySlug, getClientByIdRecord and getClientByIdOrSlug resolve clients and return null for unknown values', async () => {
  const { getClientByIdOrSlug, getClientByIdRecord, getClientBySlug } = await loadDatabase();
  const client = await makeClient('Lookup');

  assert.deepEqual(await getClientBySlug(client.slug), client);
  assert.deepEqual(await getClientByIdRecord(client.id), client);
  assert.deepEqual(await getClientByIdOrSlug(client.id), client);
  assert.deepEqual(await getClientByIdOrSlug(client.slug), client);
  assert.equal(await getClientBySlug(client.id), null);
  assert.equal(await getClientBySlug('missing-slug'), null);
  assert.equal(await getClientByIdRecord('missing-id'), null);
  assert.equal(await getClientByIdOrSlug('missing'), null);
  assert.equal(await getClientBySlug(`x' OR '1'='1`), null);
});

test('updateClient keeps unspecified fields, regenerates the slug only when the name changes and re-reads from the database', async () => {
  const { updateClient } = await loadDatabase();
  const client = await makeClient('Update', { industry: 'Retail', logoUrl: 'https://logo.test/a.png', healthScore: 70 });

  assert.equal(await updateClient(MISSING_ID, { name: 'Nope' }), null);

  const untouched = await updateClient(client.id, {});
  assert.ok(untouched);
  assert.equal(untouched.name, client.name);
  assert.equal(untouched.slug, client.slug);
  assert.equal(untouched.industry, 'Retail');
  assert.equal(untouched.logoUrl, 'https://logo.test/a.png');
  assert.equal(untouched.healthScore, 70);
  assert.ok(untouched.updatedAt >= client.updatedAt);
  assert.equal(untouched.createdAt, client.createdAt);

  // A blank or whitespace-only name is ignored; the same trimmed name keeps the slug.
  assert.equal((await updateClient(client.id, { name: '   ' }))?.slug, client.slug);
  assert.equal((await updateClient(client.id, { name: `  ${client.name}  ` }))?.slug, client.slug);

  const renamed = await updateClient(client.id, { name: `Renombrado ${unique()}` });
  assert.ok(renamed);
  assert.notEqual(renamed.slug, client.slug);
  assert.match(renamed.slug, /^renombrado-[a-z0-9]+-[0-9a-f]{8}$/);

  // Fractional scores are persisted rounded because updateClient returns a fresh read.
  assert.equal((await updateClient(client.id, { healthScore: 55.5 }))?.healthScore, 56);
  assert.equal((await updateClient(client.id, { healthScore: 500 }))?.healthScore, 100);
  // A non-finite score keeps the stored one (100 after the previous call).
  assert.equal((await updateClient(client.id, { healthScore: Number.NaN }))?.healthScore, 100);
});

test('updateClient distinguishes undefined (keep), null (clear) and empty string (stored as empty string)', async () => {
  const { updateClient } = await loadDatabase();
  const client = await makeClient('Nullable', { industry: 'Retail', logoUrl: 'https://logo.test/b.png' });

  assert.equal((await updateClient(client.id, { industry: undefined, logoUrl: undefined }))?.industry, 'Retail');
  const cleared = await updateClient(client.id, { industry: null, logoUrl: null });
  assert.equal(cleared?.industry, null);
  assert.equal(cleared?.logoUrl, null);

  const empty = await updateClient(client.id, { industry: '', logoUrl: '' });
  assert.equal(empty?.industry, '');
  assert.equal(empty?.logoUrl, '');
});

test('updateClient merges kpiThresholds onto the stored ones', async () => {
  const { updateClient } = await loadDatabase();
  const client = await makeClient('Merge thresholds', { kpiThresholds: { revenue: 500 } });
  const merged = await updateClient(client.id, { kpiThresholds: { roas: 9 } });
  assert.deepEqual(merged?.kpiThresholds, { revenue: 500, roas: 9, conversions: 100, cpa: 15 });
  const untouched = await updateClient(client.id, { kpiThresholds: null });
  assert.deepEqual(untouched?.kpiThresholds, merged?.kpiThresholds);
});

test('deleteClient reports existence, is idempotent and cascades to daily stats and integrations', async () => {
  const { deleteClient, getClientByIdRecord, listClientIntegrations, listDailyStats, saveClientIntegration, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Delete');
  await upsertDailyStat({ clientId: client.id, statDate: '2024-03-01', revenue: 10 });
  const integration = await saveClientIntegration({ clientId: client.id, provider: 'ga4', config: { propertyId: '123456' } });
  assert.ok(integration);
  assert.equal((await listDailyStats(client.id)).length, 1);

  assert.equal(await deleteClient(client.id), true);
  assert.equal(await getClientByIdRecord(client.id), null);
  assert.deepEqual(await listDailyStats(client.id), []);
  assert.deepEqual(await listClientIntegrations(client.id), []);
  assert.equal(await deleteClient(client.id), false);
  assert.equal(await deleteClient(MISSING_ID), false);
});

test('client text columns round-trip quotes, backslashes, unicode and SQL-looking text verbatim', async () => {
  const { createClient, listClients, updateClient } = await loadDatabase();
  const name = `${NASTY_NAME} ${unique()}`;
  const created = await createClient({ name, industry: `it's "retail" \\ 日本`, logoUrl: `https://x.test/a?b=1&c=@d'e` });
  const [stored] = await listClients({ clientIds: [created.id] });
  assert.equal(stored?.name, name.trim());
  assert.equal(stored?.industry, `it's "retail" \\ 日本`);
  assert.equal(stored?.logoUrl, `https://x.test/a?b=1&c=@d'e`);

  // The destructive-looking text did not execute: the clients table is still readable.
  assert.ok((await listClients()).length >= 1);

  const renamed = await updateClient(created.id, { name: `${name} v2`, industry: `'; DELETE FROM clients; --` });
  assert.equal(renamed?.name, `${name} v2`.trim());
  assert.equal(renamed?.industry, `'; DELETE FROM clients; --`);
  assert.equal((await listClients({ clientIds: [created.id] })).length, 1);
});

test('strings that look like NULL, numbers or booleans stay strings; null and undefined store NULL', async () => {
  const { createClient, listClients } = await loadDatabase();
  const asNullText = await createClient({ name: `Literal ${unique()}`, industry: 'NULL' });
  const asNumberText = await createClient({ name: `Literal ${unique()}`, industry: '007' });
  const asBooleanText = await createClient({ name: `Literal ${unique()}`, industry: 'true' });
  const asEmpty = await createClient({ name: `Literal ${unique()}`, industry: '' });
  const asNull = await createClient({ name: `Literal ${unique()}`, industry: null });
  const asUndefined = await createClient({ name: `Literal ${unique()}` });
  const read = async (id: string) => (await listClients({ clientIds: [id] }))[0]?.industry;

  assert.equal(await read(asNullText.id), 'NULL');
  assert.equal(await read(asNumberText.id), '007');
  assert.equal(await read(asBooleanText.id), 'true');
  assert.equal(await read(asEmpty.id), '');
  assert.equal(await read(asNull.id), null);
  assert.equal(await read(asUndefined.id), null);
});

// ---------------------------------------------------------------- daily stats

test('upsertDailyStat inserts with zero defaults, manual source and null notes', async () => {
  const { getDailyStatById, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat defaults');
  const stat = await upsertDailyStat({ clientId: client.id, statDate: '2024-02-29' });

  assert.ok(stat);
  assert.equal(typeof stat.id, 'string');
  assert.equal(stat.clientId, client.id);
  assert.equal(stat.statDate, '2024-02-29');
  for (const key of ['revenue', 'roas', 'clicks', 'conversions', 'cpa', 'leads', 'traffic'] as const) {
    assert.equal(stat[key], 0, key);
  }
  assert.equal(stat.notes, null);
  assert.equal(stat.source, 'manual');
  assert.equal(stat.createdAt, stat.updatedAt);
  assert.deepEqual(Object.keys(stat).sort(), [
    'clicks', 'clientId', 'conversions', 'cpa', 'createdAt', 'id', 'leads', 'notes', 'revenue', 'roas', 'source', 'statDate', 'traffic', 'updatedAt',
  ]);
  assert.deepEqual(await getDailyStatById(stat.id), stat);
});

test('daily stat numbers come back as JavaScript numbers and REAL columns keep single precision', async () => {
  const { upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat numbers');
  const stat = await upsertDailyStat({
    clientId: client.id, statDate: '2024-01-15', revenue: 1234.56, roas: 4.25, cpa: 12.75, clicks: 50, conversions: 5, leads: 7, traffic: 900,
  });
  assert.ok(stat);
  assert.equal(stat.revenue, 1234.56);
  assert.equal(stat.roas, 4.25);
  assert.equal(stat.cpa, 12.75);
  assert.deepEqual([stat.clicks, stat.conversions, stat.leads, stat.traffic], [50, 5, 7, 900]);
  for (const value of [stat.revenue, stat.roas, stat.clicks, stat.traffic]) assert.equal(typeof value, 'number');

  // REAL is a 4-byte float: 16777217 is not representable and is stored as 16777216.
  const precise = await upsertDailyStat({ clientId: client.id, statDate: '2024-01-16', revenue: 16777217 });
  assert.equal(precise?.revenue, 16777216);

  const negative = await upsertDailyStat({ clientId: client.id, statDate: '2024-01-17', revenue: -5.5 });
  assert.equal(negative?.revenue, -5.5);
});

test('integer stat columns round fractional input (PostgreSQL assignment cast) and reject out-of-range values', async () => {
  const { upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat integers');
  const stat = await upsertDailyStat({ clientId: client.id, statDate: '2024-01-01', clicks: 12.7, conversions: 0.4, leads: 1, traffic: 2 });
  assert.equal(stat?.clicks, 13);
  assert.equal(stat?.conversions, 0);

  await assert.rejects(() => upsertDailyStat({ clientId: client.id, statDate: '2024-01-02', clicks: 3_000_000_000 }), /out of range/i);
});

test('upsertDailyStat twice for the same client and day overwrites in place instead of duplicating or merging', async () => {
  const { listDailyStats, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat upsert');
  const first = await upsertDailyStat({ clientId: client.id, statDate: '2024-05-10', revenue: 100, clicks: 50, notes: 'primera', source: 'ga4' });
  const second = await upsertDailyStat({ clientId: client.id, statDate: '2024-05-10', revenue: 200 });

  assert.ok(first && second);
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.updatedAt >= first.updatedAt);
  assert.equal(second.revenue, 200);
  // Omitted fields are reset to their defaults (no partial merge) and the source falls back to 'manual'.
  assert.equal(second.clicks, 0);
  assert.equal(second.notes, null);
  assert.equal(second.source, 'manual');

  const rows = await listDailyStats(client.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], second);
});

test('daily stats for different days or different clients never collide', async () => {
  const { listDailyStats, upsertDailyStat } = await loadDatabase();
  const clientA = await makeClient('Stat collide A');
  const clientB = await makeClient('Stat collide B');
  const a = await upsertDailyStat({ clientId: clientA.id, statDate: '2024-06-01', revenue: 1 });
  const b = await upsertDailyStat({ clientId: clientB.id, statDate: '2024-06-01', revenue: 2 });
  const c = await upsertDailyStat({ clientId: clientA.id, statDate: '2024-06-02', revenue: 3 });
  assert.equal(new Set([a?.id, b?.id, c?.id]).size, 3);
  assert.equal((await listDailyStats(clientA.id)).length, 2);
  assert.equal((await listDailyStats(clientB.id)).length, 1);
});

test('stat_date is free-form text: no validation, no normalization, text ordering', async () => {
  const { listDailyStats, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat dates');
  const dates = ['2024-01-31', '2024-02-29', '2024-03-01', '2023-12-31', '2024-02-01', '0001-01-01', '9999-12-31'];
  for (const statDate of dates) await upsertDailyStat({ clientId: client.id, statDate, revenue: 1 });

  // stat_date DESC.
  assert.deepEqual((await listDailyStats(client.id)).map((stat) => stat.statDate), [...dates].sort().reverse());

  // KNOWN BUG: nothing validates the date; garbage and non-canonical spellings of the same day are stored as distinct rows.
  const garbage = await upsertDailyStat({ clientId: client.id, statDate: 'not-a-date' });
  assert.equal(garbage?.statDate, 'not-a-date');
  const sameDayOtherSpelling = await upsertDailyStat({ clientId: client.id, statDate: '2024-01-31T00:00:00Z' });
  assert.notEqual(sameDayOtherSpelling?.id, (await listDailyStats(client.id)).find((stat) => stat.statDate === '2024-01-31')?.id);
  assert.equal((await listDailyStats(client.id)).length, dates.length + 2);
});

test('upsertDailyStat rejects unknown clients and NaN numbers with database errors', async () => {
  const { listDailyStats, upsertDailyStat } = await loadDatabase();
  await assert.rejects(
    () => upsertDailyStat({ clientId: MISSING_ID, statDate: '2024-01-01' }),
    /foreign key/i,
  );

  const client = await makeClient('Stat NaN');
  // NaN is inlined as SQL NULL, which violates the NOT NULL constraint.
  await assert.rejects(() => upsertDailyStat({ clientId: client.id, statDate: '2024-01-01', revenue: Number.NaN }), /null value|not-null/i);
  assert.deepEqual(await listDailyStats(client.id), []);
});

test('daily stat text fields round-trip nasty strings; empty string stays empty while null/undefined become null', async () => {
  const { getDailyStatById, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat text');
  const notes = `  O'Brien said "hi"\nnew line\ttab \\ back\\slash '' -- x; DROP TABLE daily_stats; ?@revenue $1 日本語 🚀  `;
  const stat = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-01', notes, source: `src'"\\` });
  assert.equal(stat?.notes, notes); // not trimmed
  assert.equal(stat?.source, `src'"\\`);

  const asEmpty = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-02', notes: '' });
  assert.equal(asEmpty?.notes, '');
  const asNull = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-03', notes: null });
  assert.equal(asNull?.notes, null);
  const asUndefined = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-04' });
  assert.equal(asUndefined?.notes, null);
  const asNullText = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-05', notes: 'NULL' });
  assert.equal(asNullText?.notes, 'NULL');
  const asNumberText = await upsertDailyStat({ clientId: client.id, statDate: '2024-04-06', notes: '007' });
  assert.equal(asNumberText?.notes, '007');
  assert.equal((await getDailyStatById(asNumberText!.id))?.notes, '007');
});

test('listDailyStats orders by stat_date desc, applies scopes and returns empty arrays for unknown clients', async () => {
  const { listDailyStats, upsertDailyStat } = await loadDatabase();
  const clientA = await makeClient('Stat list A');
  const clientB = await makeClient('Stat list B');
  await upsertDailyStat({ clientId: clientA.id, statDate: '2030-01-01', revenue: 1 });
  await upsertDailyStat({ clientId: clientA.id, statDate: '2030-01-03', revenue: 3 });
  await upsertDailyStat({ clientId: clientA.id, statDate: '2030-01-02', revenue: 2 });
  const b = await upsertDailyStat({ clientId: clientB.id, statDate: '2030-01-03', revenue: 9 });

  assert.deepEqual((await listDailyStats(clientA.id)).map((stat) => stat.statDate), ['2030-01-03', '2030-01-02', '2030-01-01']);
  assert.deepEqual(await listDailyStats(MISSING_ID), []);

  // Without a clientId the clientIds scope applies; an empty scope returns nothing.
  assert.deepEqual(await listDailyStats(undefined, { clientIds: [] }), []);
  const scoped = await listDailyStats(undefined, { clientIds: [clientA.id, clientB.id] });
  assert.equal(scoped.length, 4);
  assert.deepEqual(scoped.map((stat) => stat.statDate), ['2030-01-03', '2030-01-03', '2030-01-02', '2030-01-01']);
  // Same date across clients: created_at DESC, so the later insert (client B) comes first.
  assert.equal(scoped[0]?.id, b?.id);
  assert.deepEqual((await listDailyStats(undefined, { clientIds: [clientB.id] })).map((stat) => stat.id), [b?.id]);

  // KNOWN BUG: an explicit clientId bypasses the clientIds scope, and an empty-string clientId is falsy and lists
  // every client's stats (subject to the scope). Authorization relies entirely on the route layer.
  assert.equal((await listDailyStats(clientB.id, { clientIds: [clientA.id] })).length, 1);
  assert.equal((await listDailyStats('', { clientIds: [clientA.id] })).length, 3);
});

test('deleteDailyStat and getDailyStatById report presence', async () => {
  const { deleteDailyStat, getDailyStatById, upsertDailyStat } = await loadDatabase();
  const client = await makeClient('Stat delete');
  const stat = await upsertDailyStat({ clientId: client.id, statDate: '2024-07-01' });
  assert.ok(stat);
  assert.equal(await deleteDailyStat(stat.id), true);
  assert.equal(await getDailyStatById(stat.id), null);
  assert.equal(await deleteDailyStat(stat.id), false);
  assert.equal(await getDailyStatById('missing'), null);
});

// ---------------------------------------------------------------- dashboard aggregates

test('getDashboardHealthSummary counts clients and stats within the scope and users globally', async () => {
  const { getDashboardHealthSummary, upsertDailyStat } = await loadDatabase();
  const clientA = await makeClient('Summary A');
  const clientB = await makeClient('Summary B');
  await upsertDailyStat({ clientId: clientA.id, statDate: '2024-08-01' });
  await upsertDailyStat({ clientId: clientA.id, statDate: '2024-08-02' });
  await upsertDailyStat({ clientId: clientB.id, statDate: '2024-08-01' });

  const empty = await getDashboardHealthSummary({ clientIds: [] });
  assert.deepEqual(Object.keys(empty).sort(), ['clients', 'dailyStats', 'users']);
  assert.equal(empty.clients, 0);
  assert.equal(empty.dailyStats, 0);
  assert.equal(typeof empty.users, 'number');

  const onlyA = await getDashboardHealthSummary({ clientIds: [clientA.id] });
  assert.equal(onlyA.clients, 1);
  assert.equal(onlyA.dailyStats, 2);
  const both = await getDashboardHealthSummary({ clientIds: [clientA.id, clientB.id] });
  assert.equal(both.clients, 2);
  assert.equal(both.dailyStats, 3);
  assert.equal(both.users, empty.users);

  const everything = await getDashboardHealthSummary();
  assert.ok(everything.clients >= 2);
  assert.ok(everything.dailyStats >= 3);
});

test('listClientsWithLatestStat attaches the newest stat and sorts clients with stats first, newest date first', async () => {
  const { listClientsWithLatestStat, upsertDailyStat } = await loadDatabase();
  const older = await makeClient('Latest older');
  const newer = await makeClient('Latest newer');
  const noStats = await makeClient('Latest none');
  await upsertDailyStat({ clientId: older.id, statDate: '2030-01-01', revenue: 1 });
  await upsertDailyStat({ clientId: older.id, statDate: '2029-12-31', revenue: 99 });
  await upsertDailyStat({ clientId: newer.id, statDate: '2030-01-02', revenue: 2 });

  const rows = await listClientsWithLatestStat({ clientIds: [noStats.id, older.id, newer.id] });
  assert.deepEqual(rows.map((row) => row.id), [newer.id, older.id, noStats.id]);
  assert.equal(rows[0]?.latestStat?.statDate, '2030-01-02');
  assert.equal(rows[1]?.latestStat?.statDate, '2030-01-01');
  assert.equal(rows[1]?.latestStat?.revenue, 1);
  assert.equal(rows[2]?.latestStat, null);
  // Client fields are spread alongside latestStat.
  assert.equal(rows[0]?.name, newer.name);
  assert.deepEqual(await listClientsWithLatestStat({ clientIds: [] }), []);
});
