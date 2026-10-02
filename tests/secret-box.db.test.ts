import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { coreSqlGet, coreSqlRun } from './helpers/coreSql.js';

// At-rest encryption of integrations.credentials_json. The runner (scripts/run-tests.mjs) sets a test key for the db
// suite; each test switches the key through process.env, which the app reads on every call, and restores it after.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const KEY_VARIABLE = 'INFIDASH_CREDENTIALS_KEY';
const PREVIOUS_VARIABLE = 'INFIDASH_CREDENTIALS_KEY_PREVIOUS';
const newKey = () => randomBytes(32).toString('base64');
// The runner gives the whole db suite one key, so rows written by other files are encrypted under it. Every test here
// keeps that key as the current (or, while rotating, previous) key, so those foreign rows always stay readable.
const BASE_KEY = process.env[KEY_VARIABLE] ?? newKey();

async function withKeys<T>(keys: { key?: string; previous?: string }, fn: () => Promise<T>): Promise<T> {
  const saved = { key: process.env[KEY_VARIABLE], previous: process.env[PREVIOUS_VARIABLE] };
  const apply = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  apply(KEY_VARIABLE, keys.key);
  apply(PREVIOUS_VARIABLE, keys.previous);
  try {
    return await fn();
  } finally {
    apply(KEY_VARIABLE, saved.key);
    apply(PREVIOUS_VARIABLE, saved.previous);
  }
}

async function makeWordpress(secret: string) {
  const { createClient, saveClientIntegration } = await loadDatabase();
  const client = await createClient({ name: `Secret box ${unique()}` });
  const integration = await saveClientIntegration({
    clientId: client.id,
    provider: 'wordpress',
    config: { siteUrl: `https://wp-${unique()}.example.test` },
    credentials: { username: 'api-user', applicationPassword: secret },
  });
  assert.ok(integration);
  return integration;
}

const storedCredentials = async (id: string) => (await coreSqlGet<{ credentials_json: string }>(`SELECT credentials_json FROM integrations WHERE id = $1`, [id]))!.credentials_json;

test('with a key, saveClientIntegration stores ciphertext and reads return the original values', async () => {
  await withKeys({ key: BASE_KEY }, async () => {
    const { getIntegrationCredentialsById, getIntegrationById, saveClientIntegration } = await loadDatabase();
    const secret = `pw-${unique()}`;
    const integration = await makeWordpress(secret);
    const stored = await storedCredentials(integration.id);
    assert.ok(stored.startsWith('enc:v1:'));
    assert.ok(!stored.includes(secret));
    assert.deepEqual(await getIntegrationCredentialsById(integration.id), { username: 'api-user', applicationPassword: secret });
    assert.deepEqual((await getIntegrationById(integration.id))?.secretKeys.sort(), ['applicationPassword', 'username']);

    // A blank value keeps the stored secret and the row stays encrypted.
    await saveClientIntegration({ clientId: integration.clientId, provider: 'wordpress', credentials: { applicationPassword: '' } });
    assert.ok((await storedCredentials(integration.id)).startsWith('enc:v1:'));
    assert.equal((await getIntegrationCredentialsById(integration.id))?.applicationPassword, secret);
  });
});

test('without a key, credentials stay plaintext JSON', async () => {
  await withKeys({}, async () => {
    const { getIntegrationCredentialsById } = await loadDatabase();
    const secret = `pw-${unique()}`;
    const integration = await makeWordpress(secret);
    const stored = await storedCredentials(integration.id);
    assert.ok(!stored.startsWith('enc:v1:'));
    assert.deepEqual(JSON.parse(stored), { username: 'api-user', applicationPassword: secret });
    assert.deepEqual(await getIntegrationCredentialsById(integration.id), { username: 'api-user', applicationPassword: secret });
  });
});

test('a legacy plaintext row stays readable with a key and the boot migration encrypts it once', async () => {
  await withKeys({}, async () => {
    const secret = `pw-${unique()}`;
    const integration = await makeWordpress(secret);
    await withKeys({ key: BASE_KEY }, async () => {
      const { encryptExistingCredentials, getIntegrationCredentialsById } = await loadDatabase();
      assert.equal((await getIntegrationCredentialsById(integration.id))?.applicationPassword, secret);
      assert.ok(!(await storedCredentials(integration.id)).startsWith('enc:v1:'));

      const first = await encryptExistingCredentials();
      assert.ok(first.encrypted >= 1);
      const afterFirst = await storedCredentials(integration.id);
      assert.ok(afterFirst.startsWith('enc:v1:'));
      assert.ok(!afterFirst.includes(secret));
      assert.equal((await getIntegrationCredentialsById(integration.id))?.applicationPassword, secret);

      const second = await encryptExistingCredentials();
      assert.deepEqual(second, { encrypted: 0, reencrypted: 0, unchanged: second.unchanged });
      assert.equal(await storedCredentials(integration.id), afterFirst);
    });
  });
});

test('key rotation re-encrypts rows from the previous key to the new one', async () => {
  const nextKey = newKey();
  await withKeys({ key: BASE_KEY }, async () => {
    const secret = `pw-${unique()}`;
    const integration = await makeWordpress(secret);
    const { encryptExistingCredentials, getIntegrationCredentialsById } = await loadDatabase();
    const before = await storedCredentials(integration.id);
    await withKeys({ key: nextKey, previous: BASE_KEY }, async () => {
      const counts = await encryptExistingCredentials();
      assert.ok(counts.reencrypted >= 1);
      assert.notEqual(await storedCredentials(integration.id), before);
    });
    await withKeys({ key: nextKey }, async () => {
      assert.equal((await getIntegrationCredentialsById(integration.id))?.applicationPassword, secret);
    });
    // Rotate back so the rows written by the other db files keep opening with the runner key.
    await withKeys({ key: BASE_KEY, previous: nextKey }, async () => {
      await encryptExistingCredentials();
    });
    assert.equal((await getIntegrationCredentialsById(integration.id))?.applicationPassword, secret);
  });
});

test('a ciphertext copied to another integration fails to decrypt, and boot verification rejects it', async () => {
  await withKeys({ key: BASE_KEY }, async () => {
    const { encryptExistingCredentials, getIntegrationCredentialsById } = await loadDatabase();
    const a = await makeWordpress(`pw-a-${unique()}`);
    const b = await makeWordpress(`pw-b-${unique()}`);
    const original = await storedCredentials(b.id);
    await coreSqlRun(`UPDATE integrations SET credentials_json = $1 WHERE id = $2`, [await storedCredentials(a.id), b.id]);
    await assert.rejects(() => getIntegrationCredentialsById(b.id), /No se pudieron descifrar/);
    await assert.rejects(() => encryptExistingCredentials(), /No se pudieron descifrar/);
    await coreSqlRun(`UPDATE integrations SET credentials_json = $1 WHERE id = $2`, [original, b.id]);
    await encryptExistingCredentials();
  });
});

test('encrypted rows with a missing key fail the boot verification with a clear error', async () => {
  const integration = await withKeys({ key: BASE_KEY }, () => makeWordpress(`pw-${unique()}`));
  await withKeys({}, async () => {
    const { encryptExistingCredentials } = await loadDatabase();
    await assert.rejects(() => encryptExistingCredentials(), /INFIDASH_CREDENTIALS_KEY no está configurada/);
  });
  // Leave the shared database clean for the other suites: nothing else can open this row without its key.
  await coreSqlRun(`DELETE FROM integrations WHERE id = $1`, [integration.id]);
});
