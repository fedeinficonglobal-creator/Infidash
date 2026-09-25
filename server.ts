// @ts-nocheck
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  authenticateUser,
  closeMonthlyKpiCycle,
  closeDueMonthlyKpiCycles,
  reopenMonthlyKpiCycle,
  createClient,
  createDatabaseBackup,
  deleteClient,
  updateClient,
  createUser,
  createOrUpdateClientIntegration,
  deleteDailyStat,
  deleteUser,
  getClientBySlug,
  getClientByIdRecord,
  getClientIntegrations,
  getDailyStatById,
  getDashboardHealthSummary,
  getIntegrationById,
  getIntegrationByWebhookSecret,
  getIntegrationCredentialsById,
  getWooCommerceSalesSnapshot,
  getGa4Snapshot,
  saveGa4Snapshot,
  getGoogleAdsSnapshot,
  saveGoogleAdsSnapshot,
  getLatestUxSnapshot,
  getMonthlyKpiById,
  getOperationalPlan,
  getReportRun,
  getReportRunPdf,
  getSessionByToken,
  insertLead,
  listClients,
  listClientsWithLatestStat,
  listDailyStats,
  listLeadsByClient,
  listUxSnapshots,
  listIntegrationsByProvider,
  listMonthlyKpis,
  listMonthlyKpiEvents,
  listMonthlyKpiCycles,
  listRrssChannels,
  listReportRuns,
  listUsers,
  removeClientIntegration,
  rotateClientIntegrationWebhook,
  saveMonthlyKpi,
  saveOperationalPlan,
  saveReportRun,
  recordReportSend,
  saveWooCommerceSalesSnapshot,
  saveRrssChannel,
  setClientIntegrationStatus,
  setClientIntegrationActive,
  testIntegrationById,
  updateIntegrationSyncState,
  updateUserRole,
  upsertDailyStat,
  upsertUxSnapshot,
  type UserRole,
} from './src/lib/database.js';
import { canAccessClient } from './src/lib/auth.js';
import { fetchClaritySnapshots } from './src/lib/claritySync.js';
import { hasClarityMetric } from './src/lib/clarityAvailability.js';
import { contentRoutes } from './src/server/content/routes.js';
import { closeEditorialPool } from './src/server/content/postgres.js';
import { LoginThrottle } from './src/lib/loginThrottle.js';
import { redactIntegrationSecrets } from './src/lib/integrationPresentation.js';
import { fetchWooCommercePurchaseWindow, parseWooRefundPolicy, probeWooCommerceOrders, summarizeCompletedOrderSales } from './src/lib/woocommerce.js';
import { validateWooCommerceSnapshot, wooCommerceSourceKey } from './src/lib/woocommerceSnapshot.js';
import { createGa4AccessTokenProvider, fetchGa4TrafficReport, parseGa4ServiceAccount, probeGa4Property } from './src/lib/ga4.js';
import { createGoogleAdsAccessTokenProvider, fetchGoogleAdsCampaignReport, probeGoogleAdsAccount } from './src/lib/googleAds.js';
import { isValidInclusiveDateRange } from './src/lib/dateRange.js';
import { sumRevenueWindow } from './src/lib/dashboardMetrics.js';
import { parseLeadQuery } from './src/lib/leadQuery.js';
import { leadDedupeKey, readLeadDeliveryIdentity } from './src/lib/leadDelivery.js';
import { nextMadridCloseInstant } from './src/lib/monthlyCloseClock.js';
import { buildDailyStatsPdf, summarizeDailyStats } from './src/lib/dailyReportPdf.js';
import { reportSmtpConfigured, sendReportEmail } from './src/lib/reportEmail.js';
import { shouldServeHttp } from './src/lib/serverRuntime.js';
import { isOperationalPlanDomain, isPlanPeriod, normalizeOperationalPlanRows } from './src/lib/operationalPlanValidation.js';

const app = fastify({
  logger: false,
  bodyLimit: 1_000_000,
});

// One shared GA4 service-account credential for every client (per-client config is only a Property ID).
// A bad/missing credential breaks GA4 for all clients at once, so fail loudly here rather than on first sync.
let ga4Service: { getAccessToken: () => Promise<string>; clientEmail: string } | null = null;
if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
  try {
    const account = parseGa4ServiceAccount(process.env.GA4_SERVICE_ACCOUNT_JSON);
    ga4Service = { getAccessToken: createGa4AccessTokenProvider(account), clientEmail: account.clientEmail };
    ga4Service.getAccessToken().catch((error) => {
      console.error('[infidash] No se pudo obtener un token de GA4 al arrancar; revisa GA4_SERVICE_ACCOUNT_JSON:', error instanceof Error ? error.message : error);
    });
  } catch (error) {
    console.error('[infidash] GA4_SERVICE_ACCOUNT_JSON inválido:', error instanceof Error ? error.message : error);
  }
}

// One shared Google Ads manager-account (MCC) credential for every client (per-client config is only a Customer ID).
// A bad/missing credential breaks Google Ads for all clients at once, so fail loudly here rather than on first sync.
let googleAdsService: { getAccessToken: () => Promise<string>; developerToken: string; loginCustomerId: string } | null = null;
if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
  try {
    const getAccessToken = createGoogleAdsAccessTokenProvider({
      clientId: process.env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    googleAdsService = { getAccessToken, developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN, loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '') };
    googleAdsService.getAccessToken().catch((error) => {
      console.error('[infidash] No se pudo obtener un token de Google Ads al arrancar; revisa GOOGLE_ADS_REFRESH_TOKEN:', error instanceof Error ? error.message : error);
    });
  } catch (error) {
    console.error('[infidash] Credenciales de Google Ads inválidas:', error instanceof Error ? error.message : error);
  }
}
const loginThrottle = new LoginThrottle();

app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const rawBody = typeof body === 'string' ? body.trim() : '';
  if (!rawBody) {
    done(null, {});
    return;
  }

  try {
    done(null, JSON.parse(rawBody));
  } catch (error) {
    done(error as Error);
  }
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const distPath = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distPath, 'index.html');

app.register(contentRoutes, {
  resolveHumanSession: (token) => getSessionByToken(token) as any,
});

app.addHook('onClose', async () => {
  await closeEditorialPool();
});

type AnyRouteGeneric = { Body: any; Params: any; Querystring: any; Headers: any };
type AnyFastifyRequest = FastifyRequest<AnyRouteGeneric>;

app.addHook('onRequest', (request, reply, done) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  done();
});

function sendError(reply: FastifyReply, status: number, message: string, code?: string) {
  return reply.code(status).send({ error: message, code });
}

function getBearerToken(req: AnyFastifyRequest) {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  const sessionToken = req.headers['x-session-token'];
  if (typeof sessionToken === 'string') {
    return sessionToken.trim() || null;
  }

  if (Array.isArray(sessionToken)) {
    return sessionToken[0]?.trim() || null;
  }

  return null;
}

function requireSession(req: AnyFastifyRequest, reply: FastifyReply, roles?: UserRole[]) {
  const token = getBearerToken(req);
  if (!token) {
    sendError(reply, 401, 'Sesión no autenticada', 'UNAUTHENTICATED');
    return null;
  }

  const session = getSessionByToken(token) as any;
  if (!session) {
    sendError(reply, 401, 'Sesión expirada o inválida', 'INVALID_SESSION');
    return null;
  }

  if (roles && !roles.includes(session.user.role)) {
    sendError(reply, 403, 'No tienes permisos para realizar esta acción', 'FORBIDDEN');
    return null;
  }

  return session;
}

/** Call after requireSession for any route scoped to a single clientId. Sends 403 and returns false when denied. */
function requireClientAccess(reply: FastifyReply, session: { user: { role: UserRole; clientIds: string[] | null } }, clientId: string) {
  if (canAccessClient(session.user, clientId)) return true;
  sendError(reply, 403, 'No tienes acceso a este cliente', 'FORBIDDEN');
  return false;
}

function parseNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function syncClarityIntegration(integrationId: string) {
  const integration = getIntegrationById(integrationId);
  if (!integration) {
    return null;
  }

  if (integration.provider !== 'clarity') {
    return {
      integration,
      snapshots: [],
      skipped: true,
    };
  }

  const credentials = getIntegrationCredentialsById(integrationId) ?? {};
  const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : undefined;
  const snapshots = await fetchClaritySnapshots({
    clientId: integration.clientId,
    integrationId: integration.id,
    exportUrl: typeof integration.config.exportUrl === 'string' ? integration.config.exportUrl : undefined,
    accessToken,
    projectId: typeof integration.config.projectId === 'string' ? integration.config.projectId : undefined,
    siteUrl: typeof integration.config.siteUrl === 'string' ? integration.config.siteUrl : undefined,
    segmentName: typeof integration.config.segmentName === 'string' ? integration.config.segmentName : undefined,
  });

  const savedSnapshots = snapshots
    .map((snapshot) => upsertUxSnapshot({
      clientId: snapshot.clientId,
      snapshotDate: snapshot.snapshotDate,
      sessions: snapshot.sessions,
      pageViews: snapshot.pageViews,
      rageClicks: snapshot.rageClicks,
      deadClicks: snapshot.deadClicks,
      scrollDepthAvg: snapshot.scrollDepthAvg,
      engagedSessions: snapshot.engagedSessions,
      conversions: snapshot.conversions,
      conversionRate: snapshot.conversionRate,
      notes: snapshot.notes,
      source: snapshot.source,
      payloadJson: snapshot.payloadJson,
    }))
    .filter(Boolean);

  const lastSnapshot = savedSnapshots[savedSnapshots.length - 1] ?? null;
  const refreshedIntegration = updateIntegrationSyncState(integration.id, {
    status: 'connected',
    lastError: null,
    lastSync: lastSnapshot?.updatedAt ?? new Date().toISOString(),
  });

  return {
    integration: refreshedIntegration ?? integration,
    snapshots: savedSnapshots,
    skipped: false,
  };
}

async function testWordPressConnection(integration: any, fetchImpl: typeof fetch = globalThis.fetch) {
  const siteUrl = String(integration.config?.siteUrl ?? '').trim().replace(/\/+$/, '');
  if (!siteUrl) {
    return { ok: false, error: 'Falta la URL del sitio' };
  }

  const restNamespace = String(integration.config?.restNamespace ?? '/wp-json/wp/v2').trim() || '/wp-json/wp/v2';
  const url = `${siteUrl}${restNamespace.startsWith('/') ? '' : '/'}${restNamespace}`;
  const credentials = getIntegrationCredentialsById(integration.id) ?? {};
  const username = typeof credentials.username === 'string' ? credentials.username.trim() : '';
  const applicationPassword = typeof credentials.applicationPassword === 'string' ? credentials.applicationPassword.trim() : '';

  const headers = new Headers({ accept: 'application/json' });
  if (username && applicationPassword) {
    headers.set('authorization', `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString('base64')}`);
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new DOMException('WordPress connection timeout', 'AbortError')), 8000);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: `WordPress respondió ${response.status} ${response.statusText}` };
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo conectar con WordPress' };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

let claritySyncRunning = false;
const CLARITY_AUTOMATIC_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function syncAllClarityIntegrations() {
  if (claritySyncRunning) {
    return;
  }

  claritySyncRunning = true;
  try {
    const integrations = listIntegrationsByProvider('clarity');
    for (const integration of integrations) {
      const lastSyncAt = integration.lastSync ? Date.parse(integration.lastSync) : NaN;
      const latestSnapshot = getLatestUxSnapshot(integration.clientId);
      if (integration.status === 'connected' && Number.isFinite(lastSyncAt) &&
        Date.now() - lastSyncAt < CLARITY_AUTOMATIC_INTERVAL_MS && latestSnapshot?.source === 'clarity' &&
        hasClarityMetric(latestSnapshot, 'sessions')) continue;
      try {
        await syncClarityIntegration(integration.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido durante la sincronización de Análisis/UX';
        updateIntegrationSyncState(integration.id, {
          status: 'error',
          lastError: message,
        });
        console.error('[infidash] clarity sync failed', integration.id, message);
      }
    }
  } finally {
    claritySyncRunning = false;
  }
}

function startClaritySyncScheduler() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  // Clarity allows only ten export requests per project per day. One automatic
  // request per day leaves room for manual checks and avoids exhausting quota.
  const intervalMs = Number(process.env.CLARITY_SYNC_INTERVAL_MS ?? CLARITY_AUTOMATIC_INTERVAL_MS);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= CLARITY_AUTOMATIC_INTERVAL_MS ? intervalMs : CLARITY_AUTOMATIC_INTERVAL_MS;
  const globalState = globalThis as typeof globalThis & { __infidashClaritySyncInterval?: ReturnType<typeof setInterval> };
  if (globalState.__infidashClaritySyncInterval) {
    return;
  }

  const run = () => {
    void syncAllClarityIntegrations().catch((error) => {
      console.error('[infidash] clarity sync scheduler failed', error);
    });
  };

  // First run is delayed so the psql-backed sync (blocking, via spawnSync)
  // doesn't compete with the platform's startup health check right after listen().
  const initialDelayMs = 10_000;
  setTimeout(run, initialDelayMs);
  globalState.__infidashClaritySyncInterval = setInterval(run, safeInterval);
}

app.get('/api/health', (_req: AnyFastifyRequest, reply: FastifyReply) => {
  return reply.send({ status: 'ok' });
});

app.post('/api/auth/login', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const { email, password } = (req.body ?? {}) as any;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendError(reply, 400, 'email y password son obligatorios', 'INVALID_PAYLOAD');
  }

  const loginCheck = loginThrottle.check(req.ip);
  if (loginCheck.blocked) {
    reply.header('Retry-After', String(loginCheck.retryAfterSeconds));
    return sendError(reply, 429, 'Demasiados intentos. Espera antes de volver a intentarlo.', 'LOGIN_RATE_LIMITED');
  }

  const result = authenticateUser(email, password);
  if (!result) {
    loginThrottle.recordFailure(req.ip);
    return sendError(reply, 401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  loginThrottle.recordSuccess(req.ip);
  return reply.send(result);
});

app.get('/api/auth/me', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply);
  if (!session) {
    return;
  }

  return reply.send(session);
});

app.post('/api/auth/logout', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply);
  if (!session) {
    return;
  }

  return reply.code(204).send();
});

app.get('/api/users', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  return reply.send({ users: listUsers() });
});

app.post('/api/users', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { email, name, password, role, clientIds } = (req.body ?? {}) as any;
  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return sendError(reply, 400, 'email, name y password son obligatorios', 'INVALID_PAYLOAD');
  }
  if (clientIds !== undefined && (!Array.isArray(clientIds) || clientIds.some((id: unknown) => typeof id !== 'string'))) {
    return sendError(reply, 400, 'clientIds debe ser una lista de texto', 'INVALID_PAYLOAD');
  }

  const normalizedRole: UserRole = role === 'viewer' ? 'viewer' : 'admin';
  const user = createUser({ email, name, password, role: normalizedRole, clientIds });
  return reply.code(201).send({ user });
});

app.patch('/api/users/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const bodyClientIds = (req.body as any)?.clientIds;
  if (bodyClientIds !== undefined && (!Array.isArray(bodyClientIds) || bodyClientIds.some((id: unknown) => typeof id !== 'string'))) {
    return sendError(reply, 400, 'clientIds debe ser una lista de texto', 'INVALID_PAYLOAD');
  }

  const updated = updateUserRole((req.params as any).id, {
    role: (req.body as any)?.role === 'viewer' ? 'viewer' : (req.body as any)?.role === 'admin' ? 'admin' : undefined,
    active: typeof (req.body as any)?.active === 'boolean' ? (req.body as any).active : undefined,
    name: typeof (req.body as any)?.name === 'string' ? (req.body as any).name : undefined,
    clientIds: bodyClientIds,
  });

  if (!updated) {
    return sendError(reply, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  return reply.send({ user: updated });
});

app.delete('/api/users/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  if ((req.params as any).id === session.user.id) {
    return sendError(reply, 400, 'No puedes eliminar tu propia cuenta', 'SELF_DELETE_FORBIDDEN');
  }

  const userToDelete = (listUsers() as any[]).find((user: any) => user.id === (req.params as any).id);
  if (!userToDelete) {
    return sendError(reply, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  const adminCount = listUsers().filter((user) => user.role === 'admin').length;
  if (userToDelete.role === 'admin' && adminCount <= 1) {
    return sendError(reply, 409, 'No puedes eliminar el último administrador', 'LAST_ADMIN_FORBIDDEN');
  }

  const deleted = deleteUser((req.params as any).id);
  if (!deleted) {
    return sendError(reply, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  return reply.code(204).send();
});

app.get('/api/clients', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const scope = session.user.role === 'admin' ? undefined : session.user.clientIds ?? [];
  const clients = listClientsWithLatestStat({ clientIds: scope }).map((client) => ({
    ...client,
    revenue30d: sumRevenueWindow(listDailyStats(client.id), endDate, 30),
  }));
  return reply.send({ clients });
});

app.get('/api/clients/:slug', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const client = getClientBySlug((req.params as any).slug) as any;
  if (!client) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }
  if (!requireClientAccess(reply, session, client.id)) {
    return;
  }

  return reply.send({ client });
});

app.get('/api/clients/:clientId/dashboard', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const client = getClientBySlug((req.params as any).clientId) ?? listClients().find((item) => item.id === (req.params as any).clientId) ?? null;
  if (!client) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }
  if (!requireClientAccess(reply, session, client.id)) {
    return;
  }

  const dailyStats = listDailyStats(client.id);
  const uxSnapshots = listUxSnapshots(client.id);
  const latestUxSnapshot = getLatestUxSnapshot(client.id);

  return reply.send({
    client,
    dailyStats,
    uxSnapshots,
    latestUxSnapshot,
  });
});

app.post('/api/clients', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { name, industry, logoUrl, healthScore, kpiThresholds } = (req.body ?? {}) as any;
  if (typeof name !== 'string' || !name.trim()) {
    return sendError(reply, 400, 'name es obligatorio', 'INVALID_PAYLOAD');
  }

  const client = createClient({
    name,
    industry: typeof industry === 'string' && industry.trim() ? industry : null,
    logoUrl: typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl : null,
    healthScore: typeof healthScore === 'number' ? healthScore : undefined,
    kpiThresholds: kpiThresholds && typeof kpiThresholds === 'object' ? kpiThresholds : null,
  });

  return reply.code(201).send({ client });
});

app.patch('/api/clients/:clientId', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { name, industry, logoUrl, healthScore, kpiThresholds } = (req.body ?? {}) as any;
  const clientId = (req.params as any).clientId;

  if (
    name !== undefined && typeof name !== 'string'
    || industry !== undefined && typeof industry !== 'string' && industry !== null
    || logoUrl !== undefined && typeof logoUrl !== 'string' && logoUrl !== null
    || healthScore !== undefined && typeof healthScore !== 'number'
    || kpiThresholds !== undefined && (typeof kpiThresholds !== 'object' || kpiThresholds === null)
  ) {
    return sendError(reply, 400, 'Payload de cliente inválido', 'INVALID_PAYLOAD');
  }

  const client = updateClient(clientId, {
    name: typeof name === 'string' && name.trim() ? name : undefined,
    industry: industry === undefined ? undefined : (typeof industry === 'string' && industry.trim() ? industry : null),
    logoUrl: logoUrl === undefined ? undefined : (typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl : null),
    healthScore: typeof healthScore === 'number' ? healthScore : undefined,
    kpiThresholds: kpiThresholds && typeof kpiThresholds === 'object' ? kpiThresholds : null,
  });

  if (!client) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return reply.send({ client });
});

app.delete('/api/clients/:clientId', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const deleted = deleteClient((req.params as any).clientId);
  if (!deleted) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return reply.code(204).send();
});

app.get('/api/clients/:clientId/integrations', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  if (!requireClientAccess(reply, session, (req.params as any).clientId)) {
    return;
  }

  const clientIntegrations = redactIntegrationSecrets(getClientIntegrations((req.params as any).clientId), session.user.role);
  return reply.send({ integrations: clientIntegrations });
});

app.post('/api/integrations', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { id, clientId, provider, label, config, credentials, status, lastError } = (req.body ?? {}) as any;
  if (typeof clientId !== 'string' || typeof provider !== 'string') {
    return sendError(reply, 400, 'clientId y provider son obligatorios', 'INVALID_PAYLOAD');
  }

  try {
    const saved = createOrUpdateClientIntegration({
      id: typeof id === 'string' && id.trim() ? id : undefined,
      clientId,
      provider: provider as any,
      label: typeof label === 'string' ? label : null,
      config: config && typeof config === 'object' ? config : null,
      credentials: credentials && typeof credentials === 'object' ? credentials : null,
      status: typeof status === 'string' ? status as any : undefined,
      lastError: typeof lastError === 'string' ? lastError : null,
    });

    if (!saved) {
      return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
    }

    return reply.code(201).send({ integration: saved });
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'No se pudo guardar la integración', 'INVALID_INTEGRATION');
  }
});

app.patch('/api/integrations/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const existing = getIntegrationById((req.params as any).id) as any;
  if (!existing) {
    return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  try {
    const saved = createOrUpdateClientIntegration({
      id: existing.id,
      clientId: existing.clientId,
      provider: existing.provider,
      label: typeof (req.body as any)?.label === 'string' ? (req.body as any).label : existing.label,
      config: (req.body as any)?.config && typeof (req.body as any).config === 'object' ? (req.body as any).config : null,
      credentials: (req.body as any)?.credentials && typeof (req.body as any).credentials === 'object' ? (req.body as any).credentials : null,
      status: typeof (req.body as any)?.status === 'string' ? (req.body as any).status as any : existing.status,
      lastError: typeof (req.body as any)?.lastError === 'string' ? (req.body as any).lastError : existing.lastError,
    });

    return reply.send({ integration: saved });
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'No se pudo actualizar la integración', 'INVALID_INTEGRATION');
  }
});

app.post('/api/integrations/:id/test', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  if (getIntegrationById((req.params as any).id)?.isActive === false) {
    return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  }

  let result = testIntegrationById((req.params as any).id);
  if (!result) {
    return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  // The field-completeness check above never actually contacts WordPress.
  // For wordpress integrations with all required fields, do a real HTTP probe.
  if (result.ready && result.integration.provider === 'wordpress') {
    const probe = await testWordPressConnection(result.integration);
    const updated = setClientIntegrationStatus(
      result.integration.id,
      probe.ok ? 'connected' : 'error',
      probe.ok ? null : probe.error,
      probe.ok ? new Date().toISOString() : undefined,
    );
    result = {
      ...result,
      integration: updated ?? result.integration,
      ready: probe.ok,
      summary: probe.ok ? result.summary : (probe.error ?? 'No se pudo conectar con WordPress'),
    };
  }

  if (result.ready && result.integration.provider === 'woocommerce') {
    const credentials = getIntegrationCredentialsById(result.integration.id) ?? {};
    const probe = await probeWooCommerceOrders({
      storeUrl: String(result.integration.config?.storeUrl ?? ''),
      consumerKey: String(credentials.consumerKey ?? ''),
      consumerSecret: String(credentials.consumerSecret ?? ''),
    });
    const updated = setClientIntegrationStatus(result.integration.id, probe.ok ? 'pending' : 'error', probe.error);
    result = {
      ...result,
      integration: updated ?? result.integration,
      ready: probe.ok,
      summary: probe.ok ? 'Acceso a pedidos verificado; la sincronización de ventas aún no está activada' : (probe.error ?? 'No se pudo conectar con WooCommerce'),
    };
  }

  if (result.ready && result.integration.provider === 'ga4') {
    if (!ga4Service) {
      const updated = setClientIntegrationStatus(result.integration.id, 'error', 'GA4 no está configurado en el servidor');
      result = { ...result, integration: updated ?? result.integration, ready: false, summary: 'GA4 no está configurado en el servidor' };
    } else {
      const propertyId = String(result.integration.config?.propertyId ?? '');
      const probe = await probeGa4Property({ propertyId }, ga4Service.getAccessToken, ga4Service.clientEmail);
      const updated = setClientIntegrationStatus(
        result.integration.id,
        probe.ok ? 'connected' : 'error',
        probe.ok ? null : probe.error,
        probe.ok ? new Date().toISOString() : undefined,
      );
      result = {
        ...result,
        integration: updated ?? result.integration,
        ready: probe.ok,
        summary: probe.ok ? 'Acceso a la propiedad GA4 verificado' : (probe.error ?? 'No se pudo conectar con GA4'),
      };
    }
  }

  if (result.ready && result.integration.provider === 'google_ads') {
    if (!googleAdsService) {
      const updated = setClientIntegrationStatus(result.integration.id, 'error', 'Google Ads no está configurado en el servidor');
      result = { ...result, integration: updated ?? result.integration, ready: false, summary: 'Google Ads no está configurado en el servidor' };
    } else {
      const customerId = String(result.integration.config?.customerId ?? '');
      const probe = await probeGoogleAdsAccount({ customerId }, googleAdsService.getAccessToken, googleAdsService.developerToken, googleAdsService.loginCustomerId);
      const updated = setClientIntegrationStatus(
        result.integration.id,
        probe.ok ? 'connected' : 'error',
        probe.ok ? null : probe.error,
        probe.ok ? new Date().toISOString() : undefined,
      );
      result = {
        ...result,
        integration: updated ?? result.integration,
        ready: probe.ok,
        summary: probe.ok ? 'Acceso a la cuenta de Google Ads verificado' : (probe.error ?? 'No se pudo conectar con Google Ads'),
      };
    }
  }

  return reply.send(result);
});

app.get('/api/integrations/:id/woocommerce/sales-preview', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'woocommerce') {
    return sendError(reply, 404, 'Integración WooCommerce no encontrada', 'NOT_FOUND');
  }
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  const query = req.query as Record<string, unknown>;
  if (typeof query.from !== 'string' || typeof query.to !== 'string') {
    return sendError(reply, 400, 'Indica las fechas de compra desde y hasta', 'INVALID_RANGE');
  }
  let refundPolicy;
  try { refundPolicy = parseWooRefundPolicy(integration.config.refundPolicy); }
  catch { return sendError(reply, 400, 'Política de reembolsos inválida', 'INVALID_REFUND_POLICY'); }
  const credentials = getIntegrationCredentialsById(integration.id) ?? {};
  try {
    const orders = await fetchWooCommercePurchaseWindow({
      storeUrl: String(integration.config.storeUrl ?? ''),
      consumerKey: String(credentials.consumerKey ?? ''),
      consumerSecret: String(credentials.consumerSecret ?? ''),
    }, { from: query.from, to: query.to, maxPages: 5 });
    return reply.send({
      source: 'woocommerce', from: query.from, to: query.to, refundPolicy,
      complete: true, orderCount: orders.length,
      sales: summarizeCompletedOrderSales(orders, refundPolicy),
      persisted: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo leer WooCommerce';
    return sendError(reply, message.startsWith('Ventana de compra inválida') ? 400 : 502, message, 'WOOCOMMERCE_PREVIEW_FAILED');
  }
});

app.post('/api/integrations/:id/woocommerce/sales-sync', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['admin'])) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'woocommerce') return sendError(reply, 404, 'Integración WooCommerce no encontrada', 'NOT_FOUND');
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  const body = req.body as Record<string, unknown> | null;
  if (typeof body?.from !== 'string' || typeof body?.to !== 'string') return sendError(reply, 400, 'Indica las fechas de compra desde y hasta', 'INVALID_RANGE');
  let refundPolicy;
  try { refundPolicy = parseWooRefundPolicy(integration.config.refundPolicy); }
  catch { return sendError(reply, 400, 'Política de reembolsos inválida', 'INVALID_REFUND_POLICY'); }
  const credentials = getIntegrationCredentialsById(integration.id) ?? {};
  try {
    const storeUrl = String(integration.config.storeUrl ?? '');
    const orders = await fetchWooCommercePurchaseWindow({ storeUrl, consumerKey: String(credentials.consumerKey ?? ''), consumerSecret: String(credentials.consumerSecret ?? '') },
      { from: body.from, to: body.to, maxPages: 5 });
    validateWooCommerceSnapshot({ from: body.from, to: body.to, orders });
    const snapshot = saveWooCommerceSalesSnapshot({ integrationId: integration.id, sourceKey: wooCommerceSourceKey(storeUrl), from: body.from, to: body.to, orders });
    return reply.send({ source: 'woocommerce', from: body.from, to: body.to, refundPolicy, complete: true,
      orderCount: orders.length, sales: summarizeCompletedOrderSales(orders, refundPolicy), persisted: true, syncedAt: snapshot.syncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar WooCommerce';
    return sendError(reply, message.startsWith('Ventana de compra inválida') ? 400 : 502, message, 'WOOCOMMERCE_SYNC_FAILED');
  }
});

app.get('/api/integrations/:id/woocommerce/sales-snapshot', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'private, no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'woocommerce') return sendError(reply, 404, 'Integración WooCommerce no encontrada', 'NOT_FOUND');
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  const { from, to } = req.query as Record<string, string>;
  if (!from || !to) return sendError(reply, 400, 'Indica las fechas de compra desde y hasta', 'INVALID_RANGE');
  try {
    const snapshot = getWooCommerceSalesSnapshot({ integrationId: integration.id, sourceKey: wooCommerceSourceKey(String(integration.config.storeUrl ?? '')), from, to });
    if (!snapshot) return reply.send({ source: 'woocommerce', from, to, refundPolicy: parseWooRefundPolicy(integration.config.refundPolicy),
      complete: false, orderCount: 0, sales: [], persisted: false });
    const refundPolicy = parseWooRefundPolicy(integration.config.refundPolicy);
    return reply.send({ source: 'woocommerce', from, to, refundPolicy, complete: true, orderCount: snapshot.orders.length,
      sales: summarizeCompletedOrderSales(snapshot.orders, refundPolicy), persisted: true, syncedAt: snapshot.syncedAt });
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'No se pudo leer el resumen guardado', 'SNAPSHOT_READ_FAILED');
  }
});

app.get('/api/integrations/ga4/service-account', (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['viewer', 'admin'])) return;
  if (!ga4Service) return sendError(reply, 503, 'GA4 no está configurado en el servidor', 'GA4_NOT_CONFIGURED');
  return reply.send({ email: ga4Service.clientEmail });
});

app.get('/api/integrations/:id/ga4/traffic-preview', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'ga4') return sendError(reply, 404, 'Integración GA4 no encontrada', 'NOT_FOUND');
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  if (!ga4Service) return sendError(reply, 503, 'GA4 no está configurado en el servidor', 'GA4_NOT_CONFIGURED');
  const query = req.query as Record<string, unknown>;
  if (typeof query.from !== 'string' || typeof query.to !== 'string' || !isValidInclusiveDateRange(query.from, query.to, 31)) {
    return sendError(reply, 400, 'Indica un rango de fechas válido de hasta 31 días', 'INVALID_RANGE');
  }
  const propertyId = String(integration.config?.propertyId ?? '');
  try {
    const report = await fetchGa4TrafficReport({ propertyId, from: query.from, to: query.to }, ga4Service.getAccessToken, ga4Service.clientEmail);
    return reply.send({ source: 'ga4', from: query.from, to: query.to, propertyId, complete: true, persisted: false, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo leer GA4';
    return sendError(reply, message.startsWith('Ventana de fechas GA4 inválida') ? 400 : 502, message, 'GA4_PREVIEW_FAILED');
  }
});

app.post('/api/integrations/:id/ga4/traffic-sync', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['admin'])) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'ga4') return sendError(reply, 404, 'Integración GA4 no encontrada', 'NOT_FOUND');
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  if (!ga4Service) return sendError(reply, 503, 'GA4 no está configurado en el servidor', 'GA4_NOT_CONFIGURED');
  const body = req.body as Record<string, unknown> | null;
  if (typeof body?.from !== 'string' || typeof body?.to !== 'string' || !isValidInclusiveDateRange(body.from, body.to, 31)) {
    return sendError(reply, 400, 'Indica un rango de fechas válido de hasta 31 días', 'INVALID_RANGE');
  }
  const propertyId = String(integration.config?.propertyId ?? '');
  try {
    const report = await fetchGa4TrafficReport({ propertyId, from: body.from, to: body.to }, ga4Service.getAccessToken, ga4Service.clientEmail);
    const snapshot = saveGa4Snapshot({
      integrationId: integration.id, propertyId, from: body.from, to: body.to,
      sessionsSeries: report.sessionsSeries, trafficSources: report.trafficSources, topPages: report.topPages, landingPages: report.landingPages,
    });
    return reply.send({ source: 'ga4', from: body.from, to: body.to, propertyId, complete: true, persisted: true, syncedAt: snapshot.syncedAt, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar GA4';
    return sendError(reply, message.startsWith('Ventana de fechas GA4 inválida') ? 400 : 502, message, 'GA4_SYNC_FAILED');
  }
});

app.get('/api/integrations/:id/ga4/traffic-snapshot', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'private, no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'ga4') return sendError(reply, 404, 'Integración GA4 no encontrada', 'NOT_FOUND');
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  const { from, to } = req.query as Record<string, string>;
  if (!from || !to) return sendError(reply, 400, 'Indica un rango de fechas', 'INVALID_RANGE');
  const propertyId = String(integration.config?.propertyId ?? '');
  const snapshot = getGa4Snapshot({ integrationId: integration.id, propertyId, from, to });
  if (!snapshot) {
    return reply.send({ source: 'ga4', from, to, propertyId, complete: false, persisted: false,
      sessionsSeries: [], trafficSources: [], topPages: [], landingPages: [], samplingWarning: false, timeZone: null });
  }
  return reply.send({
    source: 'ga4', from, to, propertyId, complete: true, persisted: true, syncedAt: snapshot.syncedAt,
    sessionsSeries: snapshot.sessionsSeries, trafficSources: snapshot.trafficSources, topPages: snapshot.topPages, landingPages: snapshot.landingPages,
    samplingWarning: false, timeZone: null,
  });
});

app.get('/api/integrations/google-ads/manager-account', (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['viewer', 'admin'])) return;
  if (!googleAdsService) return sendError(reply, 503, 'Google Ads no está configurado en el servidor', 'GOOGLE_ADS_NOT_CONFIGURED');
  return reply.send({ loginCustomerId: googleAdsService.loginCustomerId });
});

app.get('/api/integrations/:id/google-ads/campaigns-preview', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'google_ads') return sendError(reply, 404, 'Integración Google Ads no encontrada', 'NOT_FOUND');
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  if (!googleAdsService) return sendError(reply, 503, 'Google Ads no está configurado en el servidor', 'GOOGLE_ADS_NOT_CONFIGURED');
  const query = req.query as Record<string, unknown>;
  if (typeof query.from !== 'string' || typeof query.to !== 'string' || !isValidInclusiveDateRange(query.from, query.to, 31)) {
    return sendError(reply, 400, 'Indica un rango de fechas válido de hasta 31 días', 'INVALID_RANGE');
  }
  const customerId = String(integration.config?.customerId ?? '');
  try {
    const report = await fetchGoogleAdsCampaignReport({ customerId, from: query.from, to: query.to }, googleAdsService.getAccessToken, googleAdsService.developerToken, googleAdsService.loginCustomerId);
    return reply.send({ source: 'google_ads', from: query.from, to: query.to, customerId, complete: true, persisted: false, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo leer Google Ads';
    return sendError(reply, message.startsWith('Ventana de fechas de Google Ads inválida') ? 400 : 502, message, 'GOOGLE_ADS_PREVIEW_FAILED');
  }
});

app.post('/api/integrations/:id/google-ads/campaigns-sync', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['admin'])) return;
  reply.header('Cache-Control', 'no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'google_ads') return sendError(reply, 404, 'Integración Google Ads no encontrada', 'NOT_FOUND');
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  if (!googleAdsService) return sendError(reply, 503, 'Google Ads no está configurado en el servidor', 'GOOGLE_ADS_NOT_CONFIGURED');
  const body = req.body as Record<string, unknown> | null;
  if (typeof body?.from !== 'string' || typeof body?.to !== 'string' || !isValidInclusiveDateRange(body.from, body.to, 31)) {
    return sendError(reply, 400, 'Indica un rango de fechas válido de hasta 31 días', 'INVALID_RANGE');
  }
  const customerId = String(integration.config?.customerId ?? '');
  try {
    const report = await fetchGoogleAdsCampaignReport({ customerId, from: body.from, to: body.to }, googleAdsService.getAccessToken, googleAdsService.developerToken, googleAdsService.loginCustomerId);
    const snapshot = saveGoogleAdsSnapshot({ integrationId: integration.id, customerId, from: body.from, to: body.to, campaigns: report.campaigns, currencyCode: report.currencyCode });
    return reply.send({ source: 'google_ads', from: body.from, to: body.to, customerId, complete: true, persisted: true, syncedAt: snapshot.syncedAt, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar Google Ads';
    return sendError(reply, message.startsWith('Ventana de fechas de Google Ads inválida') ? 400 : 502, message, 'GOOGLE_ADS_SYNC_FAILED');
  }
});

app.get('/api/integrations/:id/google-ads/campaigns-snapshot', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  reply.header('Cache-Control', 'private, no-store');
  const integration = getIntegrationById((req.params as any).id);
  if (!integration || integration.provider !== 'google_ads') return sendError(reply, 404, 'Integración Google Ads no encontrada', 'NOT_FOUND');
  if (!requireClientAccess(reply, session, integration.clientId)) return;
  if (!integration.isActive) return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  const { from, to } = req.query as Record<string, string>;
  if (!from || !to) return sendError(reply, 400, 'Indica un rango de fechas', 'INVALID_RANGE');
  const customerId = String(integration.config?.customerId ?? '');
  const snapshot = getGoogleAdsSnapshot({ integrationId: integration.id, customerId, from, to });
  if (!snapshot) {
    return reply.send({ source: 'google_ads', from, to, customerId, complete: false, persisted: false, campaigns: [], currencyCode: '', accountName: '' });
  }
  return reply.send({
    source: 'google_ads', from, to, customerId, complete: true, persisted: true, syncedAt: snapshot.syncedAt,
    campaigns: snapshot.campaigns, currencyCode: snapshot.currencyCode, accountName: '',
  });
});

app.post('/api/integrations/:id/sync', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const integration = getIntegrationById((req.params as any).id);
  if (!integration) {
    return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  if (!integration.isActive) {
    return sendError(reply, 409, 'La integración está desactivada', 'INTEGRATION_DISABLED');
  }

  try {
    const result = await syncClarityIntegration(integration.id);
    if (!result) {
      return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
    }

    return reply.send({
      integration: result.integration,
      snapshots: result.snapshots,
      skipped: result.skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo sincronizar Análisis/UX';
    updateIntegrationSyncState(integration.id, {
      status: 'error',
      lastError: message,
      lastSync: null,
    });
    return sendError(reply, 500, message, 'CLARITY_SYNC_FAILED');
  }
});

function pickLeadField(payload: Record<string, any>, candidates: string[]) {
  const flatSources = [payload, payload?.data, payload?.fields, payload?.posted_data, payload?.form_data].filter(
    (value): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  );

  for (const source of flatSources) {
    const keys = Object.keys(source);
    for (const candidate of candidates) {
      const match = keys.find((key) => key.toLowerCase().replace(/[^a-z]/g, '') === candidate);
      if (match && typeof source[match] === 'string' && source[match].trim()) {
        return source[match].trim();
      }
    }
  }

  return null;
}

// Public endpoint: no session. Auth is the unguessable per-integration webhook token itself
// (WordPress form plugins like Fluent Forms / Contact Form 7 POST here on submit).
app.post('/api/public/leads/:token', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const token = String((req.params as any).token ?? '').trim();
  const integration = token ? getIntegrationByWebhookSecret(token) : null;
  if (!integration || integration.provider !== 'wordpress') {
    return sendError(reply, 404, 'Webhook no encontrado', 'NOT_FOUND');
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(reply, 400, 'El formulario debe ser un objeto JSON', 'INVALID_PAYLOAD');
  }
  const name = pickLeadField(body, ['name', 'fullname', 'yourname', 'nombre', 'nombrecompleto']);
  const email = pickLeadField(body, ['email', 'youremail', 'correo', 'correoelectronico']);
  const phone = pickLeadField(body, ['phone', 'phonenumber', 'yourphone', 'telefono', 'tel', 'movil']);
  const message = pickLeadField(body, ['message', 'yourmessage', 'mensaje', 'comments', 'comentario', 'comentarios']);
  if (!name && !email && !phone && !message) {
    return sendError(reply, 400, 'El formulario no contiene campos de contacto reconocidos', 'INVALID_PAYLOAD');
  }

  let deliveryIdentity;
  try {
    deliveryIdentity = readLeadDeliveryIdentity(body);
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'Identificador de entrega inválido', 'INVALID_PAYLOAD');
  }

  const result = insertLead({
    clientId: integration.clientId,
    integrationId: integration.id,
    source: integration.config.leadSource?.trim() || 'WordPress',
    name: name ? name.slice(0, 300) : null,
    email: email ? email.slice(0, 300) : null,
    phone: phone ? phone.slice(0, 300) : null,
    message: message ? message.slice(0, 5000) : null,
    rawPayload: body,
    dedupeKey: deliveryIdentity ? leadDedupeKey(deliveryIdentity) : null,
  });

  updateIntegrationSyncState(integration.id, { status: 'connected', lastError: null, lastSync: new Date().toISOString() });

  return reply.code(result.duplicate ? 200 : 201).send({ ok: true, leadId: result.lead.id, duplicate: result.duplicate });
});

app.get('/api/leads', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const clientId = String((req.query as any)?.clientId ?? '').trim();
  if (!clientId) {
    return sendError(reply, 400, 'clientId es obligatorio', 'INVALID_PAYLOAD');
  }
  if (!requireClientAccess(reply, session, clientId)) {
    return;
  }

  try {
    return reply.send(listLeadsByClient(clientId, parseLeadQuery((req.query ?? {}) as Record<string, unknown>)));
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'Filtros de leads inválidos', 'INVALID_PAYLOAD');
  }
});

for (const [action, active] of [['disable', false], ['enable', true]] as const) {
  app.post(`/api/integrations/:id/${action}`, (req: AnyFastifyRequest, reply: FastifyReply) => {
    if (!requireSession(req, reply, ['admin'])) return;
    const integration = setClientIntegrationActive(String((req.params as any).id), active);
    if (!integration) return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
    return reply.send({ integration });
  });
}

function startMonthlyKpiCloseScheduler() {
  if (process.env.NODE_ENV === 'test' || process.env.INFIDASH_MONTHLY_AUTO_CLOSE !== '1') return;
  const globalState = globalThis as typeof globalThis & { __infidashMonthlyCloseTimer?: ReturnType<typeof setTimeout> };
  if (globalState.__infidashMonthlyCloseTimer) return;
  const schedule = (delay: number) => {
    globalState.__infidashMonthlyCloseTimer = setTimeout(run, Math.max(1, delay));
  };
  const run = () => {
    try {
      const result = closeDueMonthlyKpiCycles(new Date());
      if (result.pending) {
        schedule(10_000);
        return;
      }
      const untilClose = nextMadridCloseInstant(new Date()).getTime() - Date.now();
      schedule(Math.min(untilClose, 24 * 60 * 60 * 1000));
    } catch (error) {
      console.error('[infidash] monthly KPI close failed; retrying', error);
      schedule(60_000);
    }
  };
  schedule(Math.min(10_000, nextMadridCloseInstant(new Date()).getTime() - Date.now()));
}

app.post('/api/integrations/:id/rotate-webhook', (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['admin'])) return;
  const integration = rotateClientIntegrationWebhook(String((req.params as any).id));
  if (!integration) return sendError(reply, 404, 'Webhook de WordPress no encontrado', 'NOT_FOUND');
  return reply.send({ integration });
});

app.delete('/api/integrations/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const removed = removeClientIntegration((req.params as any).id);
  if (!removed) {
    return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  return reply.code(204).send();
});

app.get('/api/daily-stats', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const clientId = typeof (req.query as any).clientId === 'string' ? (req.query as any).clientId : undefined;
  if (clientId) {
    if (!requireClientAccess(reply, session, clientId)) {
      return;
    }
    return reply.send({ stats: listDailyStats(clientId) });
  }
  const scope = session.user.role === 'admin' ? undefined : session.user.clientIds ?? [];
  return reply.send({ stats: listDailyStats(undefined, { clientIds: scope }) });
});

app.get('/api/daily-stats/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const stat = getDailyStatById((req.params as any).id);
  if (!stat) {
    return sendError(reply, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }
  if (!requireClientAccess(reply, session, stat.clientId)) {
    return;
  }

  return reply.send({ stat });
});

app.post('/api/daily-stats', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { clientId, statDate, notes, source } = (req.body ?? {}) as any;
  if (typeof clientId !== 'string' || typeof statDate !== 'string') {
    return sendError(reply, 400, 'clientId y statDate son obligatorios', 'INVALID_PAYLOAD');
  }

  const stat = upsertDailyStat({
    clientId,
    statDate,
    revenue: parseNumber((req.body as any)?.revenue),
    roas: parseNumber((req.body as any)?.roas),
    clicks: parseNumber((req.body as any)?.clicks),
    conversions: parseNumber((req.body as any)?.conversions),
    cpa: parseNumber((req.body as any)?.cpa),
    leads: parseNumber((req.body as any)?.leads),
    traffic: parseNumber((req.body as any)?.traffic),
    notes: typeof notes === 'string' ? notes : null,
    source: typeof source === 'string' && source.trim() ? source : 'manual',
  });

  return reply.code(201).send({ stat });
});

app.put('/api/daily-stats/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const existing = getDailyStatById((req.params as any).id) as any;
  if (!existing) {
    return sendError(reply, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }

  const stat = upsertDailyStat({
    clientId: existing.clientId,
    statDate: existing.statDate,
    revenue: parseNumber((req.body as any)?.revenue, existing.revenue),
    roas: parseNumber((req.body as any)?.roas, existing.roas),
    clicks: parseNumber((req.body as any)?.clicks, existing.clicks),
    conversions: parseNumber((req.body as any)?.conversions, existing.conversions),
    cpa: parseNumber((req.body as any)?.cpa, existing.cpa),
    leads: parseNumber((req.body as any)?.leads, existing.leads),
    traffic: parseNumber((req.body as any)?.traffic, existing.traffic),
    notes: typeof (req.body as any)?.notes === 'string' ? (req.body as any).notes : existing.notes,
    source: typeof (req.body as any)?.source === 'string' && (req.body as any).source.trim() ? (req.body as any).source : existing.source,
  });

  return reply.send({ stat });
});

app.delete('/api/daily-stats/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const removed = deleteDailyStat((req.params as any).id);
  if (!removed) {
    return sendError(reply, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }

  return reply.code(204).send();
});

app.get('/api/clients/:clientId/ux-snapshots', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }
  if (!requireClientAccess(reply, session, (req.params as any).clientId)) {
    return;
  }

  return reply.send({ snapshots: listUxSnapshots((req.params as any).clientId) });
});

app.post('/api/clients/:clientId/ux-snapshots', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { snapshotDate, notes, source, payloadJson } = (req.body ?? {}) as any;
  if (typeof snapshotDate !== 'string' || !snapshotDate.trim()) {
    return sendError(reply, 400, 'snapshotDate es obligatorio', 'INVALID_PAYLOAD');
  }

  const snapshot = upsertUxSnapshot({
    clientId: (req.params as any).clientId,
    snapshotDate,
    sessions: parseNumber((req.body as any)?.sessions),
    pageViews: parseNumber((req.body as any)?.pageViews),
    rageClicks: parseNumber((req.body as any)?.rageClicks),
    deadClicks: parseNumber((req.body as any)?.deadClicks),
    scrollDepthAvg: parseNumber((req.body as any)?.scrollDepthAvg),
    engagedSessions: parseNumber((req.body as any)?.engagedSessions),
    conversions: parseNumber((req.body as any)?.conversions),
    conversionRate: parseNumber((req.body as any)?.conversionRate),
    notes: typeof notes === 'string' ? notes : null,
    source: typeof source === 'string' && source.trim() ? source : 'clarity',
    payloadJson: typeof payloadJson === 'string' && payloadJson.trim() ? payloadJson : JSON.stringify((req.body ?? {}) as any),
  });

  if (!snapshot) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return reply.code(201).send({ snapshot });
});

app.get('/api/clients/:clientId/operational-plans/:domain', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  const { clientId, domain } = req.params as { clientId: string; domain: unknown };
  const periodKey = (req.query as any)?.period;
  if (!isOperationalPlanDomain(domain) || !isPlanPeriod(periodKey)) return sendError(reply, 400, 'Dominio o periodo inválido', 'INVALID_PAYLOAD');
  if (!requireClientAccess(reply, session, clientId)) return;
  if (!getClientByIdRecord(clientId)) return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  return reply.send({ plan: getOperationalPlan(clientId, domain, periodKey) });
});

app.put('/api/clients/:clientId/operational-plans/:domain', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) return;
  const { clientId, domain } = req.params as { clientId: string; domain: unknown };
  const { periodKey, version, rows } = (req.body ?? {}) as any;
  if (!isOperationalPlanDomain(domain) || !isPlanPeriod(periodKey) || !Number.isInteger(version) || version < 0) {
    return sendError(reply, 400, 'Dominio, periodo o versión inválidos', 'INVALID_PAYLOAD');
  }
  if (!requireClientAccess(reply, session, clientId)) return;
  if (!getClientByIdRecord(clientId)) return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  const normalizedRows = normalizeOperationalPlanRows(domain, rows);
  if (!normalizedRows) return sendError(reply, 400, 'Filas del plan inválidas o demasiado numerosas', 'INVALID_PAYLOAD');
  const saved = saveOperationalPlan({ clientId, domain, periodKey, version, rows: normalizedRows });
  if (!saved) return sendError(reply, 409, 'El plan cambió en otro navegador. Recarga antes de guardar.', 'STALE_VERSION');
  return reply.send({ plan: saved });
});

app.get('/api/clients/:clientId/rrss-channels', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }
  if (!requireClientAccess(reply, session, (req.params as any).clientId)) {
    return;
  }

  return reply.send({ channels: listRrssChannels((req.params as any).clientId) });
});

app.post('/api/clients/:clientId/rrss-channels', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { platformKey, label, isActive, sortOrder } = (req.body ?? {}) as any;
  if (typeof platformKey !== 'string' || typeof label !== 'string') {
    return sendError(reply, 400, 'platformKey y label son obligatorios', 'INVALID_PAYLOAD');
  }

  const channel = saveRrssChannel({
    clientId: (req.params as any).clientId,
    platformKey,
    label,
    isActive: typeof isActive === 'boolean' ? isActive : undefined,
    sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
  });

  if (!channel) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return reply.code(201).send({ channel });
});

app.put('/api/rrss-channels/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const channel = saveRrssChannel({
    id: (req.params as any).id,
    clientId: typeof (req.body as any)?.clientId === 'string' ? (req.body as any).clientId : '',
    platformKey: typeof (req.body as any)?.platformKey === 'string' ? (req.body as any).platformKey : 'instagram',
    label: typeof (req.body as any)?.label === 'string' ? (req.body as any).label : '',
    isActive: typeof (req.body as any)?.isActive === 'boolean' ? (req.body as any).isActive : undefined,
    sortOrder: typeof (req.body as any)?.sortOrder === 'number' ? (req.body as any).sortOrder : undefined,
  });

  if (!channel) {
    return sendError(reply, 404, 'Canal no encontrado o cliente no válido', 'NOT_FOUND');
  }

  return reply.send({ channel });
});

app.get('/api/clients/:clientId/monthly-kpis', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }
  if (!requireClientAccess(reply, session, (req.params as any).clientId)) {
    return;
  }

  const monthKey = typeof (req.query as any).monthKey === 'string' && (req.query as any).monthKey.trim() ? (req.query as any).monthKey : undefined;
  return reply.send({ kpis: listMonthlyKpis((req.params as any).clientId, monthKey) });
});

app.get('/api/clients/:clientId/reports/daily.pdf', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  const client = getClientByIdRecord(clientId);
  if (!client) return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  const from = (req.query as any)?.from;
  const to = (req.query as any)?.to;
  if (typeof from !== 'string' || typeof to !== 'string') return sendError(reply, 400, 'from y to son obligatorios', 'INVALID_PERIOD');
  try {
    summarizeDailyStats([], from, to);
    const stats = listDailyStats(clientId).filter((stat) => stat.statDate >= from && stat.statDate <= to);
    const pdf = await buildDailyStatsPdf({ clientName: client.name, from, to, generatedAt: new Date().toISOString(), stats });
    return reply.header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `attachment; filename="infidash-${from}-${to}.pdf"`)
      .type('application/pdf').send(pdf);
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'Periodo de informe inválido', 'INVALID_PERIOD');
  }
});

app.get('/api/clients/:clientId/report-runs', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  const before = (req.query as any)?.before;
  const match = typeof before === 'string' ? /^(\d{4}-\d\d-\d\dT[^|]+)\|([0-9a-f-]{36})$/.exec(before) : null;
  if (before !== undefined && (!match || Number.isNaN(Date.parse(match[1])))) return sendError(reply, 400, 'Cursor no válido', 'INVALID_CURSOR');
  const page = listReportRuns(clientId, 51, match ? { at: match[1], id: match[2] } : undefined);
  const runs = page.slice(0, 50);
  const last = runs.at(-1);
  return reply.send({ runs, nextCursor: page.length > 50 && last ? `${last.generatedAt}|${last.id}` : null, smtpConfigured: reportSmtpConfigured() });
});

app.post('/api/clients/:clientId/report-runs', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  const client = getClientByIdRecord(clientId);
  if (!client) return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  const { from, to } = (req.body ?? {}) as any;
  try {
    summarizeDailyStats([], from, to);
    const stats = listDailyStats(clientId).filter((stat) => stat.statDate >= from && stat.statDate <= to);
    const pdf = await buildDailyStatsPdf({ clientName: client.name, from, to, generatedAt: new Date().toISOString(), stats });
    return reply.code(201).send({ run: saveReportRun({ clientId, from, to, createdByUserId: session.user.id, pdf }) });
  } catch (error) {
    return sendError(reply, 400, error instanceof Error ? error.message : 'Periodo no válido', 'INVALID_PERIOD');
  }
});

app.get('/api/clients/:clientId/report-runs/:id/daily.pdf', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  const run = getReportRun(clientId, String((req.params as any).id));
  if (!run) return sendError(reply, 404, 'Informe no encontrado', 'NOT_FOUND');
  const pdf = getReportRunPdf(clientId, run.id);
  return reply.header('Cache-Control', 'private, no-store')
    .header('Content-Disposition', `attachment; filename="infidash-${run.from}-${run.to}.pdf"`)
    .type('application/pdf').send(pdf);
});

app.post('/api/clients/:clientId/report-runs/:id/send', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  const run = getReportRun(clientId, String((req.params as any).id));
  const client = getClientByIdRecord(clientId);
  if (!run || !client) return sendError(reply, 404, 'Informe no encontrado', 'NOT_FOUND');
  const recipient = (req.body as any)?.recipient;
  if (typeof recipient !== 'string' || recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return sendError(reply, 400, 'Correo destinatario no válido', 'INVALID_RECIPIENT');
  if (!reportSmtpConfigured()) return sendError(reply, 503, 'SMTP no configurado', 'SMTP_UNCONFIGURED');
  try {
    await sendReportEmail({ recipient, clientName: client.name, from: run.from, to: run.to, pdf: getReportRunPdf(clientId, run.id)! });
    recordReportSend(clientId, run.id, recipient, null);
    return reply.send({ run: getReportRun(clientId, run.id) });
  } catch {
    recordReportSend(clientId, run.id, recipient, 'Entrega no confirmada');
    return sendError(reply, 502, 'No se pudo confirmar la entrega SMTP; revisa el buzón antes de repetir', 'SMTP_DELIVERY_UNKNOWN');
  }
});

app.get('/api/clients/:clientId/monthly-kpi-cycles', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) return;
  const clientId = String((req.params as any).clientId);
  if (!requireClientAccess(reply, session, clientId)) return;
  return reply.send({ cycles: listMonthlyKpiCycles(clientId) });
});

app.post('/api/clients/:clientId/monthly-kpis', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const { departmentKey, metricKey, monthKey, targetText, actualText, notes } = (req.body ?? {}) as any;
  const normalizedDepartmentKey = departmentKey === 'web' || departmentKey === 'rrss' ? departmentKey : departmentKey === 'publicidad' ? departmentKey : null;
  if (!normalizedDepartmentKey || typeof metricKey !== 'string' || typeof monthKey !== 'string') {
    return sendError(reply, 400, 'departmentKey, metricKey y monthKey son obligatorios', 'INVALID_PAYLOAD');
  }

  let kpi;
  try {
    kpi = saveMonthlyKpi({
    clientId: (req.params as any).clientId,
    departmentKey: normalizedDepartmentKey,
    metricKey,
    monthKey,
    targetValue: typeof (req.body as any)?.targetValue === 'number' ? (req.body as any).targetValue : null,
    targetText: typeof targetText === 'string' ? targetText : null,
    actualValue: typeof (req.body as any)?.actualValue === 'number' ? (req.body as any).actualValue : null,
    actualText: typeof actualText === 'string' ? actualText : null,
    status: typeof (req.body as any)?.status === 'string' ? (req.body as any).status as any : undefined,
    differenceValue: typeof (req.body as any)?.differenceValue === 'number' ? (req.body as any).differenceValue : null,
    differencePct: typeof (req.body as any)?.differencePct === 'number' ? (req.body as any).differencePct : null,
    notes: typeof notes === 'string' ? notes : null,
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar el KPI';
    return sendError(reply, /cerrad/i.test(message) ? 409 : 400, message, /cerrad/i.test(message) ? 'MONTHLY_KPI_CLOSED' : 'INVALID_PAYLOAD');
  }

  if (!kpi) {
    return sendError(reply, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return reply.code(201).send({ kpi });
});

app.put('/api/monthly-kpis/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const current = getMonthlyKpiById((req.params as any).id);
  if (!current) return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
  if (typeof (req.body as any)?.clientId === 'string' && (req.body as any).clientId !== current.clientId) {
    return sendError(reply, 400, 'El KPI no pertenece a ese cliente', 'INVALID_PAYLOAD');
  }
  let kpi;
  try {
    kpi = saveMonthlyKpi({
    id: (req.params as any).id,
    clientId: current.clientId,
    departmentKey: ((req.body as any)?.departmentKey === 'web' || (req.body as any)?.departmentKey === 'rrss' ? (req.body as any).departmentKey : (req.body as any)?.departmentKey === 'publicidad' ? (req.body as any).departmentKey : current?.departmentKey ?? 'publicidad') as any,
    metricKey: typeof (req.body as any)?.metricKey === 'string' ? (req.body as any).metricKey : current?.metricKey ?? '',
    monthKey: typeof (req.body as any)?.monthKey === 'string' ? (req.body as any).monthKey : current?.monthKey ?? '',
    targetValue: typeof (req.body as any)?.targetValue === 'number' ? (req.body as any).targetValue : current?.targetValue ?? null,
    targetText: typeof (req.body as any)?.targetText === 'string' ? (req.body as any).targetText : current?.targetText ?? null,
    actualValue: typeof (req.body as any)?.actualValue === 'number' ? (req.body as any).actualValue : current?.actualValue ?? null,
    actualText: typeof (req.body as any)?.actualText === 'string' ? (req.body as any).actualText : current?.actualText ?? null,
    status: typeof (req.body as any)?.status === 'string' ? (req.body as any).status as any : current?.status,
    differenceValue: typeof (req.body as any)?.differenceValue === 'number' ? (req.body as any).differenceValue : current?.differenceValue ?? null,
    differencePct: typeof (req.body as any)?.differencePct === 'number' ? (req.body as any).differencePct : current?.differencePct ?? null,
    notes: typeof (req.body as any)?.notes === 'string' ? (req.body as any).notes : current?.notes ?? null,
    createdByUserId: current?.createdByUserId ?? session.user.id,
    updatedByUserId: session.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar el KPI';
    return sendError(reply, /cerrad/i.test(message) ? 409 : 400, message, /cerrad/i.test(message) ? 'MONTHLY_KPI_CLOSED' : 'INVALID_PAYLOAD');
  }

  if (!kpi) {
    return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
  }

  return reply.send({ kpi });
});

app.post('/api/monthly-kpis/:id/close', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const existing = getMonthlyKpiById((req.params as any).id);
  if (!existing) {
    return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
  }
  closeMonthlyKpiCycle(existing.clientId, existing.monthKey, session.user.id);
  return reply.send({ kpi: getMonthlyKpiById(existing.id) });
});

app.post('/api/monthly-kpis/:id/reopen', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) return;
  const reason = (req.body as any)?.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    return sendError(reply, 400, 'La reapertura requiere un motivo de hasta 500 caracteres', 'INVALID_PAYLOAD');
  }
  try {
    const existing = getMonthlyKpiById(String((req.params as any).id));
    if (!existing) return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
    const cycle = reopenMonthlyKpiCycle(existing.clientId, existing.monthKey, session.user.id, reason);
    if (!cycle) return sendError(reply, 409, 'El ciclo no está cerrado', 'MONTHLY_KPI_CONFLICT');
    return reply.send({ kpi: getMonthlyKpiById(existing.id) });
  } catch (error) {
    return sendError(reply, 409, error instanceof Error ? error.message : 'No se pudo reabrir el KPI', 'MONTHLY_KPI_CONFLICT');
  }
});

app.get('/api/monthly-kpis/:id/events', (req: AnyFastifyRequest, reply: FastifyReply) => {
  if (!requireSession(req, reply, ['admin'])) return;
  const id = String((req.params as any).id);
  if (!getMonthlyKpiById(id)) return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
  return reply.send({ events: listMonthlyKpiEvents(id) });
});

app.post('/api/admin/backup', async (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  try {
    const backup = await createDatabaseBackup(typeof (req.body as any)?.label === 'string' ? (req.body as any).label : null);
    return reply.code(201).send({ backup });
  } catch (error) {
    console.error('[infidash] backup failed', error);
    return sendError(reply, 500, 'No se pudo crear la copia de seguridad', 'BACKUP_FAILED');
  }
});

app.get('/api/dashboard/summary', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const scope = session.user.role === 'admin' ? undefined : session.user.clientIds ?? [];
  return reply.send({
    summary: getDashboardHealthSummary({ clientIds: scope }),
    clients: listClients({ clientIds: scope }),
  });
});

if (shouldServeHttp(process.env)) {
  if (existsSync(distPath)) {
    app.register(fastifyStatic, {
      root: distPath,
      index: ['index.html'],
    });
  }

  app.setNotFoundHandler((request: AnyFastifyRequest, reply: FastifyReply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/') && existsSync(indexHtmlPath)) {
      return reply.type('text/html').sendFile('index.html');
    }

    return sendError(reply, 404, 'Ruta no encontrada', 'NOT_FOUND');
  });
}

if (process.env.NODE_ENV !== 'test') {
  startClaritySyncScheduler();
  startMonthlyKpiCloseScheduler();
}

if (shouldServeHttp(process.env)) {
  void app
    .listen({ port, host: '0.0.0.0' })
    .then(() => {
      console.log(`[infidash] API escuchando en http://127.0.0.1:${port}`);
    })
    .catch((error) => {
      console.error('[infidash] failed to start', error);
      process.exit(1);
    });
}

export { app };






