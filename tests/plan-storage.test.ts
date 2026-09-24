import assert from 'node:assert/strict';
import test from 'node:test';
import { canPersistPlanRows } from '../src/lib/planStorage.js';

test('plan rows are not persisted until their loaded client owns the current view', () => {
  assert.equal(canPersistPlanRows('client-a', 'client-b'), false);
  assert.equal(canPersistPlanRows('client-a', null), false);
  assert.equal(canPersistPlanRows('client-a', 'client-a'), true);
});
