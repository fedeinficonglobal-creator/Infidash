import { createHash } from 'node:crypto';
import type { WooCommerceOrderSummary } from './woocommerce.js';

/** Stable, non-secret source identifier. Credentials are deliberately excluded. */
export function wooCommerceSourceKey(storeUrl: string) {
  const url = new URL(storeUrl);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('La tienda WooCommerce debe usar una URL HTTPS válida');
  }
  const source = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return createHash('sha256').update(source).digest('hex');
}

export function validateWooCommerceSnapshot(input: {
  from: string;
  to: string;
  orders: WooCommerceOrderSummary[];
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) {
    throw new Error('Ventana de compra inválida');
  }
  const ids = new Set<number>();
  for (const order of input.orders) {
    if (!Number.isSafeInteger(order.id) || ids.has(order.id) ||
        order.dateCreated.slice(0, 10) < input.from || order.dateCreated.slice(0, 10) > input.to) {
      throw new Error('La respuesta WooCommerce contiene pedidos duplicados o fuera de la ventana');
    }
    ids.add(order.id);
  }
  return input.orders;
}
