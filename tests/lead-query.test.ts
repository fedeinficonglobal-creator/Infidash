import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLeadQuery } from '../src/lib/leadQuery.js';

test('lead query defaults to a bounded first page', () => {
  assert.deepEqual(parseLeadQuery({}), { limit: 50, offset: 0, status: null, source: null });
});

test('lead query accepts bounded pages and filters', () => {
  assert.deepEqual(parseLeadQuery({ limit: '100', offset: '200', status: 'closed', source: ' WordPress ' }), {
    limit: 100, offset: 200, status: 'closed', source: 'WordPress',
  });
});

test('lead query rejects malformed or unbounded requests', () => {
  for (const query of [
    { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { offset: '-1' },
    { offset: '1e6' }, { status: 'unknown' }, { source: 'x'.repeat(101) },
    { source: ['WordPress'] },
  ]) assert.throws(() => parseLeadQuery(query));
});

test('lead filters reject arrays and objects instead of coercing them', () => {
  assert.throws(() => parseLeadQuery({ status: ['new'] }));
  assert.throws(() => parseLeadQuery({ source: { value: 'WordPress' } }));
});
