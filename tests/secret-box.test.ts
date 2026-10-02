import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  SecretBoxError,
  credentialsKeyStatus,
  decryptCredentials,
  decryptCredentialsWithKeyInfo,
  encryptCredentials,
  isEncrypted,
} from '../src/lib/secretBox.js';

const newKey = () => randomBytes(32).toString('base64');
const PLAIN = JSON.stringify({ consumerKey: 'ck_secret_value', consumerSecret: 'cs_secret_value' });

function envWith(key: string | undefined, previous?: string) {
  return { INFIDASH_CREDENTIALS_KEY: key, INFIDASH_CREDENTIALS_KEY_PREVIOUS: previous };
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof SecretBoxError && error.code === code);
}

test('roundtrip returns the original JSON and uses the enc:v1 format', () => {
  const env = envWith(newKey());
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env });
  assert.ok(stored.startsWith('enc:v1:'));
  assert.equal(stored.split(':').length, 5);
  assert.ok(isEncrypted(stored));
  assert.ok(!stored.includes('cs_secret_value'));
  assert.equal(decryptCredentials(stored, { aad: 'id-1', env }), PLAIN);
});

test('every encryption uses a fresh random IV', () => {
  const env = envWith(newKey());
  const a = encryptCredentials(PLAIN, { aad: 'id-1', env });
  const b = encryptCredentials(PLAIN, { aad: 'id-1', env });
  assert.notEqual(a, b);
  assert.notEqual(a.split(':')[2], b.split(':')[2]);
});

test('a different AAD (another integration id) fails to decrypt', () => {
  const env = envWith(newKey());
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env });
  expectCode(() => decryptCredentials(stored, { aad: 'id-2', env }), 'DECRYPT_FAILED');
});

test('tampering with any segment fails', () => {
  const env = envWith(newKey());
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env });
  const parts = stored.split(':');
  for (const index of [2, 3, 4]) {
    const bytes = Buffer.from(parts[index]!, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = [...parts];
    tampered[index] = bytes.toString('base64');
    assert.throws(() => decryptCredentials(tampered.join(':'), { aad: 'id-1', env }), SecretBoxError, `segment ${index}`);
  }
  expectCode(() => decryptCredentials('enc:v1:abc', { aad: 'id-1', env }), 'FORMAT_INVALID');
});

test('a wrong key fails and a missing key is reported for encrypted values', () => {
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(newKey()) });
  expectCode(() => decryptCredentials(stored, { aad: 'id-1', env: envWith(newKey()) }), 'DECRYPT_FAILED');
  expectCode(() => decryptCredentials(stored, { aad: 'id-1', env: envWith(undefined) }), 'KEY_MISSING');
  expectCode(() => encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(undefined) }), 'KEY_MISSING');
});

test('the previous key decrypts old values and reports which key was used', () => {
  const oldKey = newKey();
  const nextKey = newKey();
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(oldKey) });
  const rotating = envWith(nextKey, oldKey);
  const opened = decryptCredentialsWithKeyInfo(stored, { aad: 'id-1', env: rotating });
  assert.deepEqual(opened, { plaintext: PLAIN, key: 'previous' });
  const reencrypted = encryptCredentials(opened.plaintext, { aad: 'id-1', env: rotating });
  assert.equal(decryptCredentialsWithKeyInfo(reencrypted, { aad: 'id-1', env: rotating }).key, 'current');
  // Once the previous key is dropped, the re-encrypted value still opens and the old one does not.
  assert.equal(decryptCredentials(reencrypted, { aad: 'id-1', env: envWith(nextKey) }), PLAIN);
  expectCode(() => decryptCredentials(stored, { aad: 'id-1', env: envWith(nextKey) }), 'DECRYPT_FAILED');
});

test('plaintext legacy values pass through unchanged', () => {
  const env = envWith(newKey());
  assert.equal(isEncrypted(PLAIN), false);
  assert.equal(decryptCredentials(PLAIN, { aad: 'id-1', env }), PLAIN);
  assert.deepEqual(decryptCredentialsWithKeyInfo('{}', { aad: 'x', env: envWith(undefined) }), { plaintext: '{}', key: 'none' });
});

test('key validation rejects short, non-base64 and orphan previous keys without echoing the value', () => {
  const bad = ['short', randomBytes(16).toString('base64'), randomBytes(33).toString('base64'), `${newKey()}!!`, 'not base64 at all=='];
  for (const value of bad) {
    try {
      encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(value) });
      assert.fail('expected an invalid key error');
    } catch (error) {
      assert.ok(error instanceof SecretBoxError);
      assert.equal(error.code, 'KEY_INVALID');
      assert.ok(!error.message.includes(value), 'the key value must not be echoed');
    }
  }
  expectCode(() => encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(undefined, newKey()) }), 'KEY_INVALID');
  expectCode(() => encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(newKey(), 'bad') }), 'KEY_INVALID');
});

test('error messages never contain the secret, the key or the ciphertext', () => {
  const key = newKey();
  const other = newKey();
  const stored = encryptCredentials(PLAIN, { aad: 'id-1', env: envWith(key) });
  try {
    decryptCredentials(stored, { aad: 'id-1', env: envWith(other) });
    assert.fail('expected failure');
  } catch (error) {
    const message = (error as Error).message;
    for (const leaked of [key, other, stored, 'cs_secret_value', stored.split(':')[4]!]) {
      assert.ok(!message.includes(leaked));
    }
  }
});

test('credentialsKeyStatus reports which keys are set', () => {
  assert.deepEqual(credentialsKeyStatus(envWith(undefined)), { configured: false, previousConfigured: false });
  assert.deepEqual(credentialsKeyStatus(envWith('  ')), { configured: false, previousConfigured: false });
  assert.deepEqual(credentialsKeyStatus(envWith(newKey())), { configured: true, previousConfigured: false });
  assert.deepEqual(credentialsKeyStatus(envWith(newKey(), newKey())), { configured: true, previousConfigured: true });
});
