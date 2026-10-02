/**
 * Global handling of expired sessions (HTTP 401) and shared request-error helpers.
 * Kept free of other imports so every API helper (core, content, rrss) can use it.
 */

/** Error carrying the HTTP status of a failed API request. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401;
}

/** True for the rejection produced by an aborted fetch; callers must ignore it instead of showing an error. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export type UnauthorizedHandler = (token: string) => void;

let handler: UnauthorizedHandler | null = null;
let notified = false;

export function setUnauthorizedHandler(next: UnauthorizedHandler | null) {
  handler = next;
}

/** Re-arms the once-per-expiry latch; call when a new session starts. */
export function resetUnauthorizedLatch() {
  notified = false;
}

/** Invokes the handler at most once per expiry burst; handler failures never reach the caller. */
export function notifyUnauthorized(token: string) {
  if (!handler || notified) return;
  notified = true;
  try {
    handler(token);
  } catch {
    // The original request must still reject with its own error.
  }
}

function isSessionEndpoint(path: string) {
  const pathname = path.split('?')[0].replace(/\/+$/, '');
  return pathname === '/api/auth/login' || pathname === '/api/auth/logout';
}

/**
 * Called by every authenticated request helper with the response status. Only a 401 on a
 * request that sent a bearer token, outside the login/logout endpoints, means "session expired".
 */
export function interceptUnauthorized(status: number, path: string, token: string | null | undefined) {
  if (status !== 401 || !token || isSessionEndpoint(path)) return;
  notifyUnauthorized(token);
}
