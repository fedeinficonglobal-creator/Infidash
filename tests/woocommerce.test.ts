import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWooCommerceOrderSummaries, fetchWooCommercePurchaseWindow, parseWooRefundPolicy, probeWooCommerceOrders, summarizeCompletedOrderGross, summarizeCompletedOrderSales, type WooCommerceOrderSummary } from '../src/lib/woocommerce.js';

test('WooCommerce probe uses read-only v3 orders endpoint and HTTPS basic auth', async () => {
  let seenUrl = '';
  let seenAuthorization = '';
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    seenAuthorization = new Headers(init?.headers).get('authorization') ?? '';
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await probeWooCommerceOrders({ storeUrl: 'https://shop.example.com/', consumerKey: 'ck_test', consumerSecret: 'cs_test' }, fetchMock as typeof fetch);
  assert.deepEqual(result, { ok: true, error: null });
  assert.equal(seenUrl, 'https://shop.example.com/wp-json/wc/v3/orders?per_page=1&page=1');
  assert.equal(seenAuthorization, `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`);
});

test('WooCommerce reader paginates bounded modified orders and discards customer data', async () => {
  const urls: string[] = [];
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url);
    const page = new URL(url).searchParams.get('page');
    const order = { id: Number(page), status: 'processing', currency: 'EUR', total: '12.50', total_tax: '2.17', shipping_total: '3.00', date_created: '2026-09-01T12:00:00', date_created_gmt: '2026-09-01T10:00:00', date_modified_gmt: '2026-09-23T10:00:00', refunds: [{ id: 8, total: '-1.25', reason: 'private' }], billing: { email: 'private@example.com' } };
    return new Response(JSON.stringify([order]), { status: 200, headers: { 'x-wp-totalpages': '2' } });
  };
  const orders = await fetchWooCommerceOrderSummaries({ storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' }, { modifiedAfter: '2026-09-01T00:00:00Z', modifiedBefore: '2026-09-30T23:59:59Z', maxPages: 2 }, fetchMock as typeof fetch);
  assert.deepEqual(orders.map((order) => order.id), [1, 2]);
  assert.ok(urls.every((url) => url.includes('modified_after=') && url.includes('dates_are_gmt=true')));
  assert.equal(JSON.stringify(orders).includes('private@example.com'), false);
  assert.equal(orders[0].total, '12.50');
  assert.equal(orders[0].dateCreated, '2026-09-01T12:00:00');
  assert.deepEqual(orders[0].refunds, [{ id: 8, total: '-1.25' }]);
});

test('WooCommerce probe rejects unsafe origins and never leaks secrets in failures', async () => {
  const failFetch = async () => new Response('unauthorized ck_test cs_test', { status: 401 });
  const unsafe = await probeWooCommerceOrders({ storeUrl: 'http://127.0.0.1:8080', consumerKey: 'ck_test', consumerSecret: 'cs_test' }, failFetch as typeof fetch);
  assert.equal(unsafe.ok, false);
  const denied = await probeWooCommerceOrders({ storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' }, failFetch as typeof fetch);
  assert.equal(denied.ok, false);
  assert.doesNotMatch(denied.error ?? '', /ck_test|cs_test/);
});

test('completed-order gross sums the grand total once, including VAT and shipping', () => {
  const base: WooCommerceOrderSummary = {
    id: 1, status: 'completed', currency: 'EUR', total: '121.00', totalTax: '21.00',
    shippingTotal: '10.00', dateCreated: '2026-09-01T12:00:00', dateCreatedGmt: '2026-09-01T10:00:00Z', dateModifiedGmt: '2026-09-02T10:00:00Z', refunds: [],
  };
  const orders = [
    base,
    { ...base, id: 2, total: '20.25', totalTax: '3.51', shippingTotal: '0.25' },
    { ...base, id: 3, status: 'processing', total: '500.00' },
    { ...base, id: 4, status: 'cancelled', total: '500.00' },
    { ...base, id: 5, currency: 'USD', total: '8.00', totalTax: '0.00', shippingTotal: '0.00' },
    { ...base, id: 2, status: 'processing', dateModifiedGmt: '2026-09-01T10:00:00Z' },
  ];
  assert.deepEqual(summarizeCompletedOrderGross(orders), [
    { currency: 'EUR', orderCount: 2, grossTotal: '141.25', includedTax: '24.51', includedShipping: '10.25' },
    { currency: 'USD', orderCount: 1, grossTotal: '8.00', includedTax: '0.00', includedShipping: '0.00' },
  ]);
  assert.deepEqual(summarizeCompletedOrderGross([{ ...base, status: 'refunded' }]), []);
});

test('completed-order gross fails closed on conflicting duplicate snapshots', () => {
  const order: WooCommerceOrderSummary = {
    id: 1, status: 'completed', currency: 'EUR', total: '10.00', totalTax: '1.00',
    shippingTotal: '2.00', dateCreated: '2026-09-01T12:00:00', dateCreatedGmt: '2026-09-01T10:00:00Z', dateModifiedGmt: '2026-09-02T10:00:00Z', refunds: [],
  };
  assert.throws(() => summarizeCompletedOrderGross([order, { ...order, total: '11.00' }]), /contradictorios/);
});

test('sales use WooCommerce site-local purchase day and client refund policy without mixing currencies', () => {
  const order: WooCommerceOrderSummary = {
    id: 1, status: 'completed', currency: 'EUR', total: '121.00', totalTax: '21.00', shippingTotal: '10.00',
    dateCreated: '2026-09-01T18:30:00', dateCreatedGmt: '2026-09-01T22:30:00Z', dateModifiedGmt: '2026-09-10T10:00:00Z',
    refunds: [{ id: 10, total: '-20.25' }, { id: 11, total: '-0.75' }],
  };
  const expected = { purchaseDate: '2026-09-01', currency: 'EUR', orderCount: 1, grossTotal: '121.00',
    includedTax: '21.00', includedShipping: '10.00', refundTotal: '21.00' };
  assert.deepEqual(summarizeCompletedOrderSales([order], 'subtract'), [{ ...expected, salesTotal: '100.00' }]);
  assert.deepEqual(summarizeCompletedOrderSales([order], 'ignore'), [{ ...expected, salesTotal: '121.00' }]);
  assert.deepEqual(summarizeCompletedOrderSales([{ ...order, status: 'refunded' }], 'ignore'), []);
  assert.equal(parseWooRefundPolicy('subtract'), 'subtract');
  assert.throws(() => parseWooRefundPolicy('anything'), /inválida/);
});

test('reader rejects malformed refunds instead of silently overstating sales', async () => {
  const fetchMock = async () => new Response(JSON.stringify([{ id: 1, status: 'completed', currency: 'EUR', total: '10.00', total_tax: '1.00', shipping_total: '0.00', date_created: '2026-09-01T12:00:00', date_created_gmt: '2026-09-01T10:00:00', date_modified_gmt: '2026-09-02T10:00:00', refunds: [{ id: 2, total: '2.00' }] }]));
  await assert.rejects(fetchWooCommerceOrderSummaries(
    { storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' },
    { modifiedAfter: '2026-09-01T00:00:00Z', modifiedBefore: '2026-09-30T23:59:59Z', maxPages: 1 },
    fetchMock as typeof fetch,
  ), /reembolso inválido/);
});

test('WooCommerce reader retries bounded rate limits but never retries rejected credentials', async () => {
  let calls = 0;
  const waits: number[] = [];
  const order = { id: 1, status: 'completed', currency: 'EUR', total: '10.00', total_tax: '1.00',
    shipping_total: '0.00', date_created: '2026-09-01T12:00:00', date_created_gmt: '2026-09-01T10:00:00',
    date_modified_gmt: '2026-09-02T10:00:00', refunds: [] };
  const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    return calls === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
      : new Response(JSON.stringify([order]), { status: 200, headers: { 'x-wp-totalpages': '1' } });
  };
  const input = { storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' };
  const range = { modifiedAfter: '2026-09-01T00:00:00Z', modifiedBefore: '2026-09-30T23:59:59Z', maxPages: 1 };
  const orders = await fetchWooCommerceOrderSummaries(input, range, fetchMock as typeof fetch, async (ms) => { waits.push(ms); });
  assert.equal(orders.length, 1);
  assert.deepEqual(waits, [2000]);
  assert.equal(calls, 2);
  let deniedCalls = 0;
  await assert.rejects(fetchWooCommerceOrderSummaries(input, range, (async () => {
    deniedCalls += 1;
    return new Response('', { status: 401 });
  }) as typeof fetch, async () => {}), /HTTP 401/);
  assert.equal(deniedCalls, 1);
});

test('purchase-window reader uses Woo site-local after/before and rejects oversized windows', async () => {
  let seenUrl = '';
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    assert.equal(init?.method, 'GET');
    return new Response('[]', { status: 200, headers: { 'x-wp-totalpages': '1' } });
  };
  const input = { storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' };
  assert.deepEqual(await fetchWooCommercePurchaseWindow(input, { from: '2026-09-01', to: '2026-09-07', maxPages: 2 }, fetchMock as typeof fetch), []);
  const url = new URL(seenUrl);
  assert.equal(url.searchParams.get('after'), '2026-08-31T23:59:59');
  assert.equal(url.searchParams.get('before'), '2026-09-08T00:00:00');
  assert.equal(url.searchParams.get('dates_are_gmt'), 'false');
  assert.equal(url.searchParams.get('modified_after'), null);
  assert.equal(url.searchParams.get('orderby'), 'id');
  await assert.rejects(fetchWooCommercePurchaseWindow(input, { from: '2026-01-01', to: '2026-09-07', maxPages: 2 }, fetchMock as typeof fetch), /Ventana de compra inválida/);
});

test('purchase-window reader excludes Woo boundary spillover by site-local purchase day', async () => {
  const base = { status: 'completed', currency: 'EUR', total: '10.00', total_tax: '1.00', shipping_total: '0.00',
    date_created_gmt: '2026-09-01T10:00:00', date_modified_gmt: '2026-09-02T10:00:00', refunds: [] };
  const fetchMock = async () => new Response(JSON.stringify([
    { ...base, id: 1, date_created: '2026-08-31T23:59:59' },
    { ...base, id: 2, date_created: '2026-09-01T00:00:00' },
    { ...base, id: 3, date_created: '2026-09-07T23:59:59' },
    { ...base, id: 4, date_created: '2026-09-08T00:00:00' },
  ]), { status: 200, headers: { 'x-wp-totalpages': '1' } });
  const orders = await fetchWooCommercePurchaseWindow(
    { storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' },
    { from: '2026-09-01', to: '2026-09-07', maxPages: 1 }, fetchMock as typeof fetch,
  );
  assert.deepEqual(orders.map((order) => order.id), [2, 3]);
});

test('purchase-window reader rejects more pages than the preview limit', async () => {
  const fetchMock = async () => new Response('[]', { status: 200, headers: { 'x-wp-totalpages': '6' } });
  await assert.rejects(fetchWooCommercePurchaseWindow(
    { storeUrl: 'https://shop.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test' },
    { from: '2026-09-01', to: '2026-09-07', maxPages: 5 }, fetchMock as typeof fetch,
  ), /excede el límite de páginas/);
});
