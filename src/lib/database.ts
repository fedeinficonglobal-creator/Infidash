import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSessionToken, hashPassword, hashToken, normalizeEmail, nowIso, verifyPassword } from './auth.js';

export type UserRole = 'admin' | 'viewer';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser extends Omit<UserRecord, 'active'> {
  active: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  industry: string | null;
  healthScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyStatRecord {
  id: string;
  clientId: string;
  statDate: string;
  revenue: number;
  roas: number;
  clicks: number;
  conversions: number;
  cpa: number;
  leads: number;
  traffic: number;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedSession {
  token: string;
  user: PublicUser;
  expiresAt: string;
}

export interface LoginResult {
  token: string;
  user: PublicUser;
}

const dbPath = process.env.INFIDASH_DB_PATH ?? path.join(process.cwd(), 'data', 'infidash.sqlite');
const backupDir = process.env.INFIDASH_BACKUP_DIR ?? path.join(process.cwd(), 'data', 'backups');
let database: Database.Database | null = null;

function ensureDirectoryExists(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sanitizeBackupLabel(label?: string | null) {
  if (!label) {
    return 'manual';
  }

  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'manual';
}

function createDatabase() {
  ensureDirectoryExists(dbPath);
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}

function getBackupFilePath(label?: string | null) {
  ensureDirectoryExists(path.join(backupDir, 'backup.sqlite'));
  const stamp = nowIso().replace(/[:.]/g, '-');
  const safeLabel = sanitizeBackupLabel(label);
  return path.join(backupDir, `infidash-${safeLabel}-${stamp}.sqlite`);
}

export async function createDatabaseBackup(label?: string | null) {
  const db = getDatabase();
  const filePath = getBackupFilePath(label);
  await db.backup(filePath);
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    label: sanitizeBackupLabel(label),
    createdAt: nowIso(),
    sizeBytes: stats.size,
  };
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_url TEXT,
      industry TEXT,
      health_score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      credentials_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_sync TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      stat_date TEXT NOT NULL,
      revenue REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      cpa REAL NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      traffic INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(client_id, stat_date)
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      insight_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function seedDefaults(db: Database.Database) {
  const timestamp = nowIso();

  const organization = db.prepare(`SELECT id FROM organizations WHERE slug = ?`).get('infidash') as { id: string } | undefined;
  const orgId = organization?.id ?? crypto.randomUUID();
  if (!organization) {
    db.prepare(
      `INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)`
    ).run(orgId, 'Infidash', 'infidash', timestamp);
  }

  const defaultClients = [
    {
      id: 'matundy',
      name: 'Matundy',
      slug: 'matundy',
      logoUrl: 'https://images.unsplash.com/photo-1522312346375-d1f5dca6d8d2?q=80&w=256&auto=format&fit=crop',
      industry: 'Retail / Ecommerce',
      healthScore: 86,
    },
    {
      id: 'micaela-villa',
      name: 'Micaela Villa',
      slug: 'micaela-villa',
      logoUrl: 'https://images.unsplash.com/photo-1523381235312-3a1ec56d99b7?q=80&w=256&auto=format&fit=crop',
      industry: 'Moda / Joyería',
      healthScore: 84,
    },
    {
      id: 'concha-vega',
      name: 'Concha Vega',
      slug: 'concha-vega',
      logoUrl: 'https://images.unsplash.com/photo-1581578731522-745d05db9ad2?q=80&w=256&auto=format&fit=crop',
      industry: 'Interiorismo / Deco',
      healthScore: 32,
    },
  ];

  const insertClient = db.prepare(
    `INSERT OR IGNORE INTO clients (id, org_id, name, slug, logo_url, industry, health_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const client of defaultClients) {
    insertClient.run(
      client.id,
      orgId,
      client.name,
      client.slug,
      client.logoUrl,
      client.industry,
      client.healthScore,
      timestamp,
      timestamp,
    );
  }

  const adminEmail = normalizeEmail(process.env.INFIDASH_ADMIN_EMAIL ?? 'admin@infidash.local');
  const viewerEmail = normalizeEmail(process.env.INFIDASH_VIEWER_EMAIL ?? 'viewer@infidash.local');
  const adminPassword = process.env.INFIDASH_ADMIN_PASSWORD ?? 'admin1234';
  const viewerPassword = process.env.INFIDASH_VIEWER_PASSWORD ?? 'viewer1234';

  if (process.env.NODE_ENV === 'production') {
    const warnings: string[] = [];
    if (adminPassword === 'admin1234') {
      warnings.push('INFIDASH_ADMIN_PASSWORD');
    }
    if (viewerPassword === 'viewer1234') {
      warnings.push('INFIDASH_VIEWER_PASSWORD');
    }
    if (warnings.length > 0) {
      console.warn(
        `[infidash] Configuración insegura detectada en producción: ${warnings.join(', ')}. ` +
          'Define credenciales personalizadas antes de desplegar.'
      );
    }
  }

  const users = [
    {
      email: adminEmail,
      name: process.env.INFIDASH_ADMIN_NAME ?? 'Administrador',
      role: 'admin' as const,
      password: adminPassword,
    },
    {
      email: viewerEmail,
      name: process.env.INFIDASH_VIEWER_NAME ?? 'Visualizador',
      role: 'viewer' as const,
      password: viewerPassword,
    },
  ];

  const userExists = db.prepare(`SELECT id FROM users WHERE email = ?`);
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  );

  for (const user of users) {
    if (!userExists.get(user.email)) {
      insertUser.run(
        crypto.randomUUID(),
        user.email,
        user.name,
        hashPassword(user.password),
        user.role,
        timestamp,
        timestamp,
      );
    }
  }

  const dailyStatsCount = db.prepare(`SELECT COUNT(*) as total FROM daily_stats`).get() as { total: number };
  if (dailyStatsCount.total === 0) {
    const seedStat = db.prepare(
      `INSERT INTO daily_stats (
        id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    seedStat.run(
      crypto.randomUUID(),
      'matundy',
      new Date().toISOString().slice(0, 10),
      12450,
      4.8,
      1824,
      138,
      12.5,
      240,
      8320,
      'Seed inicial para validar la nueva capa de persistencia.',
      'seed',
      timestamp,
      timestamp,
    );
  }
}

export function getDatabase() {
  if (!database) {
    database = createDatabase();
    initializeSchema(database);
    seedDefaults(database);
  }

  return database;
}

function rowToUser(row: any): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToClient(row: any): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url ?? null,
    industry: row.industry ?? null,
    healthScore: row.health_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDailyStat(row: any): DailyStatRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    statDate: row.stat_date,
    revenue: row.revenue,
    roas: row.roas,
    clicks: row.clicks,
    conversions: row.conversions,
    cpa: row.cpa,
    leads: row.leads,
    traffic: row.traffic,
    notes: row.notes ?? null,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listUsers() {
  const rows = getDatabase().prepare(`SELECT * FROM users ORDER BY created_at ASC`).all();
  return rows.map(rowToUser);
}

export function createUser(input: { email: string; name: string; password: string; role: UserRole }) {
  const db = getDatabase();
  const timestamp = nowIso();
  const record = {
    id: crypto.randomUUID(),
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    password_hash: hashPassword(input.password),
    role: input.role,
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const stmt = db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
     VALUES (@id, @email, @name, @password_hash, @role, @active, @created_at, @updated_at)`
  );

  stmt.run(record);
  return rowToUser(record);
}

export function updateUserRole(userId: string, updates: Partial<{ role: UserRole; active: boolean; name: string }>) {
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  if (!existing) {
    return null;
  }

  const nextRole = updates.role ?? existing.role;
  const nextActive = typeof updates.active === 'boolean' ? (updates.active ? 1 : 0) : existing.active;
  const nextName = updates.name?.trim() || existing.name;
  const timestamp = nowIso();

  db.prepare(
    `UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?`
  ).run(nextName, nextRole, nextActive, timestamp, userId);

  return rowToUser({
    ...existing,
    name: nextName,
    role: nextRole,
    active: nextActive,
    updated_at: timestamp,
  });
}

export function authenticateUser(email: string, password: string): LoginResult | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizeEmail(email)) as any;
  if (!row || row.active !== 1) {
    return null;
  }

  if (!verifyPassword(password, row.password_hash)) {
    return null;
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), row.id, hashToken(token), nowIso(), expiresAt);

  return { token, user: rowToUser(row) };
}

export function getSessionByToken(token: string) {
  const db = getDatabase();
  const row = db.prepare(
    `
      SELECT s.expires_at, u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `
  ).get(hashToken(token)) as any;

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
    return null;
  }

  if (row.active !== 1) {
    return null;
  }

  return {
    token,
    user: rowToUser(row),
    expiresAt: row.expires_at,
  } as AuthenticatedSession;
}

export function listClients() {
  const rows = getDatabase().prepare(`SELECT * FROM clients ORDER BY name ASC`).all();
  return rows.map(rowToClient);
}

export function getClientBySlug(slug: string) {
  const row = getDatabase().prepare(`SELECT * FROM clients WHERE slug = ?`).get(slug) as any;
  return row ? rowToClient(row) : null;
}

export function createClient(input: { name: string; industry?: string | null; logoUrl?: string | null; healthScore?: number }) {
  const db = getDatabase();
  const timestamp = nowIso();
  const slugBase = input.name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = `${slugBase || 'client'}-${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    slug,
    logo_url: input.logoUrl ?? null,
    industry: input.industry ?? null,
    health_score: Number.isFinite(input.healthScore) ? Math.max(0, Math.min(100, input.healthScore ?? 0)) : 80,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO clients (id, name, slug, logo_url, industry, health_score, created_at, updated_at)
     VALUES (@id, @name, @slug, @logo_url, @industry, @health_score, @created_at, @updated_at)`
  ).run(record);

  return rowToClient(record);
}

export function listDailyStats(clientId?: string) {
  const query = clientId
    ? `SELECT * FROM daily_stats WHERE client_id = ? ORDER BY stat_date DESC, created_at DESC`
    : `SELECT * FROM daily_stats ORDER BY stat_date DESC, created_at DESC`;
  const rows = clientId
    ? getDatabase().prepare(query).all(clientId)
    : getDatabase().prepare(query).all();
  return rows.map(rowToDailyStat);
}

export function getDailyStatById(id: string) {
  const row = getDatabase().prepare(`SELECT * FROM daily_stats WHERE id = ?`).get(id) as any;
  return row ? rowToDailyStat(row) : null;
}

export function upsertDailyStat(input: {
  clientId: string;
  statDate: string;
  revenue?: number;
  roas?: number;
  clicks?: number;
  conversions?: number;
  cpa?: number;
  leads?: number;
  traffic?: number;
  notes?: string | null;
  source?: string;
}) {
  const db = getDatabase();
  const timestamp = nowIso();
  const existing = db.prepare(`SELECT id FROM daily_stats WHERE client_id = ? AND stat_date = ?`).get(input.clientId, input.statDate) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE daily_stats
       SET revenue = ?, roas = ?, clicks = ?, conversions = ?, cpa = ?, leads = ?, traffic = ?, notes = ?, source = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.revenue ?? 0,
      input.roas ?? 0,
      input.clicks ?? 0,
      input.conversions ?? 0,
      input.cpa ?? 0,
      input.leads ?? 0,
      input.traffic ?? 0,
      input.notes ?? null,
      input.source ?? 'manual',
      timestamp,
      existing.id,
    );

    return getDailyStatById(existing.id);
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO daily_stats (
      id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.statDate,
    input.revenue ?? 0,
    input.roas ?? 0,
    input.clicks ?? 0,
    input.conversions ?? 0,
    input.cpa ?? 0,
    input.leads ?? 0,
    input.traffic ?? 0,
    input.notes ?? null,
    input.source ?? 'manual',
    timestamp,
    timestamp,
  );

  return getDailyStatById(id);
}

export function deleteDailyStat(id: string) {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM daily_stats WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getDashboardHealthSummary() {
  const db = getDatabase();
  const totalUsers = db.prepare(`SELECT COUNT(*) as total FROM users`).get() as { total: number };
  const totalClients = db.prepare(`SELECT COUNT(*) as total FROM clients`).get() as { total: number };
  const totalStats = db.prepare(`SELECT COUNT(*) as total FROM daily_stats`).get() as { total: number };
  return {
    users: totalUsers.total,
    clients: totalClients.total,
    dailyStats: totalStats.total,
  };
}

export function listClientsWithLatestStat() {
  const clients = listClients();
  return clients.map((client) => {
    const latestStat = getDatabase().prepare(
      `SELECT * FROM daily_stats WHERE client_id = ? ORDER BY stat_date DESC, created_at DESC LIMIT 1`
    ).get(client.id) as any;

    return {
      ...client,
      latestStat: latestStat ? rowToDailyStat(latestStat) : null,
    };
  });
}
