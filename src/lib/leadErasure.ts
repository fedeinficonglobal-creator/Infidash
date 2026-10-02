import { createHash } from 'node:crypto';
import type { CoreQueryable } from './corePool.js';

/**
 * Right-to-erasure helper for leads (see docs/gdpr-retention.md). The CLI (scripts/erase-lead.ts) is a thin wrapper:
 * argument parsing, e-mail normalization and hashing live here so they are testable without PostgreSQL.
 */

export const MAX_ERASURE_NOTE_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EraseArgsError extends Error {}

export interface EraseArgs {
  email: string;
  clientId: string | null;
  apply: boolean;
  note: string;
}

/** Trimmed, lowercased e-mail, or null when it is not a plausible address. */
export function normalizeErasureEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

/** Short sha256 prefix of the lowercased e-mail: lets the log line be correlated with a request without storing the address. */
export function hashEmailForLog(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

export function parseEraseArgs(argv: string[]): EraseArgs {
  let email: string | null = null;
  let clientId: string | null = null;
  let apply = false;
  let note = '';

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else if (arg.startsWith('--email=')) {
      email = normalizeErasureEmail(arg.slice('--email='.length));
      if (!email) throw new EraseArgsError('El valor de --email no es una direccion de correo valida');
    } else if (arg.startsWith('--client=')) {
      clientId = arg.slice('--client='.length).trim();
      if (!clientId) throw new EraseArgsError('--client no puede estar vacio');
    } else if (arg.startsWith('--note=')) {
      note = arg.slice('--note='.length).trim();
      if (note.length > MAX_ERASURE_NOTE_LENGTH) throw new EraseArgsError(`--note admite como maximo ${MAX_ERASURE_NOTE_LENGTH} caracteres`);
    } else {
      throw new EraseArgsError(`Argumento no reconocido: ${arg.split('=')[0]}`);
    }
  }

  if (!email) throw new EraseArgsError('Falta --email=<correo>');
  return { email, clientId, apply, note };
}

/** Ids of the leads whose e-mail matches (case-insensitive, exact), optionally restricted to one client. */
export async function findLeadIdsByEmail(db: CoreQueryable, email: string, clientId: string | null): Promise<string[]> {
  const result = clientId
    ? await db.query(`SELECT id FROM leads WHERE lower(btrim(email)) = $1 AND client_id = $2 ORDER BY received_at, id`, [email, clientId])
    : await db.query(`SELECT id FROM leads WHERE lower(btrim(email)) = $1 ORDER BY received_at, id`, [email]);
  return result.rows.map((row: { id: string }) => row.id);
}

/** Deletes the matching leads and returns their ids. Run it on a transaction client to keep the operation atomic. */
export async function eraseLeadsByEmail(db: CoreQueryable, email: string, clientId: string | null): Promise<string[]> {
  const result = clientId
    ? await db.query(`DELETE FROM leads WHERE lower(btrim(email)) = $1 AND client_id = $2 RETURNING id`, [email, clientId])
    : await db.query(`DELETE FROM leads WHERE lower(btrim(email)) = $1 RETURNING id`, [email]);
  return result.rows.map((row: { id: string }) => row.id);
}
