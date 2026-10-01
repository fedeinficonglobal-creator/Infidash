import assert from 'node:assert/strict';
import test from 'node:test';
import { getBootstrapUsers, getDefaultAccountsWarning } from '../src/lib/bootstrapUsers.js';

test('default seed passwords outside production produce one loud warning naming the accounts', () => {
  const env = {};
  const warning = getDefaultAccountsWarning(env, getBootstrapUsers(env, false));
  assert.ok(warning);
  assert.match(warning, /admin@infidash\.local/);
  assert.match(warning, /viewer@infidash\.local/);
  assert.match(warning, /NODE_ENV=production/);
  assert.match(warning, /INFIDASH_ADMIN_PASSWORD/);
});

test('only the accounts still using default passwords are named', () => {
  const env = { INFIDASH_ADMIN_PASSWORD: 'a-custom-admin-password' };
  const warning = getDefaultAccountsWarning(env, getBootstrapUsers(env, false));
  assert.ok(warning);
  assert.doesNotMatch(warning, /admin@infidash\.local/);
  assert.match(warning, /viewer@infidash\.local/);
});

test('no warning with custom passwords, in production, or in test mode', () => {
  const custom = { INFIDASH_ADMIN_PASSWORD: 'a-custom-admin-password', INFIDASH_VIEWER_PASSWORD: 'a-custom-viewer-password' };
  assert.equal(getDefaultAccountsWarning(custom, getBootstrapUsers(custom, false)), null);
  const production = { NODE_ENV: 'production', INFIDASH_ADMIN_PASSWORD: 'strong-env-secret' };
  assert.equal(getDefaultAccountsWarning(production, getBootstrapUsers(production, false)), null);
  const testEnv = { NODE_ENV: 'test' };
  assert.equal(getDefaultAccountsWarning(testEnv, getBootstrapUsers(testEnv, false)), null);
});

test('no warning when no default account would be created', () => {
  const env = { INFIDASH_VIEWER_PASSWORD: 'a-custom-viewer-password' };
  assert.equal(getDefaultAccountsWarning(env, getBootstrapUsers(env, true)), null);
});
