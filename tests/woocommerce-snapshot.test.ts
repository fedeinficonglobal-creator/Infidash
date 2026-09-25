import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateWooCommerceSnapshot, wooCommerceSourceKey } from '../src/lib/woocommerceSnapshot.js';
import type { WooCommerceOrderSummary } from '../src/lib/woocommerce.js';

const order: WooCommerceOrderSummary = {
  id: 45, status: 'completed', currency: 'EUR', total: '120.00', totalTax: '20.00', shippingTotal: '0.00',
  dateCreated: '2026-09-24T11:00:00', dateCreatedGmt: '2026-09-24T09:00:00Z',
  dateModifiedGmt: '2026-09-24T09:00:00Z', refunds: [],
};

test('Woo snapshot source identity is stable and scoped to the store URL, not credentials', () => {
  const source = 'https://shop.example/wp';
  assert.equal(wooCommerceSourceKey(source), wooCommerceSourceKey(`${source}/`));
  assert.notEqual(wooCommerceSourceKey(source), wooCommerceSourceKey('https://other.example/wp'));
  assert.throws(() => wooCommerceSourceKey('http://shop.example'), /HTTPS/);
});

test('Woo snapshots reject duplicate orders and purchase dates outside the fully fetched window', () => {
  assert.deepEqual(validateWooCommerceSnapshot({ from: '2026-09-24', to: '2026-09-24', orders: [order] }), [order]);
  assert.throws(() => validateWooCommerceSnapshot({ from: '2026-09-24', to: '2026-09-24', orders: [order, order] }), /duplicados/);
  assert.throws(() => validateWooCommerceSnapshot({ from: '2026-09-25', to: '2026-09-25', orders: [order] }), /fuera/);
});
