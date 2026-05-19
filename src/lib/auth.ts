import * as crypto from 'node:crypto';

const PBKDF2_ITERATIONS = 120_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, iterationsText, salt, hash] = storedHash.split('$');

  if (scheme !== 'pbkdf2' || !iterationsText || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const derived = crypto.pbkdf2Sync(password, salt, iterations, hash.length / 2, DIGEST).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}
