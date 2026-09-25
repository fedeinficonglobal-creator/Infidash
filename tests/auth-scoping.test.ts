import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessClient } from '../src/lib/auth.js';

test('admins can access any client regardless of clientIds', () => {
  assert.equal(canAccessClient({ role: 'admin', clientIds: null }, 'client-a'), true);
  assert.equal(canAccessClient({ role: 'admin', clientIds: [] }, 'client-a'), true);
  assert.equal(canAccessClient({ role: 'admin', clientIds: ['client-b'] }, 'client-a'), true);
});

test('viewers can only access clients in their allow-list', () => {
  assert.equal(canAccessClient({ role: 'viewer', clientIds: ['client-a'] }, 'client-a'), true);
  assert.equal(canAccessClient({ role: 'viewer', clientIds: ['client-a'] }, 'client-b'), false);
});

test('a viewer with an empty allow-list can access nothing', () => {
  assert.equal(canAccessClient({ role: 'viewer', clientIds: [] }, 'client-a'), false);
});

test('a viewer with a null allow-list (malformed session) fails closed', () => {
  assert.equal(canAccessClient({ role: 'viewer', clientIds: null }, 'client-a'), false);
});
