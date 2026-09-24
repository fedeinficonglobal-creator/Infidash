import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginThrottle } from '../src/lib/loginThrottle.js';
import { getBootstrapUsers } from '../src/lib/bootstrapUsers.js';

test('login throttle permits the configured attempts, then blocks until the window expires', () => {
  let now = 1_000;
  const throttle = new LoginThrottle({ maxAttempts: 2, windowMs: 500, now: () => now });
  assert.equal(throttle.check('127.0.0.1').blocked, false);
  throttle.recordFailure('127.0.0.1');
  assert.equal(throttle.check('127.0.0.1').blocked, false);
  throttle.recordFailure('127.0.0.1');
  assert.deepEqual(throttle.check('127.0.0.1'), { blocked: true, retryAfterSeconds: 1 });
  now += 501;
  assert.equal(throttle.check('127.0.0.1').blocked, false);
});

test('successful login clears the IP failure window', () => {
  const throttle = new LoginThrottle({ maxAttempts: 1, windowMs: 1_000, now: () => 1_000 });
  throttle.recordFailure('127.0.0.1');
  throttle.recordSuccess('127.0.0.1');
  assert.equal(throttle.check('127.0.0.1').blocked, false);
});

test('production refuses insecure first-admin defaults and does not create default users alongside existing admin', () => {
  assert.throws(() => getBootstrapUsers({ NODE_ENV: 'production' }, false), /at least 12 characters/);
  assert.throws(() => getBootstrapUsers({ NODE_ENV: 'production', INFIDASH_ADMIN_PASSWORD: 'admin1234' }, false), /at least 12 characters/);
  assert.deepEqual(getBootstrapUsers({ NODE_ENV: 'production' }, true), []);
});

test('production bootstrap uses the explicit admin secret and only seeds an explicitly configured viewer', () => {
  const users = getBootstrapUsers({
    NODE_ENV: 'production',
    INFIDASH_ADMIN_EMAIL: 'OWNER@EXAMPLE.COM',
    INFIDASH_ADMIN_PASSWORD: 'strong-env-secret',
    INFIDASH_VIEWER_PASSWORD: 'strong-viewer-secret',
  }, false);
  assert.deepEqual(users.map(({ email, role, password }) => ({ email, role, password })), [
    { email: 'owner@example.com', role: 'admin', password: 'strong-env-secret' },
    { email: 'viewer@infidash.local', role: 'viewer', password: 'strong-viewer-secret' },
  ]);
});
