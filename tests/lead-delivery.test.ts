import assert from 'node:assert/strict';
import test from 'node:test';
import { readLeadDeliveryIdentity, leadDedupeKey } from '../src/lib/leadDelivery.js';

test('legacy form payloads remain accepted without unsafe content-hash deduplication', () => {
  assert.equal(readLeadDeliveryIdentity({ name: 'Ana', email: 'ana@example.test' }), null);
});

test('explicit provider, form and submission ID make a stable scoped key', () => {
  const fluent = readLeadDeliveryIdentity({ infidash_provider: 'fluent_forms', infidash_form_id: '12', infidash_delivery_id: '501' });
  assert.deepEqual(fluent, { provider: 'fluent_forms', formId: '12', deliveryId: '501' });
  assert.deepEqual(readLeadDeliveryIdentity({ infidash_provider: 'fluent_forms', infidash_form_id: 12, infidash_delivery_id: 501 }), fluent);
  assert.equal(leadDedupeKey(fluent!), leadDedupeKey({ provider: 'fluent_forms', formId: '12', deliveryId: '501' }));
  assert.notEqual(leadDedupeKey(fluent!), leadDedupeKey({ provider: 'contact_form_7', formId: '12', deliveryId: '501' }));
  assert.notEqual(leadDedupeKey(fluent!), leadDedupeKey({ provider: 'fluent_forms', formId: '13', deliveryId: '501' }));
});

test('partial or malformed delivery metadata is rejected, not silently deduplicated', () => {
  for (const payload of [
    { infidash_provider: 'fluent_forms' },
    { infidash_delivery_id: '501' },
    { infidash_provider: 'fluent_forms', infidash_delivery_id: '501' },
    { infidash_provider: 'unknown', infidash_delivery_id: '501' },
    { infidash_provider: 'contact_form_7', infidash_delivery_id: '' },
    { infidash_provider: 'fluent_forms', infidash_delivery_id: ['501'] },
  ]) assert.throws(() => readLeadDeliveryIdentity(payload));
});
