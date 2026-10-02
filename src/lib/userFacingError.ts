/**
 * Error whose message is written by our own code, in Spanish, for the person using the API.
 *
 * Sanitization rule for HTTP handlers: a caught error's message is sent to the client only
 * when it is a `UserFacingError` (validators, provider failures meant for the admin).
 * Everything else (psql/pg_dump output, TypeErrors, filesystem errors...) may contain SQL,
 * connection strings or paths, so handlers must answer with a generic message and log
 * the real error with the structured logger (`request.log` / `logger`). Use `publicErrorMessage` to apply the rule.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  return error instanceof UserFacingError ? error.message : fallback;
}
