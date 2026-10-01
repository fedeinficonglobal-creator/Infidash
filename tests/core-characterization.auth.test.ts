import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';

// Characterization tests for users, authentication and sessions in src/lib/database.ts.
// They pin CURRENT behavior ahead of the psql-shim -> pg pool migration.

const loadDatabase = () => import('../src/lib/database.js');
const loadAuth = () => import('../src/lib/auth.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const MISSING_ID = '00000000-0000-0000-0000-000000000000';
const PASSWORD = 'temporal-1234';

async function makeUser(role: 'admin' | 'viewer' = 'viewer', extra: { clientIds?: string[]; name?: string; password?: string } = {}) {
  const { createUser } = await loadDatabase();
  const email = `char-${unique()}@infidash.local`;
  const user = await createUser({ email, name: extra.name ?? 'Characterization', password: extra.password ?? PASSWORD, role, clientIds: extra.clientIds });
  return { user, email, password: extra.password ?? PASSWORD };
}

async function countSessions(where: 'user_id' | 'token_hash', value: string) {
  const { getDatabase } = await loadDatabase();
  const row = getDatabase().prepare(`SELECT COUNT(*) AS total FROM sessions WHERE ${where} = ?`).get(value) as { total: number };
  return row.total;
}

// ---------------------------------------------------------------- createUser

test('createUser normalizes the email, trims the name, never exposes the password hash and scopes clientIds by role', async () => {
  const { createClient, createUser } = await loadDatabase();
  const tag = unique();
  const client = await createClient({ name: `Auth scope ${tag}` });

  const viewer = await createUser({ email: `  MiXed-${tag}@Infidash.Local  `, name: '  Padded Name  ', password: PASSWORD, role: 'viewer', clientIds: [client.id] });
  assert.equal(viewer.email, `mixed-${tag}@infidash.local`);
  assert.equal(viewer.name, 'Padded Name');
  assert.equal(viewer.role, 'viewer');
  assert.equal(viewer.active, true);
  assert.deepEqual(viewer.clientIds, [client.id]);
  assert.equal(viewer.createdAt, viewer.updatedAt);
  assert.deepEqual(Object.keys(viewer).sort(), ['active', 'clientIds', 'createdAt', 'email', 'id', 'name', 'role', 'updatedAt']);
  assert.ok(!JSON.stringify(viewer).includes('pbkdf2'));

  // clientIds are ignored for admins: they have no membership rows and report null (unrestricted).
  const admin = await createUser({ email: `admin-${tag}@infidash.local`, name: 'Admin', password: PASSWORD, role: 'admin', clientIds: [client.id] });
  assert.equal(admin.clientIds, null);

  const withoutClients = await createUser({ email: `bare-${tag}@infidash.local`, name: 'Bare', password: PASSWORD, role: 'viewer' });
  assert.deepEqual(withoutClients.clientIds, []);
});

test('createUser rejects duplicate emails (case and whitespace insensitive) and invalid roles', async () => {
  const { createUser } = await loadDatabase();
  const { email } = await makeUser();
  await assert.rejects(
    () => createUser({ email: `  ${email.toUpperCase()} `, name: 'Duplicate', password: PASSWORD, role: 'viewer' }),
    /duplicate key/i,
  );
  await assert.rejects(
    () => createUser({ email: `role-${unique()}@infidash.local`, name: 'Bad role', password: PASSWORD, role: 'superuser' as never }),
    /check constraint/i,
  );
});

test('createUser is not atomic: a failing membership insert leaves the user row behind', async () => {
  const { createUser, listUsers } = await loadDatabase();
  const email = `orphan-${unique()}@infidash.local`;
  // KNOWN BUG: the INSERT INTO users is committed before client_memberships is written, so an unknown client id
  // throws a foreign-key error but the user already exists (and the email can no longer be reused).
  await assert.rejects(
    () => createUser({ email, name: 'Orphan', password: PASSWORD, role: 'viewer', clientIds: [MISSING_ID] }),
    /foreign key/i,
  );
  assert.ok((await listUsers()).some((user) => user.email === email));
  await assert.rejects(() => createUser({ email, name: 'Retry', password: PASSWORD, role: 'viewer' }), /duplicate key/i);
});

test('user text and password survive quotes, backslashes and unicode', async () => {
  const { authenticateUser, createUser } = await loadDatabase();
  const email = `quote-${unique()}@infidash.local`;
  const name = `O'Neil "Q" \\ Ñandú 日本語 🚀 -- ; DROP TABLE users`;
  const password = `pa'ss"wörd\\ ?@x $1 日本`;
  const created = await createUser({ email, name, password, role: 'viewer' });
  assert.equal(created.name, name);
  const login = await authenticateUser(email, password);
  assert.ok(login);
  assert.equal(login.user.name, name);
  assert.equal(await authenticateUser(email, `${password}x`), null);
});

// ---------------------------------------------------------------- authenticateUser

test('authenticateUser returns a token and the public user, ignoring email case and surrounding whitespace', async () => {
  const { authenticateUser } = await loadDatabase();
  const { user, email } = await makeUser();

  const login = await authenticateUser(`  ${email.toUpperCase()}  `, PASSWORD);
  assert.ok(login);
  assert.match(login.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(login.user, user);
  assert.deepEqual(Object.keys(login).sort(), ['token', 'user']);
});

test('authenticateUser returns null for a wrong password, an unknown email, an empty password and an injection attempt', async () => {
  const { authenticateUser } = await loadDatabase();
  const { email } = await makeUser();
  assert.equal(await authenticateUser(email, 'wrong-password'), null);
  assert.equal(await authenticateUser(email, ''), null);
  assert.equal(await authenticateUser(`missing-${unique()}@infidash.local`, PASSWORD), null);
  assert.equal(await authenticateUser(`' OR '1'='1`, PASSWORD), null);
  assert.equal(await authenticateUser('', ''), null);
});

test('authenticateUser stores only the SHA-256 of the token with a 12 hour expiry and one row per login', async () => {
  const { authenticateUser, getDatabase } = await loadDatabase();
  const { hashToken } = await loadAuth();
  const { user, email } = await makeUser();

  const first = await authenticateUser(email, PASSWORD);
  const second = await authenticateUser(email, PASSWORD);
  assert.ok(first && second);
  assert.notEqual(first.token, second.token);

  const rows = getDatabase().prepare(`SELECT * FROM sessions WHERE user_id = ?`).all(user.id) as Array<Record<string, string>>;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.token_hash).sort(), [hashToken(first.token), hashToken(second.token)].sort());
  for (const row of rows) {
    assert.ok(!Object.values(row).includes(first.token));
    const remaining = Date.parse(row.expires_at) - Date.now();
    assert.ok(remaining > 11.9 * 3_600_000 && remaining <= 12 * 3_600_000, `expires in ${remaining} ms`);
  }
});

test('authenticateUser refuses inactive users', async () => {
  const { authenticateUser, updateUserRole } = await loadDatabase();
  const { user, email } = await makeUser();
  assert.equal((await updateUserRole(user.id, { active: false }))?.active, false);
  assert.equal(await authenticateUser(email, PASSWORD), null);
  assert.equal((await updateUserRole(user.id, { active: true }))?.active, true);
  assert.ok(await authenticateUser(email, PASSWORD));
});

// ---------------------------------------------------------------- sessions

test('getSessionByToken returns the token, the live user and the expiry; unknown tokens return null', async () => {
  const { authenticateUser, getSessionByToken } = await loadDatabase();
  const { user, email } = await makeUser();
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);

  const session = await getSessionByToken(login.token);
  assert.ok(session);
  assert.equal(session.token, login.token);
  assert.deepEqual(session.user, user);
  assert.ok(Date.parse(session.expiresAt) > Date.now());
  assert.deepEqual(Object.keys(session).sort(), ['expiresAt', 'token', 'user']);

  assert.equal(await getSessionByToken('not-a-token'), null);
  assert.equal(await getSessionByToken(''), null);
  assert.equal(await getSessionByToken(`x' OR '1'='1`), null);
  // The raw stored hash is not a valid token.
  const { hashToken } = await loadAuth();
  assert.equal(await getSessionByToken(hashToken(login.token)), null);
});

test('an expired session returns null and is deleted on first read', async () => {
  const { authenticateUser, getDatabase, getSessionByToken } = await loadDatabase();
  const { hashToken } = await loadAuth();
  const { email } = await makeUser();
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);
  const tokenHash = hashToken(login.token);

  getDatabase().prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).run(new Date(Date.now() - 1000).toISOString(), tokenHash);
  assert.equal(await countSessions('token_hash', tokenHash), 1);
  assert.equal(await getSessionByToken(login.token), null);
  assert.equal(await countSessions('token_hash', tokenHash), 0);
  assert.equal(await getSessionByToken(login.token), null);

  // A session expiring in the future is still valid.
  const fresh = await authenticateUser(email, PASSWORD);
  assert.ok(fresh);
  getDatabase().prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).run(new Date(Date.now() + 60_000).toISOString(), hashToken(fresh.token));
  assert.ok(await getSessionByToken(fresh.token));
});

test('a deactivated user has no session, but the session row is kept and works again after reactivation', async () => {
  const { authenticateUser, getSessionByToken, updateUserRole } = await loadDatabase();
  const { hashToken } = await loadAuth();
  const { user, email } = await makeUser();
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);

  await updateUserRole(user.id, { active: false });
  assert.equal(await getSessionByToken(login.token), null);
  // Pinned: unlike expiry, deactivation does not delete the session.
  assert.equal(await countSessions('token_hash', hashToken(login.token)), 1);

  await updateUserRole(user.id, { active: true });
  assert.equal((await getSessionByToken(login.token))?.user.id, user.id);
});

test('getSessionByToken reflects role changes immediately', async () => {
  const { authenticateUser, getSessionByToken, updateUserRole } = await loadDatabase();
  const { user, email } = await makeUser();
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);
  assert.equal((await getSessionByToken(login.token))?.user.role, 'viewer');
  await updateUserRole(user.id, { role: 'admin' });
  const promoted = await getSessionByToken(login.token);
  assert.equal(promoted?.user.role, 'admin');
  assert.equal(promoted?.user.clientIds, null);
});

test('revokeSessionByToken removes only that session and is idempotent', async () => {
  const { authenticateUser, getSessionByToken, revokeSessionByToken } = await loadDatabase();
  const { email } = await makeUser();
  const first = await authenticateUser(email, PASSWORD);
  const second = await authenticateUser(email, PASSWORD);
  assert.ok(first && second);

  assert.equal(await revokeSessionByToken(first.token), undefined);
  assert.equal(await getSessionByToken(first.token), null);
  assert.ok(await getSessionByToken(second.token));

  await assert.doesNotReject(() => revokeSessionByToken(first.token));
  await assert.doesNotReject(() => revokeSessionByToken('unknown-token'));
  await assert.doesNotReject(() => revokeSessionByToken(''));
  assert.ok(await getSessionByToken(second.token));
});

test('revokeAllSessionsForUser removes every session of that user and leaves other users alone', async () => {
  const { authenticateUser, getSessionByToken, revokeAllSessionsForUser } = await loadDatabase();
  const target = await makeUser();
  const bystander = await makeUser();
  const a = await authenticateUser(target.email, PASSWORD);
  const b = await authenticateUser(target.email, PASSWORD);
  const other = await authenticateUser(bystander.email, PASSWORD);
  assert.ok(a && b && other);

  assert.equal(await revokeAllSessionsForUser(target.user.id), undefined);
  assert.equal(await getSessionByToken(a.token), null);
  assert.equal(await getSessionByToken(b.token), null);
  assert.ok(await getSessionByToken(other.token));
  await assert.doesNotReject(() => revokeAllSessionsForUser(MISSING_ID));
});

// ---------------------------------------------------------------- updateUserRole / deleteUser / listUsers

test('updateUserRole returns null for unknown users and keeps blank names and unspecified fields', async () => {
  const { updateUserRole } = await loadDatabase();
  assert.equal(await updateUserRole(MISSING_ID, { name: 'Nope' }), null);

  const { user } = await makeUser('viewer', { name: 'Original' });
  const same = await updateUserRole(user.id, {});
  assert.ok(same);
  assert.equal(same.name, 'Original');
  assert.equal(same.role, 'viewer');
  assert.equal(same.active, true);
  assert.ok(same.updatedAt >= user.updatedAt);
  assert.equal(same.createdAt, user.createdAt);

  assert.equal((await updateUserRole(user.id, { name: '   ' }))?.name, 'Original');
  assert.equal((await updateUserRole(user.id, { name: '  New Name  ' }))?.name, 'New Name');
  await assert.rejects(() => updateUserRole(user.id, { role: 'superuser' as never }), /check constraint/i);
});

test('updateUserRole replaces memberships for viewers, treats an empty array as "clear all" and ignores clientIds for admins', async () => {
  const { createClient, getSessionByToken, updateUserRole, authenticateUser } = await loadDatabase();
  const tag = unique();
  const a = await createClient({ name: `Member A ${tag}` });
  const b = await createClient({ name: `Member B ${tag}` });
  const { user, email } = await makeUser('viewer', { clientIds: [a.id] });
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);

  assert.deepEqual((await updateUserRole(user.id, { clientIds: [b.id] }))?.clientIds, [b.id]);
  // Omitting clientIds keeps the memberships.
  assert.deepEqual((await updateUserRole(user.id, { name: 'Renamed' }))?.clientIds, [b.id]);
  assert.deepEqual((await getSessionByToken(login.token))?.user.clientIds, [b.id]);
  // An empty array is truthy, so it clears every membership.
  assert.deepEqual((await updateUserRole(user.id, { clientIds: [] }))?.clientIds, []);
  // Unknown client ids surface the foreign-key error.
  await assert.rejects(() => updateUserRole(user.id, { clientIds: [MISSING_ID] }), /foreign key/i);

  const admin = await updateUserRole(user.id, { role: 'admin', clientIds: [a.id] });
  assert.equal(admin?.clientIds, null);
});

test('deleteUser returns the removed user, cascades to sessions and is idempotent', async () => {
  const { authenticateUser, createClient, deleteUser, getSessionByToken, listUsers } = await loadDatabase();
  const client = await createClient({ name: `Delete user ${unique()}` });
  const { user, email } = await makeUser('viewer', { clientIds: [client.id] });
  const login = await authenticateUser(email, PASSWORD);
  assert.ok(login);
  assert.ok((await listUsers()).some((candidate) => candidate.id === user.id));

  const removed = await deleteUser(user.id);
  assert.ok(removed);
  assert.equal(removed.id, user.id);
  assert.equal(removed.email, user.email);
  // Quirk: clientIds are read after the cascade deleted the memberships, so a viewer always reports [].
  assert.deepEqual(user.clientIds, [client.id]);
  assert.deepEqual(removed.clientIds, []);

  assert.equal(await getSessionByToken(login.token), null);
  assert.equal(await countSessions('user_id', user.id), 0);
  assert.equal(await authenticateUser(email, PASSWORD), null);
  assert.ok(!(await listUsers()).some((candidate) => candidate.id === user.id));
  assert.equal(await deleteUser(user.id), null);
  assert.equal(await deleteUser(MISSING_ID), null);
});

test('listUsers orders by creation time and reports membership per user (null for admins)', async () => {
  const { createClient, listUsers } = await loadDatabase();
  const a = await createClient({ name: `List users A ${unique()}` });
  const b = await createClient({ name: `List users B ${unique()}` });
  const first = await makeUser('viewer', { clientIds: [a.id, b.id] });
  const second = await makeUser('admin');
  const third = await makeUser('viewer');

  const users = await listUsers();
  const ids = users.map((user) => user.id);
  assert.ok(ids.indexOf(first.user.id) < ids.indexOf(second.user.id));
  assert.ok(ids.indexOf(second.user.id) < ids.indexOf(third.user.id));

  const byId = new Map(users.map((user) => [user.id, user]));
  assert.deepEqual(new Set(byId.get(first.user.id)?.clientIds), new Set([a.id, b.id]));
  assert.equal(byId.get(second.user.id)?.clientIds, null);
  assert.deepEqual(byId.get(third.user.id)?.clientIds, []);
  assert.deepEqual(Object.keys(byId.get(first.user.id)!).sort(), ['active', 'clientIds', 'createdAt', 'email', 'id', 'name', 'role', 'updatedAt']);
});
