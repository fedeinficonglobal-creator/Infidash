import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export type SecurityEnv = Record<string, string | undefined>;
export type CspMode = 'report-only' | 'enforce' | 'off';

const DEFAULT_GLOBAL_MAX = 1500;
const DEFAULT_LOGIN_MAX = 10;
const DEFAULT_LEADS_MAX = 120;
const WINDOW = '1 minute';

/**
 * Reads INFIDASH_TRUST_PROXY: unset/empty/"false" -> false, "true" -> trust every hop, a positive integer
 * -> number of proxy hops, anything else -> comma-separated list of trusted IPs/CIDRs.
 */
export type TrustProxySetting = boolean | string[] | ((address: string, hop: number) => boolean);

export function resolveTrustProxy(env: SecurityEnv): TrustProxySetting {
  const raw = (env.INFIDASH_TRUST_PROXY ?? '').trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  if (/^-?\d+(\.\d+)?$/.test(raw) || /^nan$/i.test(raw)) {
    const hops = Number(raw);
    if (!Number.isInteger(hops) || hops < 1) {
      throw new Error(`INFIDASH_TRUST_PROXY inválido ("${raw}"): el número de proxies debe ser un entero mayor o igual que 1`);
    }
    // Fastify (5.x) treats a bare number as "trust nothing" (fail closed), so hops become an explicit predicate:
    // hop 0 is the socket peer (the nearest proxy); trusting `hops` hops walks that many X-Forwarded-For entries.
    return (_address: string, hop: number) => hop < hops;
  }
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new Error(`INFIDASH_TRUST_PROXY inválido ("${raw}")`);
  return entries;
}

export function resolveCspMode(env: SecurityEnv): CspMode {
  const raw = (env.INFIDASH_CSP_MODE ?? '').trim().toLowerCase();
  if (!raw) return 'report-only';
  if (raw === 'report-only' || raw === 'enforce' || raw === 'off') return raw;
  throw new Error(`INFIDASH_CSP_MODE inválido ("${raw}"): usa report-only, enforce u off`);
}

/** CSP for the same-origin SPA. The built index.html has no inline scripts, so script-src stays 'self'. */
export function buildContentSecurityPolicy(): Record<string, string[]> {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Client logos, avatars and creatives are served from arbitrary HTTPS hosts.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    // The Redes Sociales tab previews uploaded videos through blob: URLs.
    'media-src': ["'self'", 'blob:', 'https:'],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
}

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number((raw ?? '').trim());
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function rateLimitSettings(env: SecurityEnv) {
  const enabled = env.NODE_ENV !== 'test' || env.INFIDASH_RATE_LIMIT_IN_TEST === '1';
  return {
    enabled,
    globalMax: positiveInt(env.INFIDASH_RATE_LIMIT_MAX, DEFAULT_GLOBAL_MAX),
    loginMax: positiveInt(env.INFIDASH_RATE_LIMIT_LOGIN_MAX, DEFAULT_LOGIN_MAX),
    leadsMax: positiveInt(env.INFIDASH_RATE_LIMIT_LEADS_MAX, DEFAULT_LEADS_MAX),
  };
}

/** Route `config` for POST /api/auth/login: stricter per-IP limit. Ignored when rate limiting is disabled. */
export function loginRouteConfig(env: SecurityEnv) {
  return { rateLimit: { max: rateLimitSettings(env).loginMax, timeWindow: WINDOW } };
}

/** Route `config` for POST /api/public/leads/:token: per-IP-and-token limit. */
export function leadsRouteConfig(env: SecurityEnv) {
  return {
    rateLimit: {
      max: rateLimitSettings(env).leadsMax,
      timeWindow: WINDOW,
      keyGenerator: (req: { ip: string; params?: unknown }) => `${req.ip}:${String((req.params as { token?: string } | undefined)?.token ?? '')}`,
    },
  };
}

export async function registerSecurity(app: FastifyInstance, env: SecurityEnv) {
  const cspMode = resolveCspMode(env);
  await app.register(helmet, {
    contentSecurityPolicy:
      cspMode === 'off'
        ? false
        : { useDefaults: false, reportOnly: cspMode === 'report-only', directives: buildContentSecurityPolicy() },
  });

  const settings = rateLimitSettings(env);
  if (settings.enabled) {
    await app.register(rateLimit, {
      global: true,
      max: settings.globalMax,
      timeWindow: WINDOW,
      allowList: (req) => (req.raw.url ?? '').split('?')[0] === '/api/health',
      errorResponseBuilder: (_req, context) =>
        Object.assign(new Error('Demasiadas solicitudes. Espera antes de volver a intentarlo.'), {
          statusCode: context.statusCode,
          code: 'RATE_LIMITED',
        }),
    });
  }

  // Behind a proxy without trustProxy every client shares the proxy's IP, so per-IP limits hit everybody at once.
  if (resolveTrustProxy(env) === false) {
    let warned = false;
    app.addHook('onRequest', async (request) => {
      if (warned || !request.headers['x-forwarded-for']) return;
      warned = true;
      console.warn(
        '[infidash] Se recibió X-Forwarded-For pero INFIDASH_TRUST_PROXY no está definido: todos los clientes comparten la misma IP para el rate limit y el bloqueo de login. Si la app corre detrás de un proxy (EasyPanel/Traefik), define INFIDASH_TRUST_PROXY=1.',
      );
    });
  }
}
