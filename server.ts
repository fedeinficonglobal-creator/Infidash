import * as expressModule from 'express';
import type { NextFunction, Request, Response } from 'express';
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

const express = ((expressModule as unknown as { default?: typeof import('express') }).default ?? expressModule) as typeof import('express');
const app = express();
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const distPath = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distPath, 'index.html');

app.use(express.json({ limit: '1mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

function sendError(res: Response, status: number, message: string, code?: string) {
  return res.status(status).json({ error: message, code });
}

function getBearerToken(req: Request) {
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  const sessionToken = req.header('x-session-token');
  return sessionToken?.trim() || null;
}

function requireSession(req: Request, res: Response, roles?: UserRole[]) {
  const token = getBearerToken(req);
  if (!token) {
    sendError(res, 401, 'Sesión no autenticada', 'UNAUTHENTICATED');
    return null;
  }

  const session = getSessionByToken(token);
  if (!session) {
    sendError(res, 401, 'Sesión expirada o inválida', 'INVALID_SESSION');
    return null;
  }

  if (roles && !roles.includes(session.user.role)) {
    sendError(res, 403, 'No tienes permisos para realizar esta acción', 'FORBIDDEN');
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

app.get('/api/health', (_req, res) => {
  return res.json({
    status: 'ok',
    ...getDashboardHealthSummary(),
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendError(res, 400, 'email y password son obligatorios', 'INVALID_PAYLOAD');
  }

  const result = authenticateUser(email, password);
  if (!result) {
    return sendError(res, 401, 'Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  return res.json(result);
});

app.get('/api/auth/me', (req, res) => {
  const session = requireSession(req, res);
  if (!session) {
    return;
  }

  return res.json(session);
});

app.post('/api/auth/logout', (req, res) => {
  const session = requireSession(req, res);
  if (!session) {
    return;
  }

  return res.status(204).send();
});

app.get('/api/users', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  return res.json({ users: listUsers() });
});

app.post('/api/users', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { email, name, password, role } = req.body ?? {};
  if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
    return sendError(res, 400, 'email, name y password son obligatorios', 'INVALID_PAYLOAD');
  }

  const normalizedRole: UserRole = role === 'viewer' ? 'viewer' : 'admin';
  const user = createUser({ email, name, password, role: normalizedRole });
  return res.status(201).json({ user });
});

app.patch('/api/users/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const updated = updateUserRole(req.params.id, {
    role: req.body?.role === 'viewer' ? 'viewer' : req.body?.role === 'admin' ? 'admin' : undefined,
    active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    name: typeof req.body?.name === 'string' ? req.body.name : undefined,
  });

  if (!updated) {
    return sendError(res, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  return res.json({ user: updated });
});

app.delete('/api/users/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  if (req.params.id === session.user.id) {
    return sendError(res, 400, 'No puedes eliminar tu propia cuenta', 'SELF_DELETE_FORBIDDEN');
  }

  const userToDelete = listUsers().find((user) => user.id === req.params.id);
  if (!userToDelete) {
    return sendError(res, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  const adminCount = listUsers().filter((user) => user.role === 'admin').length;
  if (userToDelete.role === 'admin' && adminCount <= 1) {
    return sendError(res, 409, 'No puedes eliminar el último administrador', 'LAST_ADMIN_FORBIDDEN');
  }

  const deleted = deleteUser(req.params.id);
  if (!deleted) {
    return sendError(res, 404, 'Usuario no encontrado', 'NOT_FOUND');
  }

  return res.status(204).send();
});

app.get('/api/clients', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  return res.json({ clients: listClientsWithLatestStat() });
});

app.get('/api/clients/:slug', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const client = getClientBySlug(req.params.slug);
  if (!client) {
    return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return res.json({ client });
});

app.get('/api/clients/:clientId/dashboard', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const client = getClientBySlug(req.params.clientId) ?? listClients().find((item) => item.id === req.params.clientId) ?? null;
  if (!client) {
    return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  const dailyStats = listDailyStats(client.id);
  const uxSnapshots = listUxSnapshots(client.id);
  const latestUxSnapshot = getLatestUxSnapshot(client.id);

  return res.json({
    client,
    dailyStats,
    uxSnapshots,
    latestUxSnapshot,
  });
});

app.post('/api/clients', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { name, industry, logoUrl, healthScore, kpiThresholds } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'name es obligatorio', 'INVALID_PAYLOAD');
  }

  const client = createClient({
    name,
    industry: typeof industry === 'string' && industry.trim() ? industry : null,
    logoUrl: typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl : null,
    healthScore: typeof healthScore === 'number' ? healthScore : undefined,
    kpiThresholds: kpiThresholds && typeof kpiThresholds === 'object' ? kpiThresholds : null,
  });

  return res.status(201).json({ client });
});

app.get('/api/clients/:clientId/integrations', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const clientIntegrations = getClientIntegrations(req.params.clientId);
  return res.json({ integrations: clientIntegrations });
});

app.post('/api/integrations', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { id, clientId, provider, label, config, credentials, status, lastError } = req.body ?? {};
  if (typeof clientId !== 'string' || typeof provider !== 'string') {
    return sendError(res, 400, 'clientId y provider son obligatorios', 'INVALID_PAYLOAD');
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
      return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
    }

    return res.status(201).json({ integration: saved });
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : 'No se pudo guardar la integración', 'INVALID_INTEGRATION');
  }
});

app.patch('/api/integrations/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const existing = getIntegrationById(req.params.id);
  if (!existing) {
    return sendError(res, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  try {
    const saved = createOrUpdateClientIntegration({
      id: existing.id,
      clientId: existing.clientId,
      provider: existing.provider,
      label: typeof req.body?.label === 'string' ? req.body.label : existing.label,
      config: req.body?.config && typeof req.body.config === 'object' ? req.body.config : null,
      credentials: req.body?.credentials && typeof req.body.credentials === 'object' ? req.body.credentials : null,
      status: typeof req.body?.status === 'string' ? req.body.status as any : existing.status,
      lastError: typeof req.body?.lastError === 'string' ? req.body.lastError : existing.lastError,
    });

    return res.json({ integration: saved });
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : 'No se pudo actualizar la integración', 'INVALID_INTEGRATION');
  }
});

app.post('/api/integrations/:id/test', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const result = testIntegrationById(req.params.id);
  if (!result) {
    return sendError(res, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  return res.json(result);
});

app.post('/api/integrations/:id/sync', async (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const integration = getIntegrationById(req.params.id);
  if (!integration) {
    return sendError(res, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  try {
    const result = await syncClarityIntegration(integration.id);
    if (!result) {
      return sendError(res, 404, 'Integración no encontrada', 'NOT_FOUND');
    }

    return res.json({
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
    return sendError(res, 500, message, 'CLARITY_SYNC_FAILED');
  }
});

app.delete('/api/integrations/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const removed = removeClientIntegration(req.params.id);
  if (!removed) {
    return sendError(res, 404, 'Integración no encontrada', 'NOT_FOUND');
  }

  return res.status(204).send();
});

app.get('/api/daily-stats', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
  return res.json({ stats: listDailyStats(clientId) });
});

app.get('/api/daily-stats/:id', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const stat = getDailyStatById(req.params.id);
  if (!stat) {
    return sendError(res, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }

  return res.json({ stat });
});

app.post('/api/daily-stats', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { clientId, statDate, notes, source } = req.body ?? {};
  if (typeof clientId !== 'string' || typeof statDate !== 'string') {
    return sendError(res, 400, 'clientId y statDate son obligatorios', 'INVALID_PAYLOAD');
  }

  const stat = upsertDailyStat({
    clientId,
    statDate,
    revenue: parseNumber(req.body?.revenue),
    roas: parseNumber(req.body?.roas),
    clicks: parseNumber(req.body?.clicks),
    conversions: parseNumber(req.body?.conversions),
    cpa: parseNumber(req.body?.cpa),
    leads: parseNumber(req.body?.leads),
    traffic: parseNumber(req.body?.traffic),
    notes: typeof notes === 'string' ? notes : null,
    source: typeof source === 'string' && source.trim() ? source : 'manual',
  });

  return res.status(201).json({ stat });
});

app.put('/api/daily-stats/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const existing = getDailyStatById(req.params.id);
  if (!existing) {
    return sendError(res, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }

  const stat = upsertDailyStat({
    clientId: existing.clientId,
    statDate: existing.statDate,
    revenue: parseNumber(req.body?.revenue, existing.revenue),
    roas: parseNumber(req.body?.roas, existing.roas),
    clicks: parseNumber(req.body?.clicks, existing.clicks),
    conversions: parseNumber(req.body?.conversions, existing.conversions),
    cpa: parseNumber(req.body?.cpa, existing.cpa),
    leads: parseNumber(req.body?.leads, existing.leads),
    traffic: parseNumber(req.body?.traffic, existing.traffic),
    notes: typeof req.body?.notes === 'string' ? req.body.notes : existing.notes,
    source: typeof req.body?.source === 'string' && req.body.source.trim() ? req.body.source : existing.source,
  });

  return res.json({ stat });
});

app.delete('/api/daily-stats/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const removed = deleteDailyStat(req.params.id);
  if (!removed) {
    return sendError(res, 404, 'Estadística no encontrada', 'NOT_FOUND');
  }

  return res.status(204).send();
});

app.get('/api/clients/:clientId/ux-snapshots', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  return res.json({ snapshots: listUxSnapshots(req.params.clientId) });
});

app.post('/api/clients/:clientId/ux-snapshots', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { snapshotDate, notes, source, payloadJson } = req.body ?? {};
  if (typeof snapshotDate !== 'string' || !snapshotDate.trim()) {
    return sendError(res, 400, 'snapshotDate es obligatorio', 'INVALID_PAYLOAD');
  }

  const snapshot = upsertUxSnapshot({
    clientId: req.params.clientId,
    snapshotDate,
    sessions: parseNumber(req.body?.sessions),
    pageViews: parseNumber(req.body?.pageViews),
    rageClicks: parseNumber(req.body?.rageClicks),
    deadClicks: parseNumber(req.body?.deadClicks),
    scrollDepthAvg: parseNumber(req.body?.scrollDepthAvg),
    engagedSessions: parseNumber(req.body?.engagedSessions),
    conversions: parseNumber(req.body?.conversions),
    conversionRate: parseNumber(req.body?.conversionRate),
    notes: typeof notes === 'string' ? notes : null,
    source: typeof source === 'string' && source.trim() ? source : 'clarity',
    payloadJson: typeof payloadJson === 'string' && payloadJson.trim() ? payloadJson : JSON.stringify(req.body ?? {}),
  });

  if (!snapshot) {
    return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return res.status(201).json({ snapshot });
});

app.get('/api/clients/:clientId/rrss-channels', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  return res.json({ channels: listRrssChannels(req.params.clientId) });
});

app.post('/api/clients/:clientId/rrss-channels', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { platformKey, label, isActive, sortOrder } = req.body ?? {};
  if (typeof platformKey !== 'string' || typeof label !== 'string') {
    return sendError(res, 400, 'platformKey y label son obligatorios', 'INVALID_PAYLOAD');
  }

  const channel = saveRrssChannel({
    clientId: req.params.clientId,
    platformKey,
    label,
    isActive: typeof isActive === 'boolean' ? isActive : undefined,
    sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
  });

  if (!channel) {
    return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return res.status(201).json({ channel });
});

app.put('/api/rrss-channels/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const channel = saveRrssChannel({
    id: req.params.id,
    clientId: typeof req.body?.clientId === 'string' ? req.body.clientId : '',
    platformKey: typeof req.body?.platformKey === 'string' ? req.body.platformKey : 'instagram',
    label: typeof req.body?.label === 'string' ? req.body.label : '',
    isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
    sortOrder: typeof req.body?.sortOrder === 'number' ? req.body.sortOrder : undefined,
  });

  if (!channel) {
    return sendError(res, 404, 'Canal no encontrado o cliente no válido', 'NOT_FOUND');
  }

  return res.json({ channel });
});

app.get('/api/clients/:clientId/monthly-kpis', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  const monthKey = typeof req.query.monthKey === 'string' && req.query.monthKey.trim() ? req.query.monthKey : undefined;
  return res.json({ kpis: listMonthlyKpis(req.params.clientId, monthKey) });
});

app.post('/api/clients/:clientId/monthly-kpis', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const { departmentKey, metricKey, monthKey, targetText, actualText, notes } = req.body ?? {};
  const normalizedDepartmentKey = departmentKey === 'web' || departmentKey === 'rrss' ? departmentKey : departmentKey === 'publicidad' ? departmentKey : null;
  if (!normalizedDepartmentKey || typeof metricKey !== 'string' || typeof monthKey !== 'string') {
    return sendError(res, 400, 'departmentKey, metricKey y monthKey son obligatorios', 'INVALID_PAYLOAD');
  }

  const kpi = saveMonthlyKpi({
    clientId: req.params.clientId,
    departmentKey: normalizedDepartmentKey,
    metricKey,
    monthKey,
    targetValue: typeof req.body?.targetValue === 'number' ? req.body.targetValue : null,
    targetText: typeof targetText === 'string' ? targetText : null,
    actualValue: typeof req.body?.actualValue === 'number' ? req.body.actualValue : null,
    actualText: typeof actualText === 'string' ? actualText : null,
    status: typeof req.body?.status === 'string' ? req.body.status as any : undefined,
    differenceValue: typeof req.body?.differenceValue === 'number' ? req.body.differenceValue : null,
    differencePct: typeof req.body?.differencePct === 'number' ? req.body.differencePct : null,
    notes: typeof notes === 'string' ? notes : null,
    createdByUserId: session.user.id,
    updatedByUserId: session.user.id,
  });

  if (!kpi) {
    return sendError(res, 404, 'Cliente no encontrado', 'NOT_FOUND');
  }

  return res.status(201).json({ kpi });
});

app.put('/api/monthly-kpis/:id', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const current = listMonthlyKpis(typeof req.body?.clientId === 'string' ? req.body.clientId : '', typeof req.body?.monthKey === 'string' ? req.body.monthKey : undefined).find((item) => item.id === req.params.id) ?? null;
  const kpi = saveMonthlyKpi({
    id: req.params.id,
    clientId: typeof req.body?.clientId === 'string' ? req.body.clientId : current?.clientId ?? '',
    departmentKey: (req.body?.departmentKey === 'web' || req.body?.departmentKey === 'rrss' ? req.body.departmentKey : req.body?.departmentKey === 'publicidad' ? req.body.departmentKey : current?.departmentKey ?? 'publicidad') as any,
    metricKey: typeof req.body?.metricKey === 'string' ? req.body.metricKey : current?.metricKey ?? '',
    monthKey: typeof req.body?.monthKey === 'string' ? req.body.monthKey : current?.monthKey ?? '',
    targetValue: typeof req.body?.targetValue === 'number' ? req.body.targetValue : current?.targetValue ?? null,
    targetText: typeof req.body?.targetText === 'string' ? req.body.targetText : current?.targetText ?? null,
    actualValue: typeof req.body?.actualValue === 'number' ? req.body.actualValue : current?.actualValue ?? null,
    actualText: typeof req.body?.actualText === 'string' ? req.body.actualText : current?.actualText ?? null,
    status: typeof req.body?.status === 'string' ? req.body.status as any : current?.status,
    differenceValue: typeof req.body?.differenceValue === 'number' ? req.body.differenceValue : current?.differenceValue ?? null,
    differencePct: typeof req.body?.differencePct === 'number' ? req.body.differencePct : current?.differencePct ?? null,
    notes: typeof req.body?.notes === 'string' ? req.body.notes : current?.notes ?? null,
    createdByUserId: current?.createdByUserId ?? session.user.id,
    updatedByUserId: session.user.id,
  });

  if (!kpi) {
    return sendError(res, 404, 'KPI no encontrado', 'NOT_FOUND');
  }

  return res.json({ kpi });
});

app.post('/api/monthly-kpis/:id/close', (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  const kpi = closeMonthlyKpi(req.params.id);
  if (!kpi) {
    return sendError(res, 404, 'KPI no encontrado', 'NOT_FOUND');
  }

  return res.json({ kpi });
});

app.post('/api/admin/backup', async (req, res) => {
  const session = requireSession(req, res, ['admin']);
  if (!session) {
    return;
  }

  try {
    const backup = await createDatabaseBackup(typeof req.body?.label === 'string' ? req.body.label : null);
    return res.status(201).json({ backup });
  } catch (error) {
    console.error('[infidash] backup failed', error);
    return sendError(res, 500, 'No se pudo crear la copia de seguridad', 'BACKUP_FAILED');
  }
});

app.get('/api/dashboard/summary', (req, res) => {
  const session = requireSession(req, res, ['viewer', 'admin']);
  if (!session) {
    return;
  }

  return res.json({
    summary: getDashboardHealthSummary(),
    clients: listClients(),
  });
});

if (process.env.NODE_ENV !== 'test') {
  if (existsSync(distPath)) {
    app.use(express.static(distPath, { extensions: ['html'] }));
  }

  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
    if (existsSync(indexHtmlPath)) {
      return res.sendFile(indexHtmlPath);
    }

    return next();
  });
}

app.use((_req, res) => {
  return sendError(res, 404, 'Ruta no encontrada', 'NOT_FOUND');
});

if (process.env.NODE_ENV !== 'test') {
  startClaritySyncScheduler();
  app.listen(port, () => {
    console.log(`[infidash] API escuchando en http://127.0.0.1:${port}`);
  });
}

export { app };
