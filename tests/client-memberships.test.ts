import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

test('a new viewer defaults to zero clients, and getSessionByToken reflects granted memberships live', async () => {
  const { authenticateUser, createClient, createUser, getSessionByToken, updateUserRole } = await import('../src/lib/database.js');
  const clientA = createClient({ name: `Membership A ${Date.now()}` });
  const clientB = createClient({ name: `Membership B ${Date.now()}` });
  const email = `viewer-${Date.now()}@infidash.local`;

  const created = createUser({ email, name: 'Viewer', password: 'temporal-1234', role: 'viewer' });
  assert.deepEqual(created.clientIds, []);

  const login = authenticateUser(email, 'temporal-1234');
  assert.ok(login);
  const session = getSessionByToken(login!.token);
  assert.deepEqual(session?.user.clientIds, []);

  updateUserRole(created.id, { clientIds: [clientA.id, clientB.id] });
  const afterGrant = getSessionByToken(login!.token);
  assert.deepEqual(new Set(afterGrant?.user.clientIds), new Set([clientA.id, clientB.id]));

  updateUserRole(created.id, { clientIds: [clientA.id] });
  const afterRevoke = getSessionByToken(login!.token);
  assert.deepEqual(afterRevoke?.user.clientIds, [clientA.id]);
});

test('admins always report clientIds:null and promoting a viewer to admin clears memberships', async () => {
  const { createClient, createUser, updateUserRole } = await import('../src/lib/database.js');
  const client = createClient({ name: `Membership Promotion ${Date.now()}` });
  const viewer = createUser({ email: `promoted-${Date.now()}@infidash.local`, name: 'Promoted', password: 'temporal-1234', role: 'viewer', clientIds: [client.id] });
  assert.deepEqual(viewer.clientIds, [client.id]);

  const admin = createUser({ email: `admin-${Date.now()}@infidash.local`, name: 'Admin', password: 'temporal-1234', role: 'admin' });
  assert.equal(admin.clientIds, null);

  const promoted = updateUserRole(viewer.id, { role: 'admin' });
  assert.equal(promoted?.clientIds, null);

  const demoted = updateUserRole(viewer.id, { role: 'viewer' });
  assert.deepEqual(demoted?.clientIds, [], 'demoting back to viewer must not resurrect the memberships that existed before promotion');
});

test('listClients/listClientsWithLatestStat/listDailyStats/getDashboardHealthSummary honor an explicit clientIds scope', async () => {
  const { createClient, listClients, listClientsWithLatestStat, listDailyStats, getDashboardHealthSummary, upsertDailyStat } = await import('../src/lib/database.js');
  const allowed = createClient({ name: `Scope Allowed ${Date.now()}` });
  const blocked = createClient({ name: `Scope Blocked ${Date.now()}` });
  upsertDailyStat({ clientId: allowed.id, statDate: '2026-01-01', notes: null, source: 'manual' });
  upsertDailyStat({ clientId: blocked.id, statDate: '2026-01-01', notes: null, source: 'manual' });

  const scoped = listClients({ clientIds: [allowed.id] });
  assert.ok(scoped.some((c) => c.id === allowed.id));
  assert.ok(!scoped.some((c) => c.id === blocked.id));

  const scopedWithStats = listClientsWithLatestStat({ clientIds: [allowed.id] });
  assert.deepEqual(scopedWithStats.map((c) => c.id), [allowed.id]);

  const scopedStats = listDailyStats(undefined, { clientIds: [allowed.id] });
  assert.ok(scopedStats.every((stat) => stat.clientId === allowed.id));

  const zeroScope = listClients({ clientIds: [] });
  assert.deepEqual(zeroScope, [], 'an explicit empty allow-list must return nothing, not everything');

  const summary = getDashboardHealthSummary({ clientIds: [allowed.id] });
  assert.equal(summary.clients, scoped.length);

  const unscoped = listClients();
  assert.ok(unscoped.length >= 2, 'omitting clientIds must keep the unrestricted admin behavior');
});
