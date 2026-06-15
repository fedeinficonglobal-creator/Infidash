// @ts-nocheck
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  authenticateUser,
  closeMonthlyKpi,
  createClient,
  createDatabaseBackup,
  createUser,
  createOrUpdateClientIntegration,
  deleteDailyStat,
  deleteUser,
  getClientBySlug,
  getClientIntegrations,
  getDailyStatById,
  getDashboardHealthSummary,
  getIntegrationById,
  getIntegrationCredentialsById,
  getLatestUxSnapshot,
  getSessionByToken,
  listClients,
  listClientsWithLatestStat,
  listDailyStats,
  listUxSnapshots,
  listIntegrationsByProvider,
  listMonthlyKpis,
  listRrssChannels,
  listUsers,
  removeClientIntegration,
  saveMonthlyKpi,
  saveRrssChannel,
  testIntegrationById,
  updateIntegrationSyncState,
  updateUserRole,
  upsertDailyStat,
  upsertUxSnapshot,
  type UserRole,
} from './src/lib/database.js';
import { fetchClaritySnapshots } from './src/lib/claritySync.js';

const app = fastify({
  logger: false,
  bodyLimit: 1_000_000,
});

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

let claritySyncRunning = false;

async function syncAllClarityIntegrations() {
  if (claritySyncRunning) {
    return;
  }

  claritySyncRunning = true;
  try {
    const integrations = listIntegrationsByProvider('clarity');
    for (const integration of integrations) {
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

  const intervalMs = Number(process.env.CLARITY_SYNC_INTERVAL_MS ?? 15 * 60 * 1000);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 15 * 60 * 1000;
  const globalState = globalThis as typeof globalThis & { __infidashClaritySyncInterval?: ReturnType<typeof setInterval> };
  if (globalState.__infidashClaritySyncInterval) {
    return;
  }

  const run = () => {
    void syncAllClarityIntegrations().catch((error) => {
      console.error('[infidash] clarity sync scheduler failed', error);
    });
  };

  run();
  globalState.__infidashClaritySyncInterval = setInterval(run, safeInterval);
}

app.get('/api/health', (_req: AnyFastifyRequest, reply: FastifyReply) => {
  return reply.send({
    status: 'ok',
    ...getDashboardHealthSummary(),
  });
});

app.post('/api/auth/login', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const { email, password } = (req.body ?? {}) as any;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendError(reply, 400, 'email y password son obligatorios', 'INVALID_PAYLOAD');
  }

  const result = authenticateUser(email, password);
  if (!result) {
    return sendError(reply, 401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

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

  const { email, name, password, role } = (req.body ?? {}) as any;
  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return sendError(reply, 400, 'email, name y password son obligatorios', 'INVALID_PAYLOAD');
  }

  const normalizedRole: UserRole = role === 'viewer' ? 'viewer' : 'admin';
  const user = createUser({ email, name, password, role: normalizedRole });
  return reply.code(201).send({ user });
});

app.patch('/api/users/:id', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const updated = updateUserRole((req.params as any).id, {
    role: (req.body as any)?.role === 'viewer' ? 'viewer' : (req.body as any)?.role === 'admin' ? 'admin' : undefined,
    active: typeof (req.body as any)?.active === 'boolean' ? (req.body as any).active : undefined,
    name: typeof (req.body as any)?.name === 'string' ? (req.body as any).name : undefined,
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

  return reply.send({ clients: listClientsWithLatestStat() });
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

app.get('/api/clients/:clientId/integrations', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const clientIntegrations = getClientIntegrations((req.params as any).clientId);
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

app.post('/api/integrations/:id/test', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['admin']);
  if (!session) {
    return;
  }

  const result = testIntegrationById((req.params as any).id);
  if (!result) {
    return sendError(reply, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  return reply.send(result);
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
  return reply.send({ stats: listDailyStats(clientId) });
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

app.get('/api/clients/:clientId/rrss-channels', (req: AnyFastifyRequest, reply: FastifyReply) => {
  const session = requireSession(req, reply, ['viewer', 'admin']);
  if (!session) {
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

  const monthKey = typeof (req.query as any).monthKey === 'string' && (req.query as any).monthKey.trim() ? (req.query as any).monthKey : undefined;
  return reply.send({ kpis: listMonthlyKpis((req.params as any).clientId, monthKey) });
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

  const kpi = saveMonthlyKpi({
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

  const current = listMonthlyKpis(typeof (req.body as any)?.clientId === 'string' ? (req.body as any).clientId : '', typeof (req.body as any)?.monthKey === 'string' ? (req.body as any).monthKey : undefined).find((item) => item.id === (req.params as any).id) ?? null;
  const kpi = saveMonthlyKpi({
    id: (req.params as any).id,
    clientId: typeof (req.body as any)?.clientId === 'string' ? (req.body as any).clientId : current?.clientId ?? '',
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

  const kpi = closeMonthlyKpi((req.params as any).id);
  if (!kpi) {
    return sendError(reply, 404, 'KPI no encontrado', 'NOT_FOUND');
  }

  return reply.send({ kpi });
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

  return reply.send({
    summary: getDashboardHealthSummary(),
    clients: listClients(),
  });
});

if (process.env.NODE_ENV !== 'test') {
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






