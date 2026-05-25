import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSessionToken, hashPassword, hashToken, normalizeEmail, nowIso, verifyPassword } from './auth.js';
import { DEFAULT_KPI_THRESHOLDS, normalizeKpiThresholds, parseKpiThresholdsJson, type KpiThresholds } from './kpiThresholds.js';
import {
  buildIntegrationCapabilitySummary,
  buildIntegrationDisplayName,
  getIntegrationProviderDefinition,
  listMissingIntegrationFields,
  normalizeIntegrationSection,
  type IntegrationCapability,
  type IntegrationProvider,
  type IntegrationStatus,
} from './integrationCatalog.js';

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
  kpiThresholds: KpiThresholds;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationRecord {
  id: string;
  clientId: string;
  provider: IntegrationProvider;
  label: string;
  status: IntegrationStatus;
  capabilities: IntegrationCapability[];
  config: Record<string, string>;
  secretKeys: string[];
  lastSync: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationInput {
  id?: string;
  clientId: string;
  provider: IntegrationProvider;
  label?: string | null;
  config?: Record<string, unknown> | null;
  credentials?: Record<string, unknown> | null;
  status?: IntegrationStatus;
  lastError?: string | null;
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

export type MonthlyKpiStatus = 'success' | 'warning' | 'fail' | 'unknown';
export type MonthlyKpiDepartmentKey = 'publicidad' | 'web' | 'rrss';

export interface RrssChannelRecord {
  id: string;
  clientId: string;
  platformKey: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RrssChannelInput {
  id?: string;
  clientId: string;
  platformKey: string;
  label: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ClarityUxSnapshotRecord {
  id: string;
  clientId: string;
  snapshotDate: string;
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  scrollDepthAvg: number;
  engagedSessions: number;
  conversions: number;
  conversionRate: number;
  notes: string | null;
  source: string;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClarityUxSnapshotInput {
  id?: string;
  clientId: string;
  snapshotDate: string;
  sessions?: number;
  pageViews?: number;
  rageClicks?: number;
  deadClicks?: number;
  scrollDepthAvg?: number;
  engagedSessions?: number;
  conversions?: number;
  conversionRate?: number;
  notes?: string | null;
  source?: string;
  payloadJson?: string;
}

export interface MonthlyKpiRecord {
  id: string;
  clientId: string;
  departmentKey: MonthlyKpiDepartmentKey;
  metricKey: string;
  monthKey: string;
  targetValue: number | null;
  targetText: string | null;
  actualValue: number | null;
  actualText: string | null;
  status: MonthlyKpiStatus;
  differenceValue: number | null;
  differencePct: number | null;
  notes: string | null;
  closedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyKpiInput {
  id?: string;
  clientId: string;
  departmentKey: MonthlyKpiDepartmentKey;
  metricKey: string;
  monthKey: string;
  targetValue?: number | null;
  targetText?: string | null;
  actualValue?: number | null;
  actualText?: string | null;
  status?: MonthlyKpiStatus;
  differenceValue?: number | null;
  differencePct?: number | null;
  notes?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
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

const isProduction = process.env.NODE_ENV === 'production';
const defaultDbPath = isProduction ? '/data/infidash.sqlite' : path.join(process.cwd(), 'data', 'infidash.sqlite');
const defaultBackupDir = isProduction ? '/data/backups' : path.join(process.cwd(), 'data', 'backups');
const dbPath = process.env.INFIDASH_DB_PATH ?? defaultDbPath;
const backupDir = process.env.INFIDASH_BACKUP_DIR ?? defaultBackupDir;
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
      kpi_thresholds_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      config_json TEXT NOT NULL DEFAULT '{}',
      credentials_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_sync TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(client_id, provider)
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

    CREATE TABLE IF NOT EXISTS ux_snapshots (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      snapshot_date TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      page_views INTEGER NOT NULL DEFAULT 0,
      rage_clicks INTEGER NOT NULL DEFAULT 0,
      dead_clicks INTEGER NOT NULL DEFAULT 0,
      scroll_depth_avg REAL NOT NULL DEFAULT 0,
      engaged_sessions INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      conversion_rate REAL NOT NULL DEFAULT 0,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'clarity',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(client_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS rrss_channels (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      platform_key TEXT NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(client_id, platform_key, label)
    );

    CREATE TABLE IF NOT EXISTS monthly_kpis (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      department_key TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      month_key TEXT NOT NULL,
      target_value REAL,
      target_text TEXT,
      actual_value REAL,
      actual_text TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      difference_value REAL,
      difference_pct REAL,
      notes TEXT,
      closed_at TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(client_id, department_key, metric_key, month_key)
    );

    CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      insight_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureUxSnapshotSchema(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(ux_snapshots)`).all() as Array<{ name: string }>;
  if (columns.length === 0) {
    return;
  }

  const existingColumns = new Set(columns.map((column) => column.name));
  const addColumn = (definition: string) => db.exec(`ALTER TABLE ux_snapshots ADD COLUMN ${definition}`);

  if (!existingColumns.has('snapshot_date')) {
    addColumn(`snapshot_date TEXT NOT NULL DEFAULT ''`);
  }

  if (!existingColumns.has('sessions')) {
    addColumn(`sessions INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('page_views')) {
    addColumn(`page_views INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('rage_clicks')) {
    addColumn(`rage_clicks INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('dead_clicks')) {
    addColumn(`dead_clicks INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('scroll_depth_avg')) {
    addColumn(`scroll_depth_avg REAL NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('engaged_sessions')) {
    addColumn(`engaged_sessions INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('conversions')) {
    addColumn(`conversions INTEGER NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('conversion_rate')) {
    addColumn(`conversion_rate REAL NOT NULL DEFAULT 0`);
  }

  if (!existingColumns.has('notes')) {
    addColumn(`notes TEXT`);
  }

  if (!existingColumns.has('source')) {
    addColumn(`source TEXT NOT NULL DEFAULT 'clarity'`);
  }

  if (!existingColumns.has('payload_json')) {
    addColumn(`payload_json TEXT NOT NULL DEFAULT '{}'`);
  }

  if (!existingColumns.has('created_at')) {
    addColumn(`created_at TEXT NOT NULL DEFAULT ''`);
  }

  if (!existingColumns.has('updated_at')) {
    addColumn(`updated_at TEXT NOT NULL DEFAULT ''`);
  }
}

function ensureClientThresholdSchema(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(clients)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'kpi_thresholds_json')) {
    db.exec(`ALTER TABLE clients ADD COLUMN kpi_thresholds_json TEXT NOT NULL DEFAULT '{}'`);
  }
}

function ensureIntegrationSchema(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(integrations)`).all() as Array<{ name: string }>;
  const existingColumns = new Set(columns.map((column) => column.name));
  const addColumn = (definition: string) => db.exec(`ALTER TABLE integrations ADD COLUMN ${definition}`);

  if (!existingColumns.has('provider')) {
    addColumn(`provider TEXT`);
  }

  if (!existingColumns.has('label')) {
    addColumn(`label TEXT`);
  }

  if (!existingColumns.has('status')) {
    addColumn(`status TEXT NOT NULL DEFAULT 'pending'`);
  }

  if (!existingColumns.has('config_json')) {
    addColumn(`config_json TEXT NOT NULL DEFAULT '{}'`);
  }

  if (!existingColumns.has('credentials_json')) {
    addColumn(`credentials_json TEXT NOT NULL DEFAULT '{}'`);
  }

  if (!existingColumns.has('last_error')) {
    addColumn(`last_error TEXT`);
  }

  if (!existingColumns.has('created_at')) {
    addColumn(`created_at TEXT NOT NULL DEFAULT ''`);
  }

  if (!existingColumns.has('updated_at')) {
    addColumn(`updated_at TEXT NOT NULL DEFAULT ''`);
  }

  if (!existingColumns.has('is_active')) {
    addColumn(`is_active INTEGER NOT NULL DEFAULT 1`);
  }

  if (!existingColumns.has('last_sync')) {
    addColumn(`last_sync TEXT`);
  }

  const hasTypeColumn = existingColumns.has('type');
  const rows = db.prepare(`SELECT id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, created_at, updated_at${hasTypeColumn ? ', type' : ''} FROM integrations`).all() as Array<Record<string, unknown>>;
  const updateRow = db.prepare(
    `UPDATE integrations
     SET provider = ?, label = ?, status = ?, config_json = ?, credentials_json = ?, is_active = ?, last_sync = ?, last_error = ?, created_at = ?, updated_at = ?
     WHERE id = ?`
  );

  for (const row of rows) {
    const rawProvider = String(row.provider ?? row.type ?? '').trim().toLowerCase();
    const provider = (['clarity', 'meta_ads', 'google_ads', 'wordpress', 'woocommerce'].includes(rawProvider) ? rawProvider : 'clarity') as IntegrationProvider;
    const definition = getIntegrationProviderDefinition(provider);
    if (!definition) {
      continue;
    }

    const config = normalizeIntegrationSection(definition.configFields, (() => {
      try {
        return JSON.parse(String(row.config_json ?? '{}')) as Record<string, unknown>;
      } catch {
        return {};
      }
    })());
    const credentials = normalizeIntegrationSection(definition.credentialFields, (() => {
      try {
        return JSON.parse(String(row.credentials_json ?? '{}')) as Record<string, unknown>;
      } catch {
        return {};
      }
    })());
    const missingFields = listMissingIntegrationFields(definition, config, credentials);
    const status = String(row.status ?? '').trim() || (missingFields.length === 0 ? 'connected' : 'pending');
    const label = String(row.label ?? '').trim() || buildIntegrationDisplayName(definition, config);
    const now = nowIso();

    updateRow.run(
      provider,
      label,
      status,
      JSON.stringify(config),
      JSON.stringify(credentials),
      Number(row.is_active ?? 1),
      String(row.last_sync ?? '') || null,
      String(row.last_error ?? '') || null,
      String(row.created_at ?? '') || now,
      String(row.updated_at ?? '') || now,
      String(row.id),
    );
  }
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

  // No se seedan clientes de demostración: el panel debe arrancar vacío y
  // poblarse solo con datos reales creados por usuarios o sincronizados desde backend.

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

  // No se seedan métricas de ejemplo: la base debe arrancar vacía y
  // poblarse únicamente con datos reales creados por usuarios o por la
  // sincronización de Clarity.
}

export function getDatabase() {
  if (!database) {
    database = createDatabase();
    initializeSchema(database);
    ensureClientThresholdSchema(database);
    ensureIntegrationSchema(database);
    ensureUxSnapshotSchema(database);
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
    kpiThresholds: parseKpiThresholdsJson(row.kpi_thresholds_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonRecord(value: unknown) {
  try {
    return JSON.parse(typeof value === 'string' ? value : JSON.stringify(value ?? {})) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToIntegration(row: any): IntegrationRecord {
  const provider = (getIntegrationProviderDefinition(row.provider as IntegrationProvider)
    ? (row.provider as IntegrationProvider)
    : 'clarity') as IntegrationProvider;
  const definition = getIntegrationProviderDefinition(provider) ?? getIntegrationProviderDefinition('clarity')!;
  const config = normalizeIntegrationSection(definition.configFields, parseJsonRecord(row.config_json ?? '{}'));
  const credentials = normalizeIntegrationSection(definition.credentialFields, parseJsonRecord(row.credentials_json ?? '{}'));
  return {
    id: row.id,
    clientId: row.client_id,
    provider,
    label: row.label ?? buildIntegrationDisplayName(definition, config),
    status: (row.status ?? 'pending') as IntegrationStatus,
    capabilities: [...definition.capabilities],
    config,
    secretKeys: definition.credentialFields.map((field) => field.key).filter((key) => Boolean(credentials[key])),
    lastSync: row.last_sync ?? null,
    lastError: row.last_error ?? null,
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

function rowToUxSnapshot(row: any): ClarityUxSnapshotRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    snapshotDate: row.snapshot_date,
    sessions: row.sessions,
    pageViews: row.page_views,
    rageClicks: row.rage_clicks,
    deadClicks: row.dead_clicks,
    scrollDepthAvg: row.scroll_depth_avg,
    engagedSessions: row.engaged_sessions,
    conversions: row.conversions,
    conversionRate: row.conversion_rate,
    notes: row.notes ?? null,
    source: row.source,
    payloadJson: row.payload_json ?? '{}',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRrssChannel(row: any): RrssChannelRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    platformKey: row.platform_key,
    label: row.label,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMonthlyKpiDepartmentKey(value: unknown): MonthlyKpiDepartmentKey {
  return value === 'web' || value === 'rrss' ? value : 'publicidad';
}

function normalizeMonthlyKpiStatus(value: unknown): MonthlyKpiStatus {
  return value === 'success' || value === 'warning' || value === 'fail' ? value : 'unknown';
}

function rowToMonthlyKpi(row: any): MonthlyKpiRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    departmentKey: normalizeMonthlyKpiDepartmentKey(row.department_key),
    metricKey: row.metric_key,
    monthKey: row.month_key,
    targetValue: row.target_value ?? null,
    targetText: row.target_text ?? null,
    actualValue: row.actual_value ?? null,
    actualText: row.actual_text ?? null,
    status: normalizeMonthlyKpiStatus(row.status),
    differenceValue: row.difference_value ?? null,
    differencePct: row.difference_pct ?? null,
    notes: row.notes ?? null,
    closedAt: row.closed_at ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
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

export function deleteUser(userId: string) {
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  if (!existing) {
    return null;
  }

  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  return rowToUser(existing);
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

export function createClient(input: { name: string; industry?: string | null; logoUrl?: string | null; healthScore?: number; kpiThresholds?: Partial<KpiThresholds> | null }) {
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
    kpi_thresholds_json: JSON.stringify(normalizeKpiThresholds(input.kpiThresholds)),
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO clients (id, name, slug, logo_url, industry, health_score, kpi_thresholds_json, created_at, updated_at)
     VALUES (@id, @name, @slug, @logo_url, @industry, @health_score, @kpi_thresholds_json, @created_at, @updated_at)`
  ).run(record);

  return rowToClient(record);
}

function getClientById(clientId: string) {
  const row = getDatabase().prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId) as any;
  return row ? rowToClient(row) : null;
}

function getIntegrationRowById(id: string) {
  const row = getDatabase().prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) as any;
  return row ?? null;
}

export function getIntegrationCredentialsById(id: string) {
  const row = getIntegrationRowById(id);
  if (!row) {
    return null;
  }

  return parseJsonRecord(row.credentials_json ?? '{}');
}

export function listClientIntegrations(clientId: string) {
  const rows = getDatabase()
    .prepare(`SELECT * FROM integrations WHERE client_id = ? ORDER BY updated_at DESC, created_at DESC`)
    .all(clientId) as any[];
  return rows.map(rowToIntegration);
}

export function saveClientIntegration(input: IntegrationInput) {
  const db = getDatabase();
  const timestamp = nowIso();
  const existingById = input.id
    ? (db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(input.id) as any)
    : null;
  const existingByProvider = !existingById
    ? (db.prepare(`SELECT * FROM integrations WHERE client_id = ? AND provider = ?`).get(input.clientId, input.provider) as any)
    : null;
  const existing = existingById ?? existingByProvider;
  const clientId = existing?.client_id ?? input.clientId;
  const provider = (existing?.provider ?? input.provider) as IntegrationProvider;
  const client = getClientById(clientId);
  if (!client) {
    return null;
  }

  const definition = getIntegrationProviderDefinition(provider);
  if (!definition) {
    throw new Error(`Proveedor de integración no soportado: ${provider}`);
  }

  const previousConfig = existing ? normalizeIntegrationSection(definition.configFields, parseJsonRecord(existing.config_json ?? '{}')) : {};
  const previousCredentials = existing ? normalizeIntegrationSection(definition.credentialFields, parseJsonRecord(existing.credentials_json ?? '{}')) : {};
  const config = normalizeIntegrationSection(definition.configFields, { ...previousConfig, ...(input.config ?? {}) });
  const credentials = normalizeIntegrationSection(definition.credentialFields, { ...previousCredentials, ...(input.credentials ?? {}) });
  const missingFields = listMissingIntegrationFields(definition, config, credentials);
  const status = input.status ?? (missingFields.length === 0 ? 'connected' : 'pending');
  const label = buildIntegrationDisplayName(definition, config, input.label ?? existing?.label ?? null);
  const lastSync = missingFields.length === 0 ? (existing?.last_sync ?? timestamp) : existing?.last_sync ?? null;
  const lastError = input.lastError ?? (missingFields.length > 0 ? `Faltan campos obligatorios: ${missingFields.join(', ')}` : null);

  if (existing) {
    db.prepare(
      `UPDATE integrations
       SET client_id = ?, provider = ?, label = ?, status = ?, config_json = ?, credentials_json = ?, is_active = ?, last_sync = ?, last_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      clientId,
      provider,
      label,
      status,
      JSON.stringify(config),
      JSON.stringify(credentials),
      Number(existing.is_active ?? 1),
      lastSync,
      lastError,
      timestamp,
      existing.id,
    );

    const refreshed = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(existing.id) as any;
    return rowToIntegration(refreshed);
  }

  const record = {
    id: crypto.randomUUID(),
    client_id: clientId,
    provider,
    label,
    status,
    config_json: JSON.stringify(config),
    credentials_json: JSON.stringify(credentials),
    is_active: 1,
    last_sync: lastSync,
    last_error: lastError,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO integrations (
      id, client_id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.client_id,
    record.provider,
    record.label,
    record.status,
    record.config_json,
    record.credentials_json,
    record.is_active,
    record.last_sync,
    record.last_error,
    record.created_at,
    record.updated_at,
  );

  const created = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(record.id) as any;
  return rowToIntegration(created);
}

export function deleteClientIntegration(id: string) {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM integrations WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function testClientIntegration(id: string) {
  const db = getDatabase();
  const row = getIntegrationRowById(id);
  if (!row) {
    return null;
  }

  const integration = rowToIntegration(row);
  const definition = getIntegrationProviderDefinition(integration.provider)!;
  const missingFields = listMissingIntegrationFields(definition, integration.config, Object.fromEntries(integration.secretKeys.map((key) => [key, 'present'])));
  const timestamp = nowIso();
  const status: IntegrationStatus = missingFields.length === 0 ? 'connected' : 'pending';
  const lastError = missingFields.length > 0 ? `Faltan campos obligatorios: ${missingFields.join(', ')}` : null;

  db.prepare(`UPDATE integrations SET status = ?, last_sync = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(
    status,
    timestamp,
    lastError,
    timestamp,
    id,
  );

  const refreshed = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) as any;
  return {
    integration: rowToIntegration(refreshed),
    ready: missingFields.length === 0,
    missingFields,
    summary: buildIntegrationCapabilitySummary(definition),
  };
}

export function getIntegrationById(id: string) {
  const row = getIntegrationRowById(id);
  return row ? rowToIntegration(row) : null;
}

export function getClientByIdRecord(clientId: string) {
  return getClientById(clientId);
}

export function getClientIntegrationsSummary(clientId: string) {
  return listClientIntegrations(clientId).map((integration) => ({
    ...integration,
    summary: buildIntegrationCapabilitySummary(getIntegrationProviderDefinition(integration.provider)!),
  }));
}

export function setClientIntegrationStatus(id: string, status: IntegrationStatus, lastError: string | null = null) {
  const db = getDatabase();
  const timestamp = nowIso();
  db.prepare(`UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(status, lastError, timestamp, id);
  const row = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) as any;
  return row ? rowToIntegration(row) : null;
}

export function getClientByIdOrSlug(value: string) {
  return getClientById(value) ?? getClientBySlug(value);
}

export function getIntegrationProviderLabel(provider: IntegrationProvider) {
  return getIntegrationProviderDefinition(provider)?.label ?? provider;
}

export function getIntegrationCapabilitySummary(provider: IntegrationProvider) {
  const definition = getIntegrationProviderDefinition(provider);
  return definition ? buildIntegrationCapabilitySummary(definition) : '';
}

export function getClientIntegrations(clientId: string) {
  return listClientIntegrations(clientId);
}

export function upsertClientIntegration(input: IntegrationInput) {
  return saveClientIntegration(input);
}

export function removeClientIntegration(id: string) {
  return deleteClientIntegration(id);
}

export function inspectClientIntegration(id: string) {
  return testClientIntegration(id);
}

export function getClientByIdStrict(clientId: string) {
  return getClientById(clientId);
}

export function getClientByIdLoose(value: string) {
  return getClientById(value) ?? getClientBySlug(value);
}

export function listIntegrationsForClient(clientId: string) {
  return listClientIntegrations(clientId);
}

export function createOrUpdateClientIntegration(input: IntegrationInput) {
  return saveClientIntegration(input);
}

export function testIntegrationById(id: string) {
  return testClientIntegration(id);
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

export function listUxSnapshots(clientId?: string) {
  const query = clientId
    ? `SELECT * FROM ux_snapshots WHERE client_id = ? ORDER BY snapshot_date DESC, created_at DESC`
    : `SELECT * FROM ux_snapshots ORDER BY snapshot_date DESC, created_at DESC`;
  const rows = clientId
    ? getDatabase().prepare(query).all(clientId)
    : getDatabase().prepare(query).all();
  return rows.map(rowToUxSnapshot);
}

export function getLatestUxSnapshot(clientId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM ux_snapshots WHERE client_id = ? ORDER BY snapshot_date DESC, updated_at DESC LIMIT 1`)
    .get(clientId) as any;
  return row ? rowToUxSnapshot(row) : null;
}

export function listIntegrationsByProvider(provider: IntegrationProvider) {
  const rows = getDatabase()
    .prepare(`SELECT * FROM integrations WHERE provider = ? AND is_active = 1 ORDER BY updated_at DESC, created_at DESC`)
    .all(provider) as any[];
  return rows.map(rowToIntegration);
}

export function updateIntegrationSyncState(
  id: string,
  updates: { status?: IntegrationStatus; lastError?: string | null; lastSync?: string | null },
) {
  const db = getDatabase();
  const current = getIntegrationRowById(id);
  if (!current) {
    return null;
  }

  const timestamp = nowIso();
  const status = updates.status ?? current.status ?? 'pending';
  const lastSync = updates.lastSync ?? current.last_sync ?? null;
  const lastError = updates.lastError ?? current.last_error ?? null;

  db.prepare(`UPDATE integrations SET status = ?, last_sync = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(
    status,
    lastSync,
    lastError,
    timestamp,
    id,
  );

  const refreshed = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) as any;
  return refreshed ? rowToIntegration(refreshed) : null;
}

export function upsertUxSnapshot(input: ClarityUxSnapshotInput) {
  const db = getDatabase();
  const client = getClientById(input.clientId);
  if (!client) {
    return null;
  }

  const timestamp = nowIso();
  const existing = db.prepare(`SELECT * FROM ux_snapshots WHERE client_id = ? AND snapshot_date = ?`).get(input.clientId, input.snapshotDate) as any;
  const record = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    client_id: input.clientId,
    snapshot_date: input.snapshotDate.trim(),
    sessions: Number.isFinite(input.sessions) ? Number(input.sessions ?? 0) : 0,
    page_views: Number.isFinite(input.pageViews) ? Number(input.pageViews ?? 0) : 0,
    rage_clicks: Number.isFinite(input.rageClicks) ? Number(input.rageClicks ?? 0) : 0,
    dead_clicks: Number.isFinite(input.deadClicks) ? Number(input.deadClicks ?? 0) : 0,
    scroll_depth_avg: Number.isFinite(input.scrollDepthAvg) ? Number(input.scrollDepthAvg ?? 0) : 0,
    engaged_sessions: Number.isFinite(input.engagedSessions) ? Number(input.engagedSessions ?? 0) : 0,
    conversions: Number.isFinite(input.conversions) ? Number(input.conversions ?? 0) : 0,
    conversion_rate: Number.isFinite(input.conversionRate) ? Number(input.conversionRate ?? 0) : 0,
    notes: input.notes ?? null,
    source: input.source?.trim() || 'clarity',
    payload_json: input.payloadJson ?? '{}',
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };

  if (existing) {
    db.prepare(
      `UPDATE ux_snapshots
       SET sessions = ?, page_views = ?, rage_clicks = ?, dead_clicks = ?, scroll_depth_avg = ?, engaged_sessions = ?, conversions = ?, conversion_rate = ?, notes = ?, source = ?, payload_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      record.sessions,
      record.page_views,
      record.rage_clicks,
      record.dead_clicks,
      record.scroll_depth_avg,
      record.engaged_sessions,
      record.conversions,
      record.conversion_rate,
      record.notes,
      record.source,
      record.payload_json,
      record.updated_at,
      record.id,
    );
  } else {
    db.prepare(
      `INSERT INTO ux_snapshots (
        id, client_id, snapshot_date, sessions, page_views, rage_clicks, dead_clicks, scroll_depth_avg, engaged_sessions, conversions, conversion_rate, notes, source, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.client_id,
      record.snapshot_date,
      record.sessions,
      record.page_views,
      record.rage_clicks,
      record.dead_clicks,
      record.scroll_depth_avg,
      record.engaged_sessions,
      record.conversions,
      record.conversion_rate,
      record.notes,
      record.source,
      record.payload_json,
      record.created_at,
      record.updated_at,
    );
  }

  const saved = db.prepare(`SELECT * FROM ux_snapshots WHERE id = ?`).get(record.id) as any;
  return saved ? rowToUxSnapshot(saved) : null;
}

export function listRrssChannels(clientId: string) {
  const rows = getDatabase()
    .prepare(`SELECT * FROM rrss_channels WHERE client_id = ? ORDER BY sort_order ASC, created_at ASC`)
    .all(clientId) as any[];
  return rows.map(rowToRrssChannel);
}

export function saveRrssChannel(input: RrssChannelInput) {
  const db = getDatabase();
  const client = getClientById(input.clientId);
  if (!client) {
    return null;
  }

  const timestamp = nowIso();
  const existing = input.id
    ? (db.prepare(`SELECT * FROM rrss_channels WHERE id = ?`).get(input.id) as any)
    : (db.prepare(`SELECT * FROM rrss_channels WHERE client_id = ? AND platform_key = ? AND label = ?`).get(input.clientId, input.platformKey, input.label.trim()) as any);

  if (existing) {
    db.prepare(
      `UPDATE rrss_channels
       SET platform_key = ?, label = ?, is_active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.platformKey.trim(),
      input.label.trim(),
      input.isActive === false ? 0 : 1,
      Number.isFinite(input.sortOrder) ? input.sortOrder ?? 0 : 0,
      timestamp,
      existing.id,
    );

    const refreshed = db.prepare(`SELECT * FROM rrss_channels WHERE id = ?`).get(existing.id) as any;
    return rowToRrssChannel(refreshed);
  }

  const record = {
    id: input.id ?? crypto.randomUUID(),
    client_id: input.clientId,
    platform_key: input.platformKey.trim(),
    label: input.label.trim(),
    is_active: input.isActive === false ? 0 : 1,
    sort_order: Number.isFinite(input.sortOrder) ? input.sortOrder ?? 0 : 0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO rrss_channels (id, client_id, platform_key, label, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.client_id,
    record.platform_key,
    record.label,
    record.is_active,
    record.sort_order,
    record.created_at,
    record.updated_at,
  );

  const created = db.prepare(`SELECT * FROM rrss_channels WHERE id = ?`).get(record.id) as any;
  return rowToRrssChannel(created);
}

export function listMonthlyKpis(clientId: string, monthKey?: string) {
  const rows = monthKey
    ? getDatabase().prepare(`SELECT * FROM monthly_kpis WHERE client_id = ? AND month_key = ? ORDER BY department_key ASC, metric_key ASC`).all(clientId, monthKey)
    : getDatabase().prepare(`SELECT * FROM monthly_kpis WHERE client_id = ? ORDER BY month_key DESC, department_key ASC, metric_key ASC`).all(clientId);
  return (rows as any[]).map(rowToMonthlyKpi);
}

export function saveMonthlyKpi(input: MonthlyKpiInput) {
  const db = getDatabase();
  const client = getClientById(input.clientId);
  if (!client) {
    return null;
  }

  const timestamp = nowIso();
  const existing = input.id
    ? (db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(input.id) as any)
    : (db.prepare(`SELECT * FROM monthly_kpis WHERE client_id = ? AND department_key = ? AND metric_key = ? AND month_key = ?`).get(
        input.clientId,
        input.departmentKey,
        input.metricKey,
        input.monthKey,
      ) as any);

  const record = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    client_id: input.clientId,
    department_key: input.departmentKey,
    metric_key: input.metricKey.trim(),
    month_key: input.monthKey.trim(),
    target_value: typeof input.targetValue === 'number' ? input.targetValue : null,
    target_text: input.targetText ?? null,
    actual_value: typeof input.actualValue === 'number' ? input.actualValue : null,
    actual_text: input.actualText ?? null,
    status: input.status ?? existing?.status ?? 'unknown',
    difference_value: typeof input.differenceValue === 'number' ? input.differenceValue : null,
    difference_pct: typeof input.differencePct === 'number' ? input.differencePct : null,
    notes: input.notes ?? null,
    closed_at: existing?.closed_at ?? null,
    created_by_user_id: input.createdByUserId ?? existing?.created_by_user_id ?? null,
    updated_by_user_id: input.updatedByUserId ?? existing?.updated_by_user_id ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };

  if (existing) {
    db.prepare(
      `UPDATE monthly_kpis
       SET department_key = ?, metric_key = ?, month_key = ?, target_value = ?, target_text = ?, actual_value = ?, actual_text = ?, status = ?, difference_value = ?, difference_pct = ?, notes = ?, closed_at = ?, created_by_user_id = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      record.department_key,
      record.metric_key,
      record.month_key,
      record.target_value,
      record.target_text,
      record.actual_value,
      record.actual_text,
      record.status,
      record.difference_value,
      record.difference_pct,
      record.notes,
      record.closed_at,
      record.created_by_user_id,
      record.updated_by_user_id,
      record.updated_at,
      record.id,
    );
  } else {
    db.prepare(
      `INSERT INTO monthly_kpis (
        id, client_id, department_key, metric_key, month_key, target_value, target_text, actual_value, actual_text, status,
        difference_value, difference_pct, notes, closed_at, created_by_user_id, updated_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.client_id,
      record.department_key,
      record.metric_key,
      record.month_key,
      record.target_value,
      record.target_text,
      record.actual_value,
      record.actual_text,
      record.status,
      record.difference_value,
      record.difference_pct,
      record.notes,
      record.closed_at,
      record.created_by_user_id,
      record.updated_by_user_id,
      record.created_at,
      record.updated_at,
    );
  }

  const saved = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(record.id) as any;
  return rowToMonthlyKpi(saved);
}

export function closeMonthlyKpi(id: string, closedAt = nowIso()) {
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  if (!existing) {
    return null;
  }

  db.prepare(`UPDATE monthly_kpis SET closed_at = ?, updated_at = ? WHERE id = ?`).run(closedAt, nowIso(), id);
  const saved = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  return rowToMonthlyKpi(saved);
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
  const clientsWithStats = clients.map((client) => {
    const latestStat = getDatabase().prepare(
      `SELECT * FROM daily_stats WHERE client_id = ? ORDER BY stat_date DESC, created_at DESC LIMIT 1`
    ).get(client.id) as any;

    return {
      ...client,
      latestStat: latestStat ? rowToDailyStat(latestStat) : null,
    };
  });

  return clientsWithStats.sort((a, b) => {
    const aHasStat = a.latestStat ? 0 : 1;
    const bHasStat = b.latestStat ? 0 : 1;
    if (aHasStat !== bHasStat) {
      return aHasStat - bHasStat;
    }

    const aDate = a.latestStat?.statDate ?? a.updatedAt ?? a.createdAt;
    const bDate = b.latestStat?.statDate ?? b.updatedAt ?? b.createdAt;
    return bDate.localeCompare(aDate);
  });
}
