import { createHash, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './repository.js';

export interface ServicePrincipal {
  id: string;
  name: string;
  scopes: string[];
  allowedClientIds: string[];
}

export function hashServiceToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function equalHash(left: string, right: string) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticateServiceToken(queryable: Queryable, token: string): Promise<ServicePrincipal | null> {
  if (!token || token.length > 512) return null;
  const hash = hashServiceToken(token);
  const result = await queryable.query(
    `SELECT id, name, token_hash, scopes, allowed_client_ids FROM editorial.service_tokens
     WHERE token_hash = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`, [hash],
  );
  const row = result.rows[0] as any;
  if (!row || !equalHash(hash, row.token_hash)) return null;
  void queryable.query('UPDATE editorial.service_tokens SET last_used_at = now() WHERE id = $1', [row.id]).catch(() => undefined);
  return { id: row.id, name: row.name, scopes: row.scopes ?? [], allowedClientIds: row.allowed_client_ids ?? [] };
}

export function serviceCan(principal: ServicePrincipal, scope: string, clientId?: string | null) {
  const scoped = principal.scopes.includes('*') || principal.scopes.includes(scope);
  const clientAllowed = !clientId || principal.allowedClientIds.includes('*') || principal.allowedClientIds.includes(clientId);
  return scoped && clientAllowed;
}
