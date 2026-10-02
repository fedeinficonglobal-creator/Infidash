import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DestinationStream, LoggerOptions } from 'pino';
import { pino, stdSerializers, stdTimeFunctions } from 'pino';
import { LogController, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';

/**
 * Structured JSON logging (one line per event, to stdout).
 *
 * - `buildLoggerOptions` is the single source of truth for pino options (level, base fields, timestamps,
 *   serializers, redaction); Fastify's built-in logger and the standalone `logger` share it.
 * - Request logs never include headers or bodies. The URL is sanitized because the public lead webhook
 *   carries its bearer secret in the path (`/api/public/leads/:token`).
 */

export type LogEnv = Record<string, string | undefined>;

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof LEVELS)[number];

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,100}$/;
const REDACTED = '[redacted]';

// Same spirit as redactSecrets in src/server/content/contracts.ts, plus URL-specific names.
const SECRET_QUERY_KEY = /(token|secret|password|passwd|authorization|credential|webhook|api.?key|signature|^sig$|^code$|^key$)/i;
const LEAD_WEBHOOK_PATH = /(\/public\/leads\/)[^?#]*/i;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export function resolveLogLevel(env: LogEnv): LogLevel {
  const raw = (env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (raw) return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
  return env.NODE_ENV === 'test' ? 'silent' : 'info';
}

/** Replaces the lead webhook token segment and the values of secret-looking query params. */
export function sanitizeLogUrl(url: string | undefined): string {
  if (!url) return '';
  const queryStart = url.indexOf('?');
  const path = (queryStart === -1 ? url : url.slice(0, queryStart)).replace(LEAD_WEBHOOK_PATH, `$1${REDACTED}`);
  if (queryStart === -1) return path;
  const query = url.slice(queryStart + 1).split('&').map((pair) => {
    const separator = pair.indexOf('=');
    if (separator === -1) return pair;
    let key = pair.slice(0, separator);
    try { key = decodeURIComponent(key); } catch { /* keep the raw key */ }
    return SECRET_QUERY_KEY.test(key) ? `${pair.slice(0, separator)}=${REDACTED}` : pair;
  }).join('&');
  // A token smuggled into the query string of a lead URL is handled by the key rules above.
  return `${path}?${query.replace(LEAD_WEBHOOK_PATH, `$1${REDACTED}`)}`;
}

function maskCredentials(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(URL_CREDENTIALS, `$1${REDACTED}@`) : value;
}

/** Standard pino error serializer that also masks `scheme://user:password@host` credentials. */
function serializeError(error: unknown) {
  const serialized = stdSerializers.err(error as Error) as unknown;
  if (!serialized || typeof serialized !== 'object') return serialized;
  const record = { ...(serialized as Record<string, unknown>) };
  if ('message' in record) record.message = maskCredentials(record.message);
  if ('stack' in record) record.stack = maskCredentials(record.stack);
  return record;
}

// Defensive: request/response objects are already reduced by the serializers below, but ad-hoc log objects
// could still carry these keys.
const REDACT_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-service-token"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-service-token"]',
  'res.headers["set-cookie"]',
  'req.body',
  'res.body',
  'req.query',
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'apiKey',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.credentials',
];

export function buildLoggerOptions(env: LogEnv): LoggerOptions {
  return {
    level: resolveLogLevel(env),
    base: { service: 'infidash' },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    serializers: {
      err: serializeError,
      req: (request: { method?: string; url?: string; ip?: string }) => ({
        method: request.method,
        url: sanitizeLogUrl(request.url),
        remoteAddress: request.ip,
      }),
      res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
    },
  };
}

/** Standalone logger for code that runs outside a request (boot, schedulers, DB layer). */
export const logger = pino(buildLoggerOptions(process.env));

export function generateRequestId(request: Pick<IncomingMessage, 'headers'>): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

// Routes polled on a fixed schedule by the platform or by n8n: their request/response lines would be pure noise.
const POLLING_PATHS = new Set(['/api/health', '/api/internal/content/jobs/claim']);

function isPollingRequest(request: { url?: string }) {
  return POLLING_PATHS.has((request.url ?? '').split('?')[0]);
}

/**
 * Fastify's own request-lifecycle log lines. Two overrides:
 * - polling routes (platform health checks, the n8n dispatcher's job claim once a minute) have their
 *   request/response lines skipped; a failing health check still logs its own error (src/server/health.ts) and
 *   failing claims are logged by the content API error handler;
 * - the default 404 line embeds the raw URL, which for the lead webhook path would leak its bearer token.
 */
class InfidashLogController extends LogController {
  override isLogDisabled(request: FastifyRequest): boolean {
    return isPollingRequest(request);
  }

  override routeNotFound(request: FastifyRequest): void {
    if (this.isLogDisabled(request)) return;
    request.log.info(`Route ${request.raw.method}:${sanitizeLogUrl(request.raw.url)} not found`);
  }
}

/**
 * Fastify options for structured logging. Pass `stream` (tests) to capture the output instead of stdout.
 * Request ids are validated in genReqId; request/404 log lines are customised by InfidashLogController.
 */
export function buildFastifyLoggingOptions(env: LogEnv, stream?: DestinationStream): Pick<FastifyServerOptions, 'logger' | 'loggerInstance' | 'genReqId' | 'requestIdHeader' | 'logController'> {
  const options = buildLoggerOptions(env);
  const base = {
    // The id is validated in genReqId, so Fastify must not take the header verbatim.
    requestIdHeader: false as const,
    genReqId: generateRequestId,
    logController: new InfidashLogController(),
  };
  return stream ? { ...base, loggerInstance: pino(options, stream) } : { ...base, logger: options };
}

/** Echoes the request id back so a client report can be matched to the server log lines. */
export function registerRequestId(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
