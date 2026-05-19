import type { NextFunction, Request, Response } from 'express';
import {
  authenticateUser,
  createClient,
  createDatabaseBackup,
  createUser,
  deleteDailyStat,
  getClientBySlug,
  getDailyStatById,
  getDashboardHealthSummary,
  getSessionByToken,
  listClients,
  listClientsWithLatestStat,
  listDailyStats,
  listUsers,
  updateUserRole,
  upsertDailyStat,
  type UserRole,
} from './src/lib/database.js';

const expressModule = await import('express');
const express = ((expressModule as unknown as { default?: typeof import('express') }).default ?? expressModule) as typeof import('express');
const app = express();
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

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

app.use((_req, res) => {
  return sendError(res, 404, 'Ruta no encontrada', 'NOT_FOUND');
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`[infidash] API escuchando en http://127.0.0.1:${port}`);
  });
}

export { app };
