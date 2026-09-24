import { isIP } from 'node:net';

export interface WooCommerceCredentials {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface WooCommerceOrderSummary {
  id: number;
  status: string;
  currency: string;
  total: string;
  totalTax: string;
  shippingTotal: string;
  dateCreated: string;
  dateCreatedGmt: string;
  dateModifiedGmt: string;
  refunds: Array<{ id: number; total: string }>;
}

export type WooRefundPolicy = 'subtract' | 'ignore';

export interface CompletedOrderSalesSummary extends CompletedOrderGrossSummary {
  purchaseDate: string;
  refundTotal: string;
  salesTotal: string;
}

export function parseWooRefundPolicy(value: unknown): WooRefundPolicy {
  if (value === 'subtract' || value === 'ignore') return value;
  throw new Error('Política de reembolsos WooCommerce inválida');
}

export interface CompletedOrderGrossSummary {
  currency: string;
  orderCount: number;
  grossTotal: string;
  includedTax: string;
  includedShipping: string;
}

// WooCommerce's order total is the grand total: tax and shipping are already
// included. Summing those components into total again would double-count them.
function sumDecimalStrings(values: string[]) {
  const precision = Math.max(2, ...values.map((value) => value.split('.')[1]?.length ?? 0));
  const scale = 10n ** BigInt(precision);
  const sum = values.reduce((acc, value) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Pedido WooCommerce con importe inválido');
    const [whole, fraction = ''] = value.split('.');
    return acc + BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0'));
  }, 0n);
  const whole = sum / scale;
  const fraction = String(sum % scale).padStart(precision, '0');
  return `${whole}.${fraction}`;
}

function subtractDecimalStrings(total: string, deduction: string) {
  const precision = Math.max(2, total.split('.')[1]?.length ?? 0, deduction.split('.')[1]?.length ?? 0);
  const scale = 10n ** BigInt(precision);
  const units = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0'));
  };
  const result = units(total) - units(deduction);
  if (result < 0n) throw new Error('Los reembolsos superan el importe del pedido WooCommerce');
  return `${result / scale}.${String(result % scale).padStart(precision, '0')}`;
}

function latestOrders(orders: WooCommerceOrderSummary[]) {
  const latestById = new Map<number, WooCommerceOrderSummary>();
  for (const order of orders) {
    const previous = latestById.get(order.id);
    if (previous && order.dateModifiedGmt === previous.dateModifiedGmt &&
        (order.status !== previous.status || order.currency !== previous.currency || order.total !== previous.total ||
         order.totalTax !== previous.totalTax || order.shippingTotal !== previous.shippingTotal ||
         order.dateCreated !== previous.dateCreated || order.dateCreatedGmt !== previous.dateCreatedGmt ||
         JSON.stringify(order.refunds) !== JSON.stringify(previous.refunds))) {
      throw new Error('Pedido WooCommerce duplicado con datos contradictorios');
    }
    if (!previous || order.dateModifiedGmt > previous.dateModifiedGmt) latestById.set(order.id, order);
  }
  return [...latestById.values()];
}

/** Gross completed-order totals before refunds, separated by original currency. */
export function summarizeCompletedOrderGross(orders: WooCommerceOrderSummary[]): CompletedOrderGrossSummary[] {
  const byCurrency = new Map<string, WooCommerceOrderSummary[]>();
  for (const order of latestOrders(orders)) {
    if (order.status !== 'completed') continue;
    const group = byCurrency.get(order.currency) ?? [];
    group.push(order);
    byCurrency.set(order.currency, group);
  }
  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => ({
    currency,
    orderCount: group.length,
    grossTotal: sumDecimalStrings(group.map((order) => order.total)),
    includedTax: sumDecimalStrings(group.map((order) => order.totalTax)),
    includedShipping: sumDecimalStrings(group.map((order) => order.shippingTotal)),
  }));
}

/** Use WooCommerce's site-local purchase date, never refund or sync date. */
export function summarizeCompletedOrderSales(
  orders: WooCommerceOrderSummary[],
  refundPolicy: WooRefundPolicy,
): CompletedOrderSalesSummary[] {
  parseWooRefundPolicy(refundPolicy);
  const groups = new Map<string, WooCommerceOrderSummary[]>();
  for (const order of latestOrders(orders)) {
    if (order.status !== 'completed') continue;
    const key = `${order.dateCreated.slice(0, 10)}|${order.currency}`;
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const [purchaseDate, currency] = key.split('|');
    const refundAmounts = group.flatMap((order) => order.refunds.map((refund) => refund.total.slice(1)));
    const grossTotal = sumDecimalStrings(group.map((order) => order.total));
    const refundTotal = sumDecimalStrings(refundAmounts);
    return {
      purchaseDate, currency, orderCount: group.length, grossTotal,
      includedTax: sumDecimalStrings(group.map((order) => order.totalTax)),
      includedShipping: sumDecimalStrings(group.map((order) => order.shippingTotal)),
      refundTotal,
      salesTotal: refundPolicy === 'subtract' ? subtractDecimalStrings(grossTotal, refundTotal) : grossTotal,
    };
  });
}

function ordersEndpoint(storeUrl: string) {
  const url = new URL(storeUrl);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || !host.includes('.') || host === 'localhost' ||
      /\.(local|internal|localhost)$/.test(host) || isIP(host)) {
    throw new Error('La tienda debe usar una URL HTTPS pública sin credenciales ni parámetros');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/wp-json/wc/v3/orders`;
  url.searchParams.set('per_page', '1');
  url.searchParams.set('page', '1');
  return url.toString();
}

export async function probeWooCommerceOrders(input: WooCommerceCredentials, fetchImpl: typeof fetch = globalThis.fetch) {
  let url: string;
  try { url = ordersEndpoint(input.storeUrl); }
  catch { return { ok: false, error: 'La tienda debe usar una URL HTTPS pública sin credenciales ni parámetros' }; }
  if (!input.consumerKey.trim() || !input.consumerSecret.trim()) {
    return { ok: false, error: 'Faltan las credenciales de WooCommerce' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const headers = new Headers({ accept: 'application/json' });
    headers.set('authorization', `Basic ${Buffer.from(`${input.consumerKey}:${input.consumerSecret}`).toString('base64')}`);
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
    if (!response.ok) return { ok: false, error: `WooCommerce respondió HTTP ${response.status}` };
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return { ok: false, error: 'WooCommerce no devolvió una lista de pedidos válida' };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'No se pudo conectar de forma segura con WooCommerce' };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOrder(value: unknown): WooCommerceOrderSummary {
  const order = value as Record<string, unknown>;
  const money = (field: string) => {
    const raw = order[field];
    if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Pedido WooCommerce con importe inválido');
    return raw;
  };
  const date = (field: string) => {
    const raw = order[field];
    if (typeof raw !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(raw) ||
        Number.isNaN(Date.parse(`${raw}Z`)) || new Date(`${raw}Z`).toISOString().slice(0, 19) !== raw) {
      throw new Error('Pedido WooCommerce sin fecha de compra o GMT válida');
    }
    return raw;
  };
  if (!Array.isArray(order.refunds)) throw new Error('Pedido WooCommerce sin lista de reembolsos válida');
  const refundIds = new Set<number>();
  const refunds = order.refunds.map((value: unknown) => {
    const refund = value as Record<string, unknown>;
    if (!refund || !Number.isSafeInteger(refund.id) || Number(refund.id) < 1 || refundIds.has(Number(refund.id)) ||
        typeof refund.total !== 'string' || !/^-\d+(?:\.\d+)?$/.test(refund.total)) {
      throw new Error('Pedido WooCommerce con reembolso inválido');
    }
    refundIds.add(Number(refund.id));
    return { id: Number(refund.id), total: refund.total };
  });
  if (!Number.isSafeInteger(order.id) || Number(order.id) < 1 || typeof order.status !== 'string' ||
      typeof order.currency !== 'string' || !/^[A-Z]{3}$/.test(order.currency)) {
    throw new Error('Pedido WooCommerce con identidad, estado o moneda inválidos');
  }
  return {
    id: order.id as number,
    status: order.status,
    currency: order.currency,
    total: money('total'),
    totalTax: money('total_tax'),
    shippingTotal: money('shipping_total'),
    dateCreated: date('date_created'),
    dateCreatedGmt: `${date('date_created_gmt')}Z`,
    dateModifiedGmt: `${date('date_modified_gmt')}Z`,
    refunds,
  };
}

export async function fetchWooCommerceOrderSummaries(
  input: WooCommerceCredentials,
  range: { modifiedAfter: string; modifiedBefore: string; maxPages: number },
  fetchImpl: typeof fetch = globalThis.fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  if (!Number.isInteger(range.maxPages) || range.maxPages < 1 || range.maxPages > 20 ||
      !Number.isFinite(Date.parse(range.modifiedAfter)) || !Number.isFinite(Date.parse(range.modifiedBefore)) ||
      Date.parse(range.modifiedAfter) >= Date.parse(range.modifiedBefore)) {
    throw new Error('Rango o límite de páginas WooCommerce inválido');
  }
  return fetchOrderPages(input, {
    modified_after: range.modifiedAfter,
    modified_before: range.modifiedBefore,
    dates_are_gmt: 'true',
    orderby: 'modified',
    order: 'asc',
  }, range.maxPages, fetchImpl, sleep);
}

export async function fetchWooCommercePurchaseWindow(
  input: WooCommerceCredentials,
  range: { from: string; to: string; maxPages: number },
  fetchImpl: typeof fetch = globalThis.fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const validDate = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(range.from) || !validDate(range.to) ||
      !Number.isInteger(range.maxPages) || range.maxPages < 1 || range.maxPages > 20 ||
      Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`) > 30 * 86_400_000 ||
      range.from > range.to) {
    throw new Error('Ventana de compra inválida: usa hasta 31 días y 20 páginas');
  }
  const adjacentDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString().slice(0, 10);
  const orders = await fetchOrderPages(input, {
    after: `${adjacentDate(range.from, -1)}T23:59:59`,
    before: `${adjacentDate(range.to, 1)}T00:00:00`,
    dates_are_gmt: 'false',
    orderby: 'id',
    order: 'asc',
  }, range.maxPages, fetchImpl, sleep);
  return orders.filter((order) => order.dateCreated.slice(0, 10) >= range.from && order.dateCreated.slice(0, 10) <= range.to);
}

async function fetchOrderPages(
  input: WooCommerceCredentials,
  query: Record<string, string>,
  maxPages: number,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
) {
  if (!input.consumerKey.trim() || !input.consumerSecret.trim()) throw new Error('Faltan las credenciales de WooCommerce');
  const url = new URL(ordersEndpoint(input.storeUrl));
  url.searchParams.set('per_page', '100');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers = new Headers({ accept: 'application/json' });
  headers.set('authorization', `Basic ${Buffer.from(`${input.consumerKey}:${input.consumerSecret}`).toString('base64')}`);
  const orders: WooCommerceOrderSummary[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    url.searchParams.set('page', String(page));
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
      } catch {
        if (attempt === 2) throw new Error('No se pudo leer la página de pedidos WooCommerce');
      } finally {
        clearTimeout(timeout);
      }
      if (response && ![429, 502, 503, 504].includes(response.status)) break;
      if (attempt < 2) {
        const retryAfter = Number(response?.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter >= 0 && response?.headers.has('retry-after')
          ? Math.min(retryAfter * 1000, 5_000)
          : 500 * (2 ** attempt);
        await sleep(delay);
      }
    }
    if (!response) throw new Error('No se pudo leer la página de pedidos WooCommerce');
    if (!response.ok) throw new Error(`WooCommerce respondió HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('WooCommerce no devolvió una lista de pedidos válida');
    orders.push(...body.map(normalizeOrder));
    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    if (Number.isInteger(totalPages) && totalPages > maxPages) throw new Error('El rango excede el límite de páginas; divídelo en intervalos más pequeños');
    if (Number.isInteger(totalPages) && totalPages >= 1 ? page >= totalPages : body.length < 100) return orders;
  }
  throw new Error('La paginación WooCommerce no terminó dentro del límite');
}
