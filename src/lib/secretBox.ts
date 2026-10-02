import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Application-level encryption of integrations.credentials_json (AES-256-GCM). Pure module: no database access.
// Stored format, in the same TEXT column:  enc:v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>
// The integration id is bound as GCM additional authenticated data (AAD), so a ciphertext copied to another row
// fails to decrypt. Error messages never include secrets, key material or ciphertext.

export const SECRET_KEY_ENV = 'INFIDASH_CREDENTIALS_KEY';
export const SECRET_KEY_PREVIOUS_ENV = 'INFIDASH_CREDENTIALS_KEY_PREVIOUS';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type SecretBoxEnv = Record<string, string | undefined>;

export type SecretBoxErrorCode = 'KEY_INVALID' | 'KEY_MISSING' | 'DECRYPT_FAILED' | 'FORMAT_INVALID';

export class SecretBoxError extends Error {
  readonly code: SecretBoxErrorCode;

  constructor(code: SecretBoxErrorCode, message: string) {
    super(message);
    this.name = 'SecretBoxError';
    this.code = code;
  }
}

export interface SecretBoxOptions {
  /** Additional authenticated data: the integration id the ciphertext belongs to. */
  aad: string;
  env?: SecretBoxEnv;
}

export type SecretKeyUsed = 'current' | 'previous' | 'none';

function readVariable(env: SecretBoxEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parseKey(name: string, value: string): Buffer {
  const decoded = BASE64.test(value) ? Buffer.from(value, 'base64') : null;
  if (!decoded || decoded.length !== KEY_BYTES) {
    throw new SecretBoxError('KEY_INVALID', `${name} no es válida: debe ser base64 de exactamente ${KEY_BYTES} bytes (genera una con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))").`);
  }
  return decoded;
}

/** Reports which keys are set (non-blank) without validating them. */
export function credentialsKeyStatus(env: SecretBoxEnv = process.env) {
  return {
    configured: readVariable(env, SECRET_KEY_ENV) !== undefined,
    previousConfigured: readVariable(env, SECRET_KEY_PREVIOUS_ENV) !== undefined,
  };
}

/** Parses and validates the configured keys. Throws KEY_INVALID on a malformed key or a previous key without a current one. */
export function loadSecretKeys(env: SecretBoxEnv = process.env): { current: Buffer | null; previous: Buffer | null } {
  const currentValue = readVariable(env, SECRET_KEY_ENV);
  const previousValue = readVariable(env, SECRET_KEY_PREVIOUS_ENV);
  if (!currentValue && previousValue) {
    throw new SecretBoxError('KEY_INVALID', `${SECRET_KEY_PREVIOUS_ENV} requiere que ${SECRET_KEY_ENV} también esté configurada.`);
  }
  return {
    current: currentValue ? parseKey(SECRET_KEY_ENV, currentValue) : null,
    previous: previousValue ? parseKey(SECRET_KEY_PREVIOUS_ENV, previousValue) : null,
  };
}

/** True when the stored text is an `enc:v1:` ciphertext (anything else is legacy plaintext JSON). */
export function isEncrypted(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(PREFIX);
}

export function encryptCredentials(plainJson: string, options: SecretBoxOptions): string {
  const { current } = loadSecretKeys(options.env);
  if (!current) {
    throw new SecretBoxError('KEY_MISSING', `${SECRET_KEY_ENV} no está configurada: no se pueden cifrar credenciales.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', current, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(options.aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plainJson, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

function tryDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Like decryptCredentials, but also reports which key opened the value ('none' for passthrough plaintext). */
export function decryptCredentialsWithKeyInfo(text: string, options: SecretBoxOptions): { plaintext: string; key: SecretKeyUsed } {
  if (!isEncrypted(text)) {
    return { plaintext: text, key: 'none' };
  }

  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3 || parts.some((part) => !BASE64.test(part))) {
    throw new SecretBoxError('FORMAT_INVALID', 'Las credenciales cifradas tienen un formato inválido.');
  }
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64')) as [Buffer, Buffer, Buffer];
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('FORMAT_INVALID', 'Las credenciales cifradas tienen un formato inválido.');
  }

  const { current, previous } = loadSecretKeys(options.env);
  if (!current) {
    throw new SecretBoxError('KEY_MISSING', `Hay credenciales cifradas pero ${SECRET_KEY_ENV} no está configurada.`);
  }
  const withCurrent = tryDecrypt(current, iv, tag, ciphertext, options.aad);
  if (withCurrent !== null) return { plaintext: withCurrent, key: 'current' };
  if (previous) {
    const withPrevious = tryDecrypt(previous, iv, tag, ciphertext, options.aad);
    if (withPrevious !== null) return { plaintext: withPrevious, key: 'previous' };
  }
  throw new SecretBoxError('DECRYPT_FAILED', 'No se pudieron descifrar las credenciales: la clave es incorrecta o los datos fueron alterados.');
}

/** Returns the original JSON text. Plaintext legacy values (no `enc:v1:` prefix) pass through unchanged. */
export function decryptCredentials(text: string, options: SecretBoxOptions): string {
  return decryptCredentialsWithKeyInfo(text, options).plaintext;
}
