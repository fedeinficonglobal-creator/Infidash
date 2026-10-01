import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { UserFacingError } from './userFacingError.js';
import { assertCanonicalStatDate, isCanonicalStatDate } from './statDate.js';
import { runCoreMigrations } from '../server/content/migrations.js';
import { coreAll, coreGet, coreRun, getCorePool, withCoreTransaction, type CoreQueryable } from './corePool.js';
import { createBackupFile, type BackupResult } from './databaseBackup.js';
import { getBootstrapUsers, getDefaultAccountsWarning } from './bootstrapUsers.js';
import { hasLiveIntegrationAdapter, resolveIntegrationSaveState, statusForIntegrationView } from './integrationState.js';
import { createSessionToken, hashPassword, hashToken, normalizeEmail, nowIso, verifyPassword } from './auth.js';
import { DEFAULT_KPI_THRESHOLDS, normalizeKpiThresholds, parseKpiThresholdsJson, type KpiThresholds } from './kpiThresholds.js';
import { sumRevenueWindow } from './dashboardMetrics.js';
import { dueMonthlyKpiMonth, nextMonthKey } from './monthlyCloseClock.js';
import { parseWooRefundPolicy } from './woocommerce.js';
import type { WooCommerceOrderSummary } from './woocommerce.js';
import type { Ga4LandingPage, Ga4SessionsPoint, Ga4TopPage, Ga4TrafficSource } from './ga4.js';
import type { GoogleAdsCampaign } from './googleAds.js';
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
  clientIds: string[] | null;
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
  isActive: boolean;
  capabilities: IntegrationCapability[];
  config: Record<string, string>;
  secretKeys: string[];
  webhookSecret: string | null;
  lastSync: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadRecord {
  id: string;
  clientId: string;
  integrationId: string | null;
  source: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: 'new' | 'in_progress' | 'closed' | 'lost';
  rawPayload: Record<string, unknown>;
  receivedAt: string;
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

export type OperationalPlanDomain = 'web' | 'rrss';

export interface OperationalPlanRecord {
  clientId: string;
  domain: OperationalPlanDomain;
  periodKey: string;
  version: number;
  rows: Array<Record<string, string>>;
  updatedAt: string | null;
}

export interface ReportRunRecord {
  id: string;
  clientId: string;
  from: string;
  to: string;
  generatedAt: string;
  createdByUserId: string | null;
  bytes: number;
  lastSentAt: string | null;
  lastSentTo: string | null;
  lastSendError: string | null;
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


loadDotenv({ path: path.join(process.cwd(), '.env') });
loadDotenv({ path: path.join(process.cwd(), '.env.local'), override: true });

const isProduction = process.env.NODE_ENV === 'production';
const defaultBackupDir = isProduction ? '/data/backups' : path.join(process.cwd(), 'data', 'backups');
const backupDir = process.env.INFIDASH_BACKUP_DIR ?? defaultBackupDir;

const defaultLegacySqlitePath = path.join(process.cwd(), 'data', 'infidash.sqlite');
const testLegacySqlitePath = process.env.INFIDASH_TEST_SUITE === 'api'
  ? process.env.INFIDASH_TEST_LEGACY_SQLITE_PATH
  : undefined;
if (process.env.INFIDASH_TEST_SUITE === 'api' && !testLegacySqlitePath) {
  throw new Error('API tests require an isolated legacy SQLite fixture path.');
}
const legacySqlitePath = testLegacySqlitePath ?? defaultLegacySqlitePath;
const legacySqliteTables = [
  'organizations',
  'users',
  'clients',
  'integrations',
  'daily_stats',
  'ux_snapshots',
  'rrss_channels',
  'monthly_kpis',
] as const;

type LegacySqliteDump = Partial<Record<(typeof legacySqliteTables)[number], Array<Record<string, unknown>>>>;

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Async child process runner (never blocks the event loop). */
function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function readLegacySqliteDump(): Promise<LegacySqliteDump | null> {
  if (!fs.existsSync(legacySqlitePath)) {
    return null;
  }

  const script = `
import json
import sqlite3
import sys

path = sys.argv[1]
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

tables = ${JSON.stringify(legacySqliteTables)}
out = {}
for table in tables:
    try:
        rows = cur.execute(f'SELECT * FROM {table}').fetchall()
        out[table] = [dict(row) for row in rows]
    except sqlite3.Error:
        out[table] = []

print(json.dumps(out))
`;

  const result = await runCommand('python', ['-c', script, legacySqlitePath]);
  if (result.code !== 0) {
    const message = (result.stderr || result.stdout || 'unknown sqlite export error').trim();
    throw new Error(message);
  }

  const raw = result.stdout.trim();
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as LegacySqliteDump;
}

/** `$1, $2, …, $count` for building parameterized column lists. */
function placeholders(count: number) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(', ');
}

async function importLegacySqliteData(db: CoreQueryable) {
  if (process.env.NODE_ENV === 'production' || process.env.INFIDASH_SKIP_LEGACY_SQLITE_IMPORT === '1') {
    return;
  }

  const dump = await readLegacySqliteDump();
  if (!dump) {
    return;
  }

  const importCounts = {
    organizations: 0,
    users: 0,
    clients: 0,
    integrations: 0,
    dailyStats: 0,
    uxSnapshots: 0,
    rrssChannels: 0,
    monthlyKpis: 0,
  };

  const orgIdMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const clientIdMap = new Map<string, string>();

  const getOrgIdBySlug = async (slug: string) => {
    const row = await coreGet<{ id: string }>(db, `SELECT id FROM organizations WHERE slug = $1`, [slug]);
    return row?.id ?? null;
  };

  const getUserIdByEmail = async (email: string) => {
    const row = await coreGet<{ id: string }>(db, `SELECT id FROM users WHERE email = $1`, [email]);
    return row?.id ?? null;
  };

  const getClientIdBySlug = async (slug: string) => {
    const row = await coreGet<{ id: string }>(db, `SELECT id FROM clients WHERE slug = $1`, [slug]);
    return row?.id ?? null;
  };

  const insertOrganization = `INSERT INTO organizations (id, name, slug, created_at) VALUES (${placeholders(4)}) ON CONFLICT(slug) DO NOTHING`;
  for (const row of dump.organizations ?? []) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    await coreRun(db, insertOrganization, [
      legacyId || crypto.randomUUID(),
      String(row.name ?? slug),
      slug,
      String(row.created_at ?? nowIso()),
    ]);
    const destId = (await getOrgIdBySlug(slug)) ?? legacyId;
    if (legacyId && destId) {
      orgIdMap.set(legacyId, destId);
    }
    importCounts.organizations += 1;
  }

  const insertUser = `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
     VALUES (${placeholders(8)})
     ON CONFLICT(email) DO NOTHING`;
  for (const row of dump.users ?? []) {
    const email = normalizeEmail(String(row.email ?? ''));
    if (!email) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    await coreRun(db, insertUser, [
      legacyId || crypto.randomUUID(),
      email,
      String(row.name ?? 'Usuario').trim() || 'Usuario',
      String(row.password_hash ?? row.passwordHash ?? ''),
      String(row.role ?? 'viewer'),
      Number(row.active ?? 1) ? 1 : 0,
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    const destId = (await getUserIdByEmail(email)) ?? legacyId;
    if (legacyId && destId) {
      userIdMap.set(legacyId, destId);
    }
    importCounts.users += 1;
  }

  const insertClient = `INSERT INTO clients (id, org_id, name, slug, logo_url, industry, health_score, kpi_thresholds_json, created_at, updated_at)
     VALUES (${placeholders(10)})
     ON CONFLICT(slug) DO NOTHING`;
  for (const row of dump.clients ?? []) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    const legacyOrgId = String(row.org_id ?? '').trim();
    const orgId = legacyOrgId ? orgIdMap.get(legacyOrgId) ?? (await getOrgIdBySlug(legacyOrgId)) ?? legacyOrgId : null;
    await coreRun(db, insertClient, [
      legacyId || crypto.randomUUID(),
      orgId,
      String(row.name ?? slug).trim() || slug,
      slug,
      row.logo_url ?? null,
      row.industry ?? null,
      Number.isFinite(Number(row.health_score)) ? Number(row.health_score) : 0,
      String(row.kpi_thresholds_json ?? '{}'),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    const destId = (await getClientIdBySlug(slug)) ?? legacyId;
    if (legacyId && destId) {
      clientIdMap.set(legacyId, destId);
    }
    importCounts.clients += 1;
  }

  const insertIntegration = `INSERT INTO integrations (
      id, client_id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, created_at, updated_at
    ) VALUES (${placeholders(12)})
    ON CONFLICT(client_id, provider) DO NOTHING`;
  for (const row of dump.integrations ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    await coreRun(db, insertIntegration, [
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.provider ?? 'clarity'),
      String(row.label ?? 'Integración').trim() || 'Integración',
      String(row.status ?? 'pending'),
      String(row.config_json ?? '{}'),
      String(row.credentials_json ?? '{}'),
      Number(row.is_active ?? 1) ? 1 : 0,
      row.last_sync ?? null,
      row.last_error ?? null,
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    importCounts.integrations += 1;
  }

  const insertDailyStat = `INSERT INTO daily_stats (
      id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
    ) VALUES (${placeholders(14)})
    ON CONFLICT(client_id, stat_date) DO NOTHING`;
  for (const row of dump.daily_stats ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    // stat_date is a DATE now: keep the calendar day of legacy timestamps and skip rows without a usable day.
    const statDate = String(row.stat_date ?? '').trim().slice(0, 10);
    if (!clientId || !isCanonicalStatDate(statDate)) {
      continue;
    }

    await coreRun(db, insertDailyStat, [
      String(row.id ?? crypto.randomUUID()),
      clientId,
      statDate,
      Number(row.revenue ?? 0),
      Number(row.roas ?? 0),
      Number(row.clicks ?? 0),
      Number(row.conversions ?? 0),
      Number(row.cpa ?? 0),
      Number(row.leads ?? 0),
      Number(row.traffic ?? 0),
      row.notes ?? null,
      String(row.source ?? 'manual'),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    importCounts.dailyStats += 1;
  }

  const insertUxSnapshot = `INSERT INTO ux_snapshots (
      id, client_id, snapshot_date, sessions, page_views, rage_clicks, dead_clicks, scroll_depth_avg, engaged_sessions,
      conversions, conversion_rate, notes, source, payload_json, created_at, updated_at
    ) VALUES (${placeholders(16)})
    ON CONFLICT(client_id, snapshot_date) DO NOTHING`;
  for (const row of dump.ux_snapshots ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    await coreRun(db, insertUxSnapshot, [
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.snapshot_date ?? '').trim(),
      Number(row.sessions ?? 0),
      Number(row.page_views ?? 0),
      Number(row.rage_clicks ?? 0),
      Number(row.dead_clicks ?? 0),
      Number(row.scroll_depth_avg ?? 0),
      Number(row.engaged_sessions ?? 0),
      Number(row.conversions ?? 0),
      Number(row.conversion_rate ?? 0),
      row.notes ?? null,
      String(row.source ?? 'clarity'),
      String(row.payload_json ?? '{}'),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    importCounts.uxSnapshots += 1;
  }

  const insertRrssChannel = `INSERT INTO rrss_channels (
      id, client_id, platform_key, label, is_active, sort_order, created_at, updated_at
    ) VALUES (${placeholders(8)})
    ON CONFLICT(client_id, platform_key, label) DO NOTHING`;
  for (const row of dump.rrss_channels ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    await coreRun(db, insertRrssChannel, [
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.platform_key ?? '').trim(),
      String(row.label ?? '').trim(),
      Number(row.is_active ?? 1) ? 1 : 0,
      Number(row.sort_order ?? 0),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    importCounts.rrssChannels += 1;
  }

  const insertMonthlyKpi = `INSERT INTO monthly_kpis (
      id, client_id, department_key, metric_key, month_key, target_value, target_text, actual_value, actual_text,
      status, difference_value, difference_pct, notes, closed_at, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (${placeholders(18)})
    ON CONFLICT(client_id, department_key, metric_key, month_key) DO NOTHING`;
  for (const row of dump.monthly_kpis ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    const createdByLegacyId = String(row.created_by_user_id ?? '').trim();
    const updatedByLegacyId = String(row.updated_by_user_id ?? '').trim();
    const createdByUserId = createdByLegacyId ? userIdMap.get(createdByLegacyId) ?? createdByLegacyId : null;
    const updatedByUserId = updatedByLegacyId ? userIdMap.get(updatedByLegacyId) ?? updatedByLegacyId : null;

    await coreRun(db, insertMonthlyKpi, [
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.department_key ?? 'publicidad'),
      String(row.metric_key ?? ''),
      String(row.month_key ?? ''),
      row.target_value ?? null,
      row.target_text ?? null,
      row.actual_value ?? null,
      row.actual_text ?? null,
      String(row.status ?? 'unknown'),
      row.difference_value ?? null,
      row.difference_pct ?? null,
      row.notes ?? null,
      row.closed_at ?? null,
      createdByUserId,
      updatedByUserId,
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    ]);
    importCounts.monthlyKpis += 1;
  }

  const importedAnything = Object.values(importCounts).some((count) => count > 0);
  if (importedAnything) {
    console.warn('[infidash] Migración legacy SQLite→Postgres completada', importCounts);
  }
}

/**
 * Creates a pg_dump backup in the backup directory without blocking the event loop. Only the file name, label,
 * creation time and size are returned: the internal filesystem path is never exposed to API clients.
 */
export async function createDatabaseBackup(label?: string | null): Promise<BackupResult> {
  const connectionString = (process.env.DATABASE_URL ?? process.env.INFIDASH_DATABASE_URL ?? '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create a backup');
  }

  return createBackupFile({ connectionString, backupDir, label });
}

async function tableColumns(db: CoreQueryable, tableName: string): Promise<string[]> {
  const rows = await coreAll<{ column_name: string }>(
    db,
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );
  return rows.map((row) => row.column_name);
}

async function ensureClientMembershipsBackfill(db: CoreQueryable) {
  const marker = await coreGet(db, `SELECT 1 FROM schema_backfills WHERE key = $1`, ['client_memberships_v1']);
  if (marker) return;

  const viewers = await coreAll<{ id: string }>(db, `SELECT id FROM users WHERE role = 'viewer'`);
  const clients = await coreAll<{ id: string }>(db, `SELECT id FROM clients`);
  const insert = `INSERT INTO client_memberships (id, user_id, client_id, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, client_id) DO NOTHING`;
  for (const viewer of viewers) {
    for (const client of clients) {
      await coreRun(db, insert, [crypto.randomUUID(), viewer.id, client.id, nowIso()]);
    }
  }

  await coreRun(db, `INSERT INTO schema_backfills (key, completed_at) VALUES ($1, $2)`, ['client_memberships_v1', nowIso()]);
}

// The core schema (tables, columns, indexes) lives in db/migrations/0004_core_baseline.sql and is applied by
// initializeCoreDatabase() through the migration runner before this runs. What stays here is data work only.
// Normalizes legacy integration rows (provider/label/status/config) once the migrated columns exist.
async function normalizeIntegrationRows(db: CoreQueryable) {
  const existingColumns = new Set(await tableColumns(db, 'integrations'));

  const hasTypeColumn = existingColumns.has('type');
  const rows = await coreAll<Record<string, unknown>>(db, `SELECT id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, created_at, updated_at${hasTypeColumn ? ', type' : ''} FROM integrations`);
  const updateRow = `UPDATE integrations
     SET provider = $1, label = $2, status = $3, config_json = $4, credentials_json = $5, is_active = $6, last_sync = $7, last_error = $8, created_at = $9, updated_at = $10
     WHERE id = $11`;

  for (const row of rows) {
    const rawProvider = String(row.provider ?? row.type ?? '').trim().toLowerCase();
    const provider = (['clarity', 'meta_ads', 'google_ads', 'wordpress', 'woocommerce', 'ga4'].includes(rawProvider) ? rawProvider : 'clarity') as IntegrationProvider;
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

    await coreRun(db, updateRow, [
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
    ]);
  }
}

async function seedDefaults(db: CoreQueryable) {
  const timestamp = nowIso();

  const organization = await coreGet<{ id: string }>(db, `SELECT id FROM organizations WHERE slug = $1`, ['infidash']);
  const orgId = organization?.id ?? crypto.randomUUID();
  if (!organization) {
    await coreRun(
      db,
      `INSERT INTO organizations (id, name, slug, created_at) VALUES ($1, $2, $3, $4)`,
      [orgId, 'Infidash', 'infidash', timestamp],
    );
  }

  // No se seedan clientes de demostración: el panel debe arrancar vacío y
  // poblarse solo con datos reales creados por usuarios o sincronizados desde backend.

  const existingAdmin = await coreGet(db, `SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  const users = getBootstrapUsers(process.env, Boolean(existingAdmin));
  const defaultAccountsWarning = getDefaultAccountsWarning(process.env, users);
  if (defaultAccountsWarning) console.warn(defaultAccountsWarning);

  for (const user of users) {
    if (!(await coreGet(db, `SELECT id FROM users WHERE email = $1`, [user.email]))) {
      await coreRun(
        db,
        `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [
          crypto.randomUUID(),
          user.email,
          user.name,
          hashPassword(user.password),
          user.role,
          timestamp,
          timestamp,
        ],
      );
    }
  }

  // No se seedan métricas de ejemplo: la base debe arrancar vacía y
  // poblarse únicamente con datos reales creados por usuarios o por la
  // sincronización de Clarity.
}

// Arbitrary constant, distinct from the migration runner lock: serializes concurrent boots of the core data work
// (integration normalization, memberships backfill, seed users, legacy import).
const CORE_SCHEMA_LOCK_ID = 4_790_321_772;

async function runCoreInitialization() {
  // Schema first, and BEFORE taking the core lock: the migration runner serializes itself with its own advisory
  // lock (4790321771) on a dedicated connection and releases it when done, so the two locks are never held at the
  // same time and cannot deadlock. A concurrent boot waits in the runner, then finds everything applied.
  await runCoreMigrations(getCorePool());
  const client = await getCorePool().connect();
  let releaseError: Error | undefined;
  try {
    // Session-level advisory lock on one dedicated connection: a second instance booting at the same time waits
    // here and then finds the schema, backfill marker and seed users already in place.
    await client.query('SELECT pg_advisory_lock($1)', [CORE_SCHEMA_LOCK_ID]);
    // Schema already exists here: runCoreMigrations() ran before this lock was taken. Data work only, in the same
    // relative order as the former synchronous bootstrap.
    await normalizeIntegrationRows(client);
    await ensureClientMembershipsBackfill(client);
    await seedDefaults(client);
    await importLegacySqliteData(client);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [CORE_SCHEMA_LOCK_ID]);
    } catch (error) {
      // A connection that cannot unlock is broken: destroy it instead of returning it to the pool.
      releaseError = error instanceof Error ? error : new Error(String(error));
    }
    client.release(releaseError);
  }
}

let coreInitialization: Promise<void> | null = null;

/**
 * Applies the pending core migrations (db/migrations/*_core_*.sql), runs the one-time backfill and seeds the bootstrap users. Idempotent and memoized:
 * every caller shares one promise, so it runs once per process. server.ts awaits it before listening, and every
 * pooled query issued through getCoreDb() awaits it too, so tests and scripts that only import this module still
 * get the schema. A failed attempt is not cached, so the next call retries.
 */
export function initializeCoreDatabase(): Promise<void> {
  if (!coreInitialization) {
    coreInitialization = runCoreInitialization().catch((error) => {
      coreInitialization = null;
      throw error;
    });
  }

  return coreInitialization;
}

/**
 * Pool-backed queryable for every exported data function. It awaits initializeCoreDatabase() before each query
 * (a resolved memoized promise after the first call), which keeps the guarantee the former synchronous bootstrap gave
 * without changing any call site. initializeCoreDatabase itself talks to the raw pool, so there is no recursion.
 */
const readyCoreDb: CoreQueryable = {
  async query(text, values) {
    await initializeCoreDatabase();
    return getCorePool().query(text, values);
  },
};

function getCoreDb(): CoreQueryable {
  return readyCoreDb;
}

/** Runs `fn` in one transaction on a dedicated pooled connection, after the core schema is ready. */
async function runCoreTransaction<T>(fn: (tx: CoreQueryable) => Promise<T>): Promise<T> {
  await initializeCoreDatabase();
  return withCoreTransaction(fn);
}

async function getClientIdsForUser(db: CoreQueryable, userId: string, role: UserRole): Promise<string[] | null> {
  if (role === 'admin') return null;
  const rows = await coreAll<{ client_id: string }>(db, `SELECT client_id FROM client_memberships WHERE user_id = $1`, [userId]);
  return rows.map((row) => row.client_id);
}

function rowToUserBase(row: any): Omit<PublicUser, 'clientIds'> {
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

async function rowToUser(db: CoreQueryable, row: any): Promise<PublicUser> {
  const base = rowToUserBase(row);
  return { ...base, clientIds: await getClientIdsForUser(db, base.id, base.role) };
}

async function rowsToUsers(db: CoreQueryable, rows: any[]): Promise<PublicUser[]> {
  const membershipRows = await coreAll<{ user_id: string; client_id: string }>(db, `SELECT user_id, client_id FROM client_memberships`);
  const byUser = new Map<string, string[]>();
  for (const row of membershipRows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row.client_id);
    byUser.set(row.user_id, list);
  }
  return rows.map((row) => {
    const base = rowToUserBase(row);
    return { ...base, clientIds: base.role === 'admin' ? null : (byUser.get(base.id) ?? []) };
  });
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
    status: statusForIntegrationView(provider, (row.status ?? 'pending') as IntegrationStatus),
    isActive: Number(row.is_active ?? 1) === 1,
    capabilities: [...definition.capabilities],
    config,
    secretKeys: definition.credentialFields.map((field) => field.key).filter((key) => Boolean(credentials[key])),
    webhookSecret: row.webhook_secret ?? null,
    lastSync: hasLiveIntegrationAdapter(provider) ? (row.last_sync ?? null) : null,
    lastError: row.last_error ?? (row.status === 'connected' && !hasLiveIntegrationAdapter(provider)
      ? 'Este proveedor todavía no tiene un adaptador real de conexión/sincronización.'
      : null),
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

function rowToLead(row: any): LeadRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    integrationId: row.integration_id ?? null,
    source: row.source ?? 'wordpress',
    name: row.name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    message: row.message ?? null,
    status: (['new', 'in_progress', 'closed', 'lost'].includes(row.status) ? row.status : 'new') as LeadRecord['status'],
    rawPayload: parseJsonRecord(row.raw_payload_json ?? '{}'),
    receivedAt: row.received_at,
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

export async function listUsers() {
  const db = getCoreDb();
  const rows = await coreAll(db, `SELECT * FROM users ORDER BY created_at ASC`);
  return rowsToUsers(db, rows);
}

async function setClientMemberships(db: CoreQueryable, userId: string, clientIds: string[]) {
  await coreRun(db, `DELETE FROM client_memberships WHERE user_id = $1`, [userId]);
  const timestamp = nowIso();
  for (const clientId of clientIds) {
    await coreRun(
      db,
      `INSERT INTO client_memberships (id, user_id, client_id, created_at) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), userId, clientId, timestamp],
    );
  }
}

export async function createUser(input: { email: string; name: string; password: string; role: UserRole; clientIds?: string[] }) {
  const db = getCoreDb();
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

  // One transaction: an unknown client id must not leave an orphan user (which would also block reusing the email).
  await runCoreTransaction(async (tx) => {
    await coreRun(
      tx,
      `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.id, record.email, record.name, record.password_hash, record.role, record.active, record.created_at, record.updated_at],
    );
    if (input.role === 'viewer') {
      await setClientMemberships(tx, record.id, input.clientIds ?? []);
    }
  });
  return rowToUser(db, record);
}

export async function updateUserRole(userId: string, updates: Partial<{ role: UserRole; active: boolean; name: string; clientIds: string[] }>) {
  const db = getCoreDb();
  const existing = await coreGet(db, `SELECT * FROM users WHERE id = $1`, [userId]);
  if (!existing) {
    return null;
  }

  const nextRole = updates.role ?? existing.role;
  const nextActive = typeof updates.active === 'boolean' ? (updates.active ? 1 : 0) : existing.active;
  const nextName = updates.name?.trim() || existing.name;
  const timestamp = nowIso();

  // The user update and the membership replacement commit together: a failing membership insert (unknown client id)
  // must neither drop the previous memberships nor apply the role/name change.
  await runCoreTransaction(async (tx) => {
    await coreRun(
      tx,
      `UPDATE users SET name = $1, role = $2, active = $3, updated_at = $4 WHERE id = $5`,
      [nextName, nextRole, nextActive, timestamp, userId],
    );

    if (nextRole === 'admin') {
      // Membership rows only ever exist for viewers — clear them so a later
      // demotion back to viewer never silently resurrects stale access.
      await coreRun(tx, `DELETE FROM client_memberships WHERE user_id = $1`, [userId]);
    } else if (updates.clientIds) {
      await setClientMemberships(tx, userId, updates.clientIds);
    }
  });

  return rowToUser(db, {
    ...existing,
    name: nextName,
    role: nextRole,
    active: nextActive,
    updated_at: timestamp,
  });
}

export async function deleteUser(userId: string) {
  const db = getCoreDb();
  const existing = await coreGet(db, `SELECT * FROM users WHERE id = $1`, [userId]);
  if (!existing) {
    return null;
  }

  // Memberships cascade with the user, so they are read first to report the memberships the removed user had.
  const removed = await rowToUser(db, existing);
  await coreRun(db, `DELETE FROM users WHERE id = $1`, [userId]);
  return removed;
}

export async function authenticateUser(email: string, password: string): Promise<LoginResult | null> {
  const db = getCoreDb();
  const row = await coreGet(db, `SELECT * FROM users WHERE email = $1`, [normalizeEmail(email)]);
  if (!row || row.active !== 1) {
    return null;
  }

  if (!verifyPassword(password, row.password_hash)) {
    return null;
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();

  await coreRun(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [crypto.randomUUID(), row.id, hashToken(token), nowIso(), expiresAt],
  );

  return { token, user: await rowToUser(db, row) };
}

/** Revokes one session (logout). Idempotent: an unknown or already expired token is a no-op. */
export async function revokeSessionByToken(token: string) {
  await coreRun(getCoreDb(), `DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/** Revokes every session of a user (logout everywhere). */
export async function revokeAllSessionsForUser(userId: string) {
  await coreRun(getCoreDb(), `DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/**
 * Deletes every session that has expired at `now` and returns how many rows were removed. Expired sessions are
 * otherwise only deleted when their own token is presented, so abandoned ones would accumulate forever.
 * `expires_at` is a native TIMESTAMPTZ (idx_sessions_expires_at supports this scan); `<=` matches getSessionByToken,
 * which treats an expiry equal to now as expired.
 */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const result = await coreRun(getCoreDb(), `DELETE FROM sessions WHERE expires_at <= $1::timestamptz`, [now.toISOString()]);
  return result.changes;
}

export async function getSessionByToken(token: string) {
  const db = getCoreDb();
  const row = await coreGet(
    db,
    `
      SELECT s.expires_at, u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
    `,
    [hashToken(token)],
  );

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await coreRun(db, `DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    return null;
  }

  if (row.active !== 1) {
    return null;
  }

  return {
    token,
    user: await rowToUser(db, row),
    expiresAt: row.expires_at,
  } as AuthenticatedSession;
}

/** Optional allow-list bound as one text[] parameter. Callers only append the predicate when a scope is set. */
function scopeParam(scope: string[] | null | undefined) {
  return scope ? [scope] : [];
}

export async function listClients(options?: { clientIds?: string[] | null }, db: CoreQueryable = getCoreDb()) {
  const scope = options?.clientIds;
  const where = scope ? `WHERE id = ANY($1::text[])` : '';
  const rows = await coreAll(db, `SELECT * FROM clients ${where} ORDER BY name ASC`, scopeParam(scope));
  return rows.map(rowToClient);
}

export async function getClientBySlug(slug: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM clients WHERE slug = $1`, [slug]);
  return row ? rowToClient(row) : null;
}

function buildClientSlug(name: string) {
  const slugBase = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slugBase || 'client'}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createClient(input: { name: string; industry?: string | null; logoUrl?: string | null; healthScore?: number; kpiThresholds?: Partial<KpiThresholds> | null }) {
  const db = getCoreDb();
  const timestamp = nowIso();
  const slug = buildClientSlug(input.name);
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

  // health_score is an INTEGER column: the ::numeric cast keeps PostgreSQL's assignment rounding (55.5 -> 56) that the
  // inlined numeric literal used to get, instead of failing on the text parameter "55.5".
  // RETURNING hands back the persisted row, so the caller sees the rounded INTEGER (56) that listClients will read.
  const created = await coreGet(
    db,
    `INSERT INTO clients (id, name, slug, logo_url, industry, health_score, kpi_thresholds_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9)
     RETURNING *`,
    [record.id, record.name, record.slug, record.logo_url, record.industry, record.health_score, record.kpi_thresholds_json, record.created_at, record.updated_at],
  );

  return rowToClient(created);
}

export async function updateClient(clientId: string, input: { name?: string; industry?: string | null; logoUrl?: string | null; healthScore?: number; kpiThresholds?: Partial<KpiThresholds> | null }) {
  const db = getCoreDb();
  const existing = await getClientById(clientId, db);
  if (!existing) {
    return null;
  }

  const nextName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name;
  const nextIndustry = input.industry === undefined ? existing.industry : input.industry;
  const nextLogoUrl = input.logoUrl === undefined ? existing.logoUrl : input.logoUrl;
  const nextHealthScore = Number.isFinite(input.healthScore) ? Math.max(0, Math.min(100, input.healthScore ?? 0)) : existing.healthScore;
  const nextThresholds = input.kpiThresholds ? normalizeKpiThresholds({ ...existing.kpiThresholds, ...input.kpiThresholds }) : existing.kpiThresholds;
  const timestamp = nowIso();
  const slug = nextName === existing.name ? existing.slug : buildClientSlug(nextName);

  await coreRun(
    db,
    `UPDATE clients
     SET name = $1, slug = $2, logo_url = $3, industry = $4, health_score = $5::numeric, kpi_thresholds_json = $6, updated_at = $7
     WHERE id = $8`,
    [
      nextName,
      slug,
      nextLogoUrl ?? null,
      nextIndustry ?? null,
      nextHealthScore,
      JSON.stringify(nextThresholds),
      timestamp,
      clientId,
    ],
  );

  return getClientById(clientId, db);
}

export async function deleteClient(clientId: string) {
  const result = await coreRun(getCoreDb(), `DELETE FROM clients WHERE id = $1`, [clientId]);
  return result.changes > 0;
}

async function getClientById(clientId: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM clients WHERE id = $1`, [clientId]);
  return row ? rowToClient(row) : null;
}

async function getIntegrationRowById(id: string, db: CoreQueryable) {
  const row = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [id]);
  return row ?? null;
}

export async function getIntegrationCredentialsById(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await getIntegrationRowById(id, db);
  if (!row) {
    return null;
  }

  return parseJsonRecord(row.credentials_json ?? '{}');
}

export async function listClientIntegrations(clientId: string, db: CoreQueryable = getCoreDb()) {
  const rows = await coreAll(db, `SELECT * FROM integrations WHERE client_id = $1 ORDER BY updated_at DESC, created_at DESC`, [clientId]);
  return rows.map(rowToIntegration);
}

/** Drops null/undefined/blank-string entries so they never overwrite a stored value in a spread merge. */
function withoutBlankValues(values: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, value]) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')),
  );
}

export async function saveClientIntegration(input: IntegrationInput, db: CoreQueryable = getCoreDb()) {
  const timestamp = nowIso();
  const existingById = input.id
    ? await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [input.id])
    : null;
  const existingByProvider = !existingById
    ? await coreGet(db, `SELECT * FROM integrations WHERE client_id = $1 AND provider = $2`, [input.clientId, input.provider])
    : null;
  const existing = existingById ?? existingByProvider;
  const clientId = existing?.client_id ?? input.clientId;
  const provider = (existing?.provider ?? input.provider) as IntegrationProvider;
  const client = await getClientById(clientId, db);
  if (!client) {
    return null;
  }

  const definition = getIntegrationProviderDefinition(provider);
  if (!definition) {
    throw new UserFacingError(`Proveedor de integración no soportado: ${provider}`);
  }

  const previousConfig = existing ? normalizeIntegrationSection(definition.configFields, parseJsonRecord(existing.config_json ?? '{}')) : {};
  const previousCredentials = existing ? normalizeIntegrationSection(definition.credentialFields, parseJsonRecord(existing.credentials_json ?? '{}')) : {};
  const config = normalizeIntegrationSection(definition.configFields, { ...previousConfig, ...(input.config ?? {}) });
  if (provider === 'woocommerce') parseWooRefundPolicy(config.refundPolicy);
  if (provider === 'ga4' && config.propertyId && !/^\d+$/.test(config.propertyId)) {
    throw new UserFacingError('El Property ID de GA4 debe ser numérico');
  }
  if (provider === 'google_ads' && config.customerId && !/^\d+$/.test(config.customerId)) {
    throw new UserFacingError('El Customer ID de Google Ads debe ser numérico, sin guiones');
  }
  // A blank or undefined credential means "keep the stored secret": the integrations form submits every credential
  // field and leaves untouched ones empty ("Los secretos existentes se conservan si dejas este campo vacío").
  const credentials = normalizeIntegrationSection(definition.credentialFields, { ...previousCredentials, ...withoutBlankValues(input.credentials) });
  const missingFields = listMissingIntegrationFields(definition, config, credentials);
  const configurationUnchanged = Boolean(existing)
    && JSON.stringify(previousConfig) === JSON.stringify(config)
    && JSON.stringify(previousCredentials) === JSON.stringify(credentials);
  const state = resolveIntegrationSaveState({
    provider,
    existingStatus: (existing?.status ?? null) as IntegrationStatus | null,
    existingLastError: existing?.last_error ?? null,
    configurationUnchanged,
    missingFields,
  });
  const status = existing && Number(existing.is_active ?? 1) === 0 ? 'disabled' : state.status;
  const label = buildIntegrationDisplayName(definition, config, input.label ?? existing?.label ?? null);
  const lastSync = existing?.last_sync ?? null;
  const lastError = state.lastError;
  const needsWebhookSecret = definition.capabilities.includes('leads');
  const webhookSecret = needsWebhookSecret ? (existing?.webhook_secret ?? crypto.randomBytes(24).toString('hex')) : (existing?.webhook_secret ?? null);

  if (existing) {
    await coreRun(
      db,
      `UPDATE integrations
       SET client_id = $1, provider = $2, label = $3, status = $4, config_json = $5, credentials_json = $6, is_active = $7, last_sync = $8, last_error = $9, webhook_secret = $10, updated_at = $11
       WHERE id = $12`,
      [
        clientId,
        provider,
        label,
        status,
        JSON.stringify(config),
        JSON.stringify(credentials),
        Number(existing.is_active ?? 1),
        lastSync,
        lastError,
        webhookSecret,
        timestamp,
        existing.id,
      ],
    );

    const refreshed = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [existing.id]);
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
    webhook_secret: webhookSecret,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await coreRun(
    db,
    `INSERT INTO integrations (
      id, client_id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, webhook_secret, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
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
      record.webhook_secret,
      record.created_at,
      record.updated_at,
    ],
  );

  const created = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [record.id]);
  return rowToIntegration(created);
}

export async function getIntegrationByWebhookSecret(secret: string, db: CoreQueryable = getCoreDb()) {
  if (!secret) {
    return null;
  }

  const row = await coreGet(db, `SELECT * FROM integrations WHERE webhook_secret = $1 AND is_active = 1 AND status <> 'disabled'`, [secret]);
  return row ? rowToIntegration(row) : null;
}

export interface WooCommerceSalesSnapshot {
  integrationId: string;
  sourceKey: string;
  from: string;
  to: string;
  orders: WooCommerceOrderSummary[];
  syncedAt: string;
}

/** Replaces one fully-read purchase window atomically; credentials and customer data are never stored. */
export async function saveWooCommerceSalesSnapshot(input: Omit<WooCommerceSalesSnapshot, 'syncedAt'>, db: CoreQueryable = getCoreDb()) {
  const syncedAt = nowIso();
  await coreRun(db, `INSERT INTO woocommerce_sales_snapshots
      (integration_id, source_key, purchase_from, purchase_to, orders_json, synced_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT (integration_id, source_key, purchase_from, purchase_to)
    DO UPDATE SET orders_json = EXCLUDED.orders_json, synced_at = EXCLUDED.synced_at`,
    [input.integrationId, input.sourceKey, input.from, input.to, JSON.stringify(input.orders), syncedAt]);
  return { ...input, syncedAt };
}

export async function getWooCommerceSalesSnapshot(input: Pick<WooCommerceSalesSnapshot, 'integrationId' | 'sourceKey' | 'from' | 'to'>, db: CoreQueryable = getCoreDb()): Promise<WooCommerceSalesSnapshot | null> {
  const row = await coreGet(db, `SELECT integration_id, source_key, purchase_from, purchase_to, orders_json, synced_at
    FROM woocommerce_sales_snapshots WHERE integration_id = $1 AND source_key = $2 AND purchase_from = $3 AND purchase_to = $4`,
    [input.integrationId, input.sourceKey, input.from, input.to]);
  if (!row) return null;
  const orders = typeof row.orders_json === 'string' ? JSON.parse(row.orders_json) : row.orders_json;
  if (!Array.isArray(orders)) throw new UserFacingError('El resumen WooCommerce guardado no es válido');
  return { integrationId: row.integration_id, sourceKey: row.source_key, from: row.purchase_from,
    to: row.purchase_to, orders, syncedAt: row.synced_at };
}

export interface Ga4TrafficSnapshot {
  integrationId: string;
  propertyId: string;
  from: string;
  to: string;
  sessionsSeries: Ga4SessionsPoint[];
  trafficSources: Ga4TrafficSource[];
  topPages: Ga4TopPage[];
  landingPages: Ga4LandingPage[];
  syncedAt: string;
}

/** Replaces one fully-read GA4 report window atomically. Credentials are never stored per-client. */
export async function saveGa4Snapshot(input: Omit<Ga4TrafficSnapshot, 'syncedAt'>, db: CoreQueryable = getCoreDb()) {
  const syncedAt = nowIso();
  await coreRun(db, `INSERT INTO ga4_snapshots
      (integration_id, property_id, period_from, period_to, sessions_json, traffic_sources_json, top_pages_json, landing_pages_json, synced_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
    ON CONFLICT (integration_id, property_id, period_from, period_to)
    DO UPDATE SET sessions_json = EXCLUDED.sessions_json, traffic_sources_json = EXCLUDED.traffic_sources_json,
      top_pages_json = EXCLUDED.top_pages_json, landing_pages_json = EXCLUDED.landing_pages_json, synced_at = EXCLUDED.synced_at`,
    [input.integrationId, input.propertyId, input.from, input.to,
      JSON.stringify(input.sessionsSeries), JSON.stringify(input.trafficSources), JSON.stringify(input.topPages), JSON.stringify(input.landingPages), syncedAt]);
  return { ...input, syncedAt };
}

export async function getGa4Snapshot(input: Pick<Ga4TrafficSnapshot, 'integrationId' | 'propertyId' | 'from' | 'to'>, db: CoreQueryable = getCoreDb()): Promise<Ga4TrafficSnapshot | null> {
  const row = await coreGet(db, `SELECT integration_id, property_id, period_from, period_to, sessions_json, traffic_sources_json, top_pages_json, landing_pages_json, synced_at
    FROM ga4_snapshots WHERE integration_id = $1 AND property_id = $2 AND period_from = $3 AND period_to = $4`,
    [input.integrationId, input.propertyId, input.from, input.to]);
  if (!row) return null;
  const parseJson = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
  const sessionsSeries = parseJson(row.sessions_json);
  const trafficSources = parseJson(row.traffic_sources_json);
  const topPages = parseJson(row.top_pages_json);
  const landingPages = parseJson(row.landing_pages_json);
  if (![sessionsSeries, trafficSources, topPages, landingPages].every(Array.isArray)) {
    throw new UserFacingError('El resumen GA4 guardado no es válido');
  }
  return {
    integrationId: row.integration_id, propertyId: row.property_id, from: row.period_from, to: row.period_to,
    sessionsSeries, trafficSources, topPages, landingPages, syncedAt: row.synced_at,
  };
}

export interface GoogleAdsSnapshot {
  integrationId: string;
  customerId: string;
  from: string;
  to: string;
  campaigns: GoogleAdsCampaign[];
  currencyCode: string;
  syncedAt: string;
}

/** Replaces one fully-read Google Ads campaign report window atomically. Credentials are never stored per-client. */
export async function saveGoogleAdsSnapshot(input: Omit<GoogleAdsSnapshot, 'syncedAt'>, db: CoreQueryable = getCoreDb()) {
  const syncedAt = nowIso();
  await coreRun(db, `INSERT INTO google_ads_snapshots
      (integration_id, customer_id, period_from, period_to, campaigns_json, currency_code, synced_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    ON CONFLICT (integration_id, customer_id, period_from, period_to)
    DO UPDATE SET campaigns_json = EXCLUDED.campaigns_json, currency_code = EXCLUDED.currency_code, synced_at = EXCLUDED.synced_at`,
    [input.integrationId, input.customerId, input.from, input.to, JSON.stringify(input.campaigns), input.currencyCode, syncedAt]);
  return { ...input, syncedAt };
}

export async function getGoogleAdsSnapshot(input: Pick<GoogleAdsSnapshot, 'integrationId' | 'customerId' | 'from' | 'to'>, db: CoreQueryable = getCoreDb()): Promise<GoogleAdsSnapshot | null> {
  const row = await coreGet(db, `SELECT integration_id, customer_id, period_from, period_to, campaigns_json, currency_code, synced_at
    FROM google_ads_snapshots WHERE integration_id = $1 AND customer_id = $2 AND period_from = $3 AND period_to = $4`,
    [input.integrationId, input.customerId, input.from, input.to]);
  if (!row) return null;
  const campaigns = typeof row.campaigns_json === 'string' ? JSON.parse(row.campaigns_json) : row.campaigns_json;
  if (!Array.isArray(campaigns)) throw new UserFacingError('El resumen de Google Ads guardado no es válido');
  return {
    integrationId: row.integration_id, customerId: row.customer_id, from: row.period_from, to: row.period_to,
    campaigns, currencyCode: row.currency_code, syncedAt: row.synced_at,
  };
}

export async function setClientIntegrationActive(id: string, active: boolean, db: CoreQueryable = getCoreDb()) {
  const existing = await getIntegrationRowById(id, db);
  if (!existing) return null;
  await coreRun(db, `UPDATE integrations SET is_active = $1, status = $2, last_error = NULL, updated_at = $3 WHERE id = $4`,
    [active ? 1 : 0, active ? 'pending' : 'disabled', nowIso(), id]);
  return rowToIntegration(await getIntegrationRowById(id, db));
}

export async function rotateClientIntegrationWebhook(id: string, db: CoreQueryable = getCoreDb()) {
  const existing = await getIntegrationRowById(id, db);
  if (!existing || existing.provider !== 'wordpress') return null;
  await coreRun(db, `UPDATE integrations SET webhook_secret = $1, updated_at = $2 WHERE id = $3`,
    [crypto.randomBytes(24).toString('hex'), nowIso(), id]);
  return rowToIntegration(await getIntegrationRowById(id, db));
}

export async function insertLead(input: {
  clientId: string;
  integrationId: string | null;
  source: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  rawPayload: Record<string, unknown>;
  dedupeKey?: string | null;
}, db: CoreQueryable = getCoreDb()) {
  const timestamp = nowIso();
  const record = {
    id: crypto.randomUUID(),
    client_id: input.clientId,
    integration_id: input.integrationId,
    source: input.source.trim() || 'wordpress',
    name: input.name?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    message: input.message?.trim() || null,
    // A blank key is "no key": '' would be stored (the unique index only skips NULL) and break the next delivery.
    dedupe_key: input.dedupeKey && input.dedupeKey.trim() ? input.dedupeKey : null,
    raw_payload_json: JSON.stringify(input.rawPayload ?? {}),
    received_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };

  // ON CONFLICT DO NOTHING is atomic against the unique (integration_id, dedupe_key) index: of two concurrent
  // deliveries exactly one row is stored and the other falls through to the duplicate lookup below.
  await coreRun(
    db,
    `INSERT INTO leads (
      id, client_id, integration_id, source, name, email, phone, message, status, dedupe_key, raw_payload_json, received_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', $9, $10, $11::timestamptz, $12, $13) ON CONFLICT DO NOTHING`,
    [
      record.id,
      record.client_id,
      record.integration_id,
      record.source,
      record.name,
      record.email,
      record.phone,
      record.message,
      record.dedupe_key,
      record.raw_payload_json,
      record.received_at,
      record.created_at,
      record.updated_at,
    ],
  );
  const created = await coreGet(db, `SELECT * FROM leads WHERE id = $1`, [record.id]);
  if (created) return { lead: rowToLead(created), duplicate: false };
  if (!record.dedupe_key || !record.integration_id) throw new Error('No se pudo guardar el lead');
  const existing = await coreGet(db, `SELECT * FROM leads WHERE integration_id = $1 AND dedupe_key = $2`,
    [record.integration_id, record.dedupe_key]);
  if (!existing) throw new Error('No se pudo recuperar el lead duplicado');
  return { lead: rowToLead(existing), duplicate: true };
}

export async function listLeadsByClient(clientId: string, query: { limit: number; offset: number; status: string | null; source: string | null }, db: CoreQueryable = getCoreDb()) {
  const conditions = ['client_id = $1'];
  const parameters: Array<string | number> = [clientId];
  if (query.status) {
    parameters.push(query.status);
    conditions.push(`status = $${parameters.length}`);
  }
  if (query.source) {
    parameters.push(query.source);
    conditions.push(`source = $${parameters.length}`);
  }
  const where = conditions.join(' AND ');
  const count = await coreGet(db, `SELECT COUNT(*)::int AS total,
    SUM(CASE WHEN status IN ('new', 'in_progress') THEN 1 ELSE 0 END)::int AS open_count,
    SUM(CASE WHEN status IN ('closed', 'lost') THEN 1 ELSE 0 END)::int AS resolved_count
    FROM leads WHERE ${where}`, parameters);
  const rows = await coreAll(db, `SELECT * FROM leads WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
    [...parameters, query.limit, query.offset]);
  const leads = rows.map((row) => {
    const { rawPayload: _rawPayload, ...safeLead } = rowToLead(row);
    return safeLead;
  });
  return {
    leads,
    total: Number(count?.total ?? 0),
    openCount: Number(count?.open_count ?? 0),
    resolvedCount: Number(count?.resolved_count ?? 0),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function deleteClientIntegration(id: string, db: CoreQueryable = getCoreDb()) {
  const result = await coreRun(db, `DELETE FROM integrations WHERE id = $1`, [id]);
  return result.changes > 0;
}

export async function testClientIntegration(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await getIntegrationRowById(id, db);
  if (!row) {
    return null;
  }

  const integration = rowToIntegration(row);
  const definition = getIntegrationProviderDefinition(integration.provider)!;
  const missingFields = listMissingIntegrationFields(definition, integration.config, Object.fromEntries(integration.secretKeys.map((key) => [key, 'present'])));
  if (!integration.isActive) {
    // A disabled integration is never probed: keep its status ('disabled'), error and timestamps untouched and report
    // it as not ready, so a stray test cannot flip it to 'pending' while it stays inactive.
    return {
      integration,
      ready: false,
      missingFields,
      summary: buildIntegrationCapabilitySummary(definition),
    };
  }

  const timestamp = nowIso();
  const status: IntegrationStatus = 'pending';
  const lastError = missingFields.length > 0
    ? `Faltan campos obligatorios: ${missingFields.join(', ')}`
    : hasLiveIntegrationAdapter(integration.provider)
      ? 'Configuración completa; falta una prueba o sincronización real.'
      : 'La configuración está completa, pero este proveedor todavía no dispone de una prueba/sincronización real.';

  await coreRun(db, `UPDATE integrations SET status = $1, last_error = $2, updated_at = $3 WHERE id = $4`, [
    status,
    lastError,
    timestamp,
    id,
  ]);

  const refreshed = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [id]);
  return {
    integration: rowToIntegration(refreshed),
    ready: missingFields.length === 0,
    missingFields,
    summary: buildIntegrationCapabilitySummary(definition),
  };
}

export async function getIntegrationById(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await getIntegrationRowById(id, db);
  return row ? rowToIntegration(row) : null;
}

export async function getClientByIdRecord(clientId: string) {
  return getClientById(clientId);
}

export async function getClientIntegrationsSummary(clientId: string, db: CoreQueryable = getCoreDb()) {
  return (await listClientIntegrations(clientId, db)).map((integration) => ({
    ...integration,
    summary: buildIntegrationCapabilitySummary(getIntegrationProviderDefinition(integration.provider)!),
  }));
}

export async function setClientIntegrationStatus(id: string, status: IntegrationStatus, lastError: string | null = null, lastSync?: string, db: CoreQueryable = getCoreDb()) {
  const timestamp = nowIso();
  if (lastSync) {
    await coreRun(db, `UPDATE integrations SET status = $1, last_error = $2, last_sync = $3, updated_at = $4 WHERE id = $5 AND is_active = 1`, [status, lastError, lastSync, timestamp, id]);
  } else {
    await coreRun(db, `UPDATE integrations SET status = $1, last_error = $2, updated_at = $3 WHERE id = $4 AND is_active = 1`, [status, lastError, timestamp, id]);
  }
  const row = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [id]);
  return row ? rowToIntegration(row) : null;
}

export async function getClientByIdOrSlug(value: string) {
  return (await getClientById(value)) ?? getClientBySlug(value);
}

export function getIntegrationProviderLabel(provider: IntegrationProvider) {
  return getIntegrationProviderDefinition(provider)?.label ?? provider;
}

export function getIntegrationCapabilitySummary(provider: IntegrationProvider) {
  const definition = getIntegrationProviderDefinition(provider);
  return definition ? buildIntegrationCapabilitySummary(definition) : '';
}

export function getClientIntegrations(clientId: string, db: CoreQueryable = getCoreDb()) {
  return listClientIntegrations(clientId, db);
}

export function upsertClientIntegration(input: IntegrationInput, db: CoreQueryable = getCoreDb()) {
  return saveClientIntegration(input, db);
}

export function removeClientIntegration(id: string, db: CoreQueryable = getCoreDb()) {
  return deleteClientIntegration(id, db);
}

export function inspectClientIntegration(id: string, db: CoreQueryable = getCoreDb()) {
  return testClientIntegration(id, db);
}

export async function getClientByIdStrict(clientId: string) {
  return getClientById(clientId);
}

export async function getClientByIdLoose(value: string) {
  return (await getClientById(value)) ?? getClientBySlug(value);
}

export function listIntegrationsForClient(clientId: string, db: CoreQueryable = getCoreDb()) {
  return listClientIntegrations(clientId, db);
}

export function createOrUpdateClientIntegration(input: IntegrationInput, db: CoreQueryable = getCoreDb()) {
  return saveClientIntegration(input, db);
}

export function testIntegrationById(id: string, db: CoreQueryable = getCoreDb()) {
  return testClientIntegration(id, db);
}

export async function listDailyStats(clientId?: string, options?: { clientIds?: string[] | null }, db: CoreQueryable = getCoreDb()) {
  const scope = options?.clientIds;
  if (clientId !== undefined) {
    // An explicit clientId never widens into "all clients": an empty id matches nothing, and an id outside the
    // supplied scope (when one is supplied) is hidden. A null/undefined scope is unrestricted (admin).
    if (!clientId || (scope && !scope.includes(clientId))) {
      return [];
    }
    const rows = await coreAll(db, `SELECT * FROM daily_stats WHERE client_id = $1 ORDER BY stat_date DESC, created_at DESC`, [clientId]);
    return rows.map(rowToDailyStat);
  }
  const where = scope ? `WHERE client_id = ANY($1::text[])` : '';
  const rows = await coreAll(db, `SELECT * FROM daily_stats ${where} ORDER BY stat_date DESC, created_at DESC`, scopeParam(scope));
  return rows.map(rowToDailyStat);
}

export async function listUxSnapshots(clientId?: string, db: CoreQueryable = getCoreDb()) {
  const rows = clientId
    ? await coreAll(db, `SELECT * FROM ux_snapshots WHERE client_id = $1 ORDER BY snapshot_date DESC, created_at DESC`, [clientId])
    : await coreAll(db, `SELECT * FROM ux_snapshots ORDER BY snapshot_date DESC, created_at DESC`);
  return rows.map(rowToUxSnapshot);
}

export async function getLatestUxSnapshot(clientId: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM ux_snapshots WHERE client_id = $1 ORDER BY snapshot_date DESC, updated_at DESC LIMIT 1`, [clientId]);
  return row ? rowToUxSnapshot(row) : null;
}

function rowToOperationalPlan(row: any): OperationalPlanRecord {
  return {
    clientId: row.client_id,
    domain: row.domain,
    periodKey: row.period_key,
    version: Number(row.version),
    rows: JSON.parse(row.rows_json),
    updatedAt: row.updated_at,
  };
}

export async function getOperationalPlan(clientId: string, domain: OperationalPlanDomain, periodKey: string, db: CoreQueryable = getCoreDb()): Promise<OperationalPlanRecord> {
  const row = await coreGet(db, `SELECT * FROM operational_plans WHERE client_id = $1 AND domain = $2 AND period_key = $3`, [clientId, domain, periodKey]);
  return row ? rowToOperationalPlan(row) : { clientId, domain, periodKey, version: 0, rows: [], updatedAt: null };
}

export async function saveOperationalPlan(input: Omit<OperationalPlanRecord, 'updatedAt'>, db: CoreQueryable = getCoreDb()): Promise<OperationalPlanRecord | null> {
  if (input.version > 0 && (await getOperationalPlan(input.clientId, input.domain, input.periodKey, db)).version === 0) return null;
  const timestamp = nowIso();
  // The conflict branch only fires for the caller holding the current version, so concurrent writers with the same
  // version never both win: the loser re-evaluates the WHERE against the committed row and changes nothing.
  // ::numeric keeps the comparison with the INTEGER column valid for any number the former inlined literal accepted.
  const result = await coreRun(db, `INSERT INTO operational_plans
    (id, client_id, domain, period_key, version, rows_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 1, $5, $6, $7)
    ON CONFLICT (client_id, domain, period_key) DO UPDATE SET
      version = operational_plans.version + 1,
      rows_json = excluded.rows_json,
      updated_at = excluded.updated_at
    WHERE operational_plans.version = $8::numeric`, [
    crypto.randomUUID(), input.clientId, input.domain, input.periodKey,
    JSON.stringify(input.rows), timestamp, timestamp, finiteOrNull(input.version),
  ]);
  return result.changes ? getOperationalPlan(input.clientId, input.domain, input.periodKey, db) : null;
}

function rowToReportRun(row: any): ReportRunRecord {
  return { id: row.id, clientId: row.client_id, from: row.from_date, to: row.to_date,
    generatedAt: row.generated_at, createdByUserId: row.created_by_user_id, bytes: Number(row.bytes),
    lastSentAt: row.last_sent_at, lastSentTo: row.last_sent_to, lastSendError: row.last_send_error };
}

export async function saveReportRun(input: { clientId: string; from: string; to: string; createdByUserId: string; pdf: Buffer }, db: CoreQueryable = getCoreDb()): Promise<ReportRunRecord> {
  const id = crypto.randomUUID();
  const generatedAt = nowIso();
  // pdf_base64 is a TEXT column: the PDF travels as base64 text exactly as before, never as bytea.
  await coreRun(db, `INSERT INTO report_runs (id,client_id,from_date,to_date,generated_at,created_by_user_id,pdf_base64,bytes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, input.clientId, input.from, input.to, generatedAt, input.createdByUserId, input.pdf.toString('base64'), input.pdf.length]);
  return (await getReportRun(input.clientId, id, db))!;
}

export async function listReportRuns(clientId: string, limit = 50, before?: { at: string; id: string }, db: CoreQueryable = getCoreDb()): Promise<ReportRunRecord[]> {
  const rows = before
    ? await coreAll(db, `SELECT * FROM report_runs WHERE client_id=$1 AND (generated_at,id)<($2,$3) ORDER BY generated_at DESC,id DESC LIMIT $4`, [clientId, before.at, before.id, limit])
    : await coreAll(db, `SELECT * FROM report_runs WHERE client_id=$1 ORDER BY generated_at DESC,id DESC LIMIT $2`, [clientId, limit]);
  return rows.map(rowToReportRun);
}

export async function getReportRun(clientId: string, id: string, db: CoreQueryable = getCoreDb()): Promise<ReportRunRecord | null> {
  const row = await coreGet(db, `SELECT * FROM report_runs WHERE client_id=$1 AND id=$2`, [clientId, id]);
  return row ? rowToReportRun(row) : null;
}

export async function getReportRunPdf(clientId: string, id: string, db: CoreQueryable = getCoreDb()): Promise<Buffer | null> {
  const row = await coreGet(db, `SELECT pdf_base64 FROM report_runs WHERE client_id=$1 AND id=$2`, [clientId, id]);
  return row ? Buffer.from(row.pdf_base64, 'base64') : null;
}

export async function recordReportSend(clientId: string, id: string, recipient: string, error: string | null, db: CoreQueryable = getCoreDb()) {
  await coreRun(db, `UPDATE report_runs SET last_sent_at=$1,last_sent_to=$2,last_send_error=$3 WHERE client_id=$4 AND id=$5`, [nowIso(), recipient, error, clientId, id]);
}

export async function listIntegrationsByProvider(provider: IntegrationProvider, db: CoreQueryable = getCoreDb()) {
  const rows = await coreAll(db, `SELECT * FROM integrations WHERE provider = $1 AND is_active = 1 ORDER BY updated_at DESC, created_at DESC`, [provider]);
  return rows.map(rowToIntegration);
}

export async function updateIntegrationSyncState(
  id: string,
  updates: { status?: IntegrationStatus; lastError?: string | null; lastSync?: string | null },
  db: CoreQueryable = getCoreDb(),
) {
  const current = await getIntegrationRowById(id, db);
  if (!current) {
    return null;
  }

  const timestamp = nowIso();
  const status = updates.status ?? current.status ?? 'pending';
  const lastSync = updates.lastSync ?? current.last_sync ?? null;
  const lastError = updates.lastError ?? current.last_error ?? null;

  await coreRun(db, `UPDATE integrations SET status = $1, last_sync = $2, last_error = $3, updated_at = $4 WHERE id = $5 AND is_active = 1`, [
    status,
    lastSync,
    lastError,
    timestamp,
    id,
  ]);

  const refreshed = await coreGet(db, `SELECT * FROM integrations WHERE id = $1`, [id]);
  return refreshed ? rowToIntegration(refreshed) : null;
}

export async function upsertUxSnapshot(input: ClarityUxSnapshotInput, db: CoreQueryable = getCoreDb()) {
  const client = await getClientById(input.clientId, db);
  if (!client) {
    return null;
  }

  const timestamp = nowIso();
  // Non-finite and missing numbers become 0 (as before); the ::numeric casts reproduce the assignment casts of the
  // former inlined literals, so INTEGER columns round fractional values instead of PostgreSQL rejecting "12.7".
  const count = (value: number | undefined) => (Number.isFinite(value) ? Number(value ?? 0) : 0);
  // One atomic upsert on UNIQUE(client_id, snapshot_date): concurrent syncs of the same day cannot collide. The
  // conflict branch keeps the stored id, created_at and snapshot_date, exactly like the former select-then-update.
  const row = await coreGet(
    db,
    `INSERT INTO ux_snapshots (
       id, client_id, snapshot_date, sessions, page_views, rage_clicks, dead_clicks, scroll_depth_avg, engaged_sessions, conversions, conversion_rate, notes, source, payload_json, created_at, updated_at
     ) VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12, $13, $14, $15, $15)
     ON CONFLICT (client_id, snapshot_date) DO UPDATE SET
       sessions = EXCLUDED.sessions,
       page_views = EXCLUDED.page_views,
       rage_clicks = EXCLUDED.rage_clicks,
       dead_clicks = EXCLUDED.dead_clicks,
       scroll_depth_avg = EXCLUDED.scroll_depth_avg,
       engaged_sessions = EXCLUDED.engaged_sessions,
       conversions = EXCLUDED.conversions,
       conversion_rate = EXCLUDED.conversion_rate,
       notes = EXCLUDED.notes,
       source = EXCLUDED.source,
       payload_json = EXCLUDED.payload_json,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      input.id ?? crypto.randomUUID(),
      input.clientId,
      input.snapshotDate.trim(),
      count(input.sessions),
      count(input.pageViews),
      count(input.rageClicks),
      count(input.deadClicks),
      count(input.scrollDepthAvg),
      count(input.engagedSessions),
      count(input.conversions),
      count(input.conversionRate),
      input.notes ?? null,
      input.source?.trim() || 'clarity',
      input.payloadJson ?? '{}',
      timestamp,
    ],
  );

  return row ? rowToUxSnapshot(row) : null;
}

export async function listRrssChannels(clientId: string, db: CoreQueryable = getCoreDb()) {
  const rows = await coreAll(db, `SELECT * FROM rrss_channels WHERE client_id = $1 ORDER BY sort_order ASC, created_at ASC`, [clientId]);
  return rows.map(rowToRrssChannel);
}

export async function getRrssChannelById(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM rrss_channels WHERE id = $1`, [id]);
  return row ? rowToRrssChannel(row) : null;
}

export async function saveRrssChannel(input: RrssChannelInput, db: CoreQueryable = getCoreDb()) {
  const client = await getClientById(input.clientId, db);
  if (!client) {
    return null;
  }

  const timestamp = nowIso();
  const platformKey = input.platformKey.trim();
  const label = input.label.trim();
  const isActive = input.isActive === false ? 0 : 1;
  // sort_order is bound with ::numeric to reproduce the assignment cast of the former inlined literal (2.7 -> 3).
  const sortOrder = Number.isFinite(input.sortOrder) ? input.sortOrder ?? 0 : 0;

  if (!input.id) {
    // Natural-key save: one atomic upsert on UNIQUE(client_id, platform_key, label). The conflict branch keeps the
    // stored id, created_at, platform_key and label, exactly like the former select-then-update.
    const row = await coreGet(
      db,
      `INSERT INTO rrss_channels (id, client_id, platform_key, label, is_active, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $7)
       ON CONFLICT (client_id, platform_key, label) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         sort_order = EXCLUDED.sort_order,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [crypto.randomUUID(), input.clientId, platformKey, label, isActive, sortOrder, timestamp],
    );
    return rowToRrssChannel(row);
  }

  // The id path only ever touches a row owned by input.clientId: a channel id that belongs to another client is
  // neither updated nor re-inserted (null, like an unknown client).
  const refreshed = await coreGet(
    db,
    `UPDATE rrss_channels
     SET platform_key = $1, label = $2, is_active = $3, sort_order = $4::numeric, updated_at = $5
     WHERE id = $6 AND client_id = $7
     RETURNING *`,
    [platformKey, label, isActive, sortOrder, timestamp, input.id, input.clientId],
  );
  if (refreshed) {
    return rowToRrssChannel(refreshed);
  }

  const created = await coreGet(
    db,
    `INSERT INTO rrss_channels (id, client_id, platform_key, label, is_active, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $7)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [input.id, input.clientId, platformKey, label, isActive, sortOrder, timestamp],
  );
  return created ? rowToRrssChannel(created) : null;
}

export async function listMonthlyKpis(clientId: string, monthKey?: string, db: CoreQueryable = getCoreDb()) {
  const rows = monthKey
    ? await coreAll(db, `SELECT * FROM monthly_kpis WHERE client_id = $1 AND month_key = $2 ORDER BY department_key ASC, metric_key ASC`, [clientId, monthKey])
    : await coreAll(db, `SELECT * FROM monthly_kpis WHERE client_id = $1 ORDER BY month_key DESC, department_key ASC, metric_key ASC`, [clientId]);
  return rows.map(rowToMonthlyKpi);
}

export async function saveMonthlyKpi(input: MonthlyKpiInput, db: CoreQueryable = getCoreDb()) {
  const client = await getClientById(input.clientId, db);
  if (!client) {
    return null;
  }
  nextMonthKey(input.monthKey);
  if ((await getMonthlyKpiCycleRow(input.clientId, input.monthKey, db))?.closed_at) {
    throw new UserFacingError('El mes está cerrado; un administrador debe reabrirlo antes de modificarlo');
  }

  const timestamp = nowIso();
  const existing = input.id
    ? await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [input.id])
    : await coreGet(db, `SELECT * FROM monthly_kpis WHERE client_id = $1 AND department_key = $2 AND metric_key = $3 AND month_key = $4`, [
        input.clientId,
        input.departmentKey,
        input.metricKey,
        input.monthKey,
      ]);

  if (existing?.client_id !== undefined && existing.client_id !== input.clientId) {
    throw new UserFacingError('El KPI no pertenece a este cliente');
  }
  if (existing?.closed_at) {
    throw new UserFacingError('El KPI está cerrado; un administrador debe reabrirlo antes de modificarlo');
  }

  const record = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    client_id: input.clientId,
    department_key: input.departmentKey,
    metric_key: input.metricKey.trim(),
    month_key: input.monthKey.trim(),
    target_value: typeof input.targetValue === 'number' ? finiteOrNull(input.targetValue) : null,
    target_text: input.targetText ?? null,
    actual_value: typeof input.actualValue === 'number' ? finiteOrNull(input.actualValue) : null,
    actual_text: input.actualText ?? null,
    status: input.status ?? existing?.status ?? 'unknown',
    difference_value: typeof input.differenceValue === 'number' ? finiteOrNull(input.differenceValue) : null,
    difference_pct: typeof input.differencePct === 'number' ? finiteOrNull(input.differencePct) : null,
    notes: input.notes ?? null,
    closed_at: existing?.closed_at ?? null,
    created_by_user_id: input.createdByUserId ?? existing?.created_by_user_id ?? null,
    updated_by_user_id: input.updatedByUserId ?? existing?.updated_by_user_id ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };

  // Both writes are single statements whose WHERE re-checks the closed state, so a close that lands between the
  // checks above and the write still wins (0 changed rows -> the same Spanish errors as before).
  if (existing) {
    const update = await coreRun(
      db,
      `UPDATE monthly_kpis
       SET department_key = $1, metric_key = $2, month_key = $3, target_value = $4, target_text = $5, actual_value = $6, actual_text = $7, status = $8, difference_value = $9, difference_pct = $10, notes = $11, closed_at = $12, created_by_user_id = $13, updated_by_user_id = $14, updated_at = $15
       WHERE id = $16 AND closed_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM monthly_kpi_cycles WHERE client_id = $17 AND month_key = $18 AND closed_at IS NOT NULL
       )`,
      [
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
        record.client_id,
        record.month_key,
      ],
    );
    if (update.changes === 0) throw new UserFacingError('El KPI está cerrado; un administrador debe reabrirlo antes de modificarlo');
  } else {
    // INSERT ... SELECT gives the parameters no column to infer their type from, hence the explicit casts.
    const insert = await coreRun(
      db,
      `INSERT INTO monthly_kpis (
        id, client_id, department_key, metric_key, month_key, target_value, target_text, actual_value, actual_text, status,
        difference_value, difference_pct, notes, closed_at, created_by_user_id, updated_by_user_id, created_at, updated_at
      ) SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::real, $7::text, $8::real, $9::text, $10::text,
          $11::real, $12::real, $13::text, $14::text, $15::text, $16::text, $17::text, $18::text
        WHERE NOT EXISTS (SELECT 1 FROM monthly_kpi_cycles WHERE client_id = $19 AND month_key = $20 AND closed_at IS NOT NULL)`,
      [
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
        record.client_id,
        record.month_key,
      ],
    );
    if (insert.changes === 0) throw new UserFacingError('El mes está cerrado; un administrador debe reabrirlo antes de modificarlo');
  }

  const saved = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [record.id]);
  return rowToMonthlyKpi(saved);
}

export async function closeMonthlyKpi(id: string, closedAt = nowIso(), actorUserId: string | null = null, db: CoreQueryable = getCoreDb()) {
  const existing = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [id]);
  if (!existing) {
    return null;
  }
  if (existing.closed_at) return rowToMonthlyKpi(existing);
  const timestamp = nowIso();
  // One statement (UPDATE + audit INSERT in a CTE) is atomic by itself, so no explicit transaction is needed.
  await coreRun(
    db,
    `WITH changed AS (
      UPDATE monthly_kpis SET closed_at = $1, updated_at = $2 WHERE id = $3 AND closed_at IS NULL RETURNING *
    ) INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
      SELECT $4::text, id, client_id, month_key, 'closed', $5::text, NULL, $6::text, row_to_json(changed)::text FROM changed`,
    [closedAt, timestamp, id, crypto.randomUUID(), actorUserId, timestamp],
  );
  const saved = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [id]);
  return rowToMonthlyKpi(saved);
}

export async function getMonthlyKpiById(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [id]);
  return row ? rowToMonthlyKpi(row) : null;
}

async function getMonthlyKpiCycleRow(clientId: string, monthKey: string, db: CoreQueryable) {
  return await coreGet(db, `SELECT * FROM monthly_kpi_cycles WHERE client_id = $1 AND month_key = $2`, [clientId, monthKey]);
}

export async function listMonthlyKpiCycles(clientId: string, db: CoreQueryable = getCoreDb()) {
  const rows = await coreAll(db, `SELECT * FROM monthly_kpi_cycles WHERE client_id = $1 ORDER BY month_key DESC`, [clientId]);
  return rows.map((row) => ({
    clientId: row.client_id as string,
    monthKey: row.month_key as string,
    closedAt: row.closed_at as string | null,
    closedByUserId: row.closed_by_user_id as string | null,
    reopenedAt: row.reopened_at as string | null,
    reopenedByUserId: row.reopened_by_user_id as string | null,
    reopenReason: row.reopen_reason as string | null,
  }));
}

async function transitionMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string | null, at: Date, allowReclose: boolean, db: CoreQueryable) {
  const nextMonth = nextMonthKey(monthKey);
  const timestamp = at.toISOString();
  const closeToken = crypto.randomUUID();
  // A single data-modifying CTE statement: the cycle upsert, the KPI close, the audit rows and the next-month rows
  // commit or fail together, and ON CONFLICT ... WHERE closed_at IS NULL makes concurrent closers lose atomically.
  await coreRun(
    db,
    `WITH cycle AS (
      INSERT INTO monthly_kpi_cycles (client_id, month_key, closed_at, closed_by_user_id, close_token, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $3, $3)
      ON CONFLICT (client_id, month_key) DO UPDATE SET
        closed_at = EXCLUDED.closed_at, closed_by_user_id = EXCLUDED.closed_by_user_id,
        close_token = EXCLUDED.close_token, reopened_at = NULL, reopened_by_user_id = NULL,
        reopen_reason = NULL, updated_at = EXCLUDED.updated_at
      WHERE monthly_kpi_cycles.closed_at IS NULL AND $6::boolean
      RETURNING client_id, month_key, closed_at
    ), closed_rows AS (
      UPDATE monthly_kpis m SET closed_at = cycle.closed_at, updated_at = cycle.closed_at
      FROM cycle WHERE m.client_id = cycle.client_id AND m.month_key = cycle.month_key AND m.closed_at IS NULL
      RETURNING m.*
    ), audit_rows AS (
      INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
      SELECT gen_random_uuid()::text, id, client_id, month_key, 'closed', $4::text, NULL, $3::text, row_to_json(closed_rows)::text
      FROM closed_rows
    ), next_rows AS (
      INSERT INTO monthly_kpis (id, client_id, department_key, metric_key, month_key, target_value, target_text,
        actual_value, actual_text, status, difference_value, difference_pct, notes, closed_at,
        created_by_user_id, updated_by_user_id, created_at, updated_at)
      SELECT gen_random_uuid()::text, m.client_id, m.department_key, m.metric_key, $7::text, m.target_value, m.target_text,
        NULL, NULL, 'unknown', NULL, NULL, NULL, NULL, NULL, NULL, $3::text, $3::text
      FROM monthly_kpis m JOIN cycle ON m.client_id = cycle.client_id AND m.month_key = cycle.month_key
      ON CONFLICT (client_id, department_key, metric_key, month_key) DO NOTHING
    ) SELECT COUNT(*) FROM cycle`,
    [clientId, monthKey, timestamp, actorUserId, closeToken, allowReclose, nextMonth],
  );
  return (await getMonthlyKpiCycleRow(clientId, monthKey, db))?.close_token === closeToken;
}

export async function closeMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string, at = new Date(), db: CoreQueryable = getCoreDb()) {
  if (!await getClientById(clientId, db)) return null;
  if ((await listMonthlyKpis(clientId, monthKey, db)).length === 0) return null;
  await transitionMonthlyKpiCycle(clientId, monthKey, actorUserId, at, true, db);
  return (await listMonthlyKpiCycles(clientId, db)).find((cycle) => cycle.monthKey === monthKey) ?? null;
}

export async function reopenMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string, reason: string, db: CoreQueryable = getCoreDb()) {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) throw new UserFacingError('La reapertura requiere un motivo de hasta 500 caracteres');
  const current = await getMonthlyKpiCycleRow(clientId, monthKey, db);
  if (current && !current.closed_at) throw new UserFacingError('El ciclo ya está abierto');
  if (!current && !(await listMonthlyKpis(clientId, monthKey, db)).some((kpi) => kpi.closedAt)) return null;
  const timestamp = nowIso();
  // Single data-modifying CTE statement, atomic like the close transition above.
  await coreRun(
    db,
    `WITH cycle AS (
      INSERT INTO monthly_kpi_cycles (client_id, month_key, closed_at, closed_by_user_id, close_token,
        reopened_at, reopened_by_user_id, reopen_reason, created_at, updated_at)
      VALUES ($1, $2, NULL, NULL, NULL, $3, $4, $5, $3, $3)
      ON CONFLICT (client_id, month_key) DO UPDATE SET closed_at = NULL,
        reopened_at = EXCLUDED.reopened_at, reopened_by_user_id = EXCLUDED.reopened_by_user_id,
        reopen_reason = EXCLUDED.reopen_reason, updated_at = EXCLUDED.updated_at
      WHERE monthly_kpi_cycles.closed_at IS NOT NULL
      RETURNING client_id, month_key
    ), opened_rows AS (
      UPDATE monthly_kpis m SET closed_at = NULL, updated_at = $3 FROM cycle
      WHERE m.client_id = cycle.client_id AND m.month_key = cycle.month_key AND m.closed_at IS NOT NULL
      RETURNING m.*
    ), audit_rows AS (
      INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
      SELECT gen_random_uuid()::text, id, client_id, month_key, 'reopened', $4::text, $5::text, $3::text, row_to_json(opened_rows)::text
      FROM opened_rows
    ) SELECT COUNT(*) FROM cycle`,
    [clientId, monthKey, timestamp, actorUserId, normalizedReason],
  );
  return (await listMonthlyKpiCycles(clientId, db)).find((cycle) => cycle.monthKey === monthKey) ?? null;
}

export async function closeDueMonthlyKpiCycles(now = new Date(), onlyClientId?: string, db: CoreQueryable = getCoreDb()) {
  const dueMonth = dueMonthlyKpiMonth(now);
  let closed = 0;
  let candidate: { client_id: string; month_key: string } | undefined;
  const findCandidate = () => coreGet<{ client_id: string; month_key: string }>(db, `SELECT m.client_id, m.month_key FROM monthly_kpis m
    WHERE m.month_key <= $1 AND m.month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      AND ($2::text IS NULL OR m.client_id = $2)
      AND NOT EXISTS (SELECT 1 FROM monthly_kpi_cycles c WHERE c.client_id = m.client_id AND c.month_key = m.month_key)
    GROUP BY m.client_id, m.month_key ORDER BY m.month_key ASC, m.client_id ASC LIMIT 1`,
    [dueMonth, onlyClientId ?? null]);
  // Bound each scheduler tick so a long historical catch-up does not monopolize the API process.
  for (let processed = 0; processed < 10; processed += 1) {
    candidate = await findCandidate();
    if (!candidate) break;
    if (await transitionMonthlyKpiCycle(candidate.client_id, candidate.month_key, null, now, false, db)) closed += 1;
  }
  return { dueMonth, closed, pending: Boolean(await findCandidate()) };
}

export async function reopenMonthlyKpi(id: string, actorUserId: string, reason: string, db: CoreQueryable = getCoreDb()) {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) throw new UserFacingError('La reapertura requiere un motivo de hasta 500 caracteres');
  const existing = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [id]);
  if (!existing) return null;
  if (!existing.closed_at) throw new UserFacingError('El KPI ya está abierto');
  const timestamp = nowIso();
  // One statement (UPDATE + audit INSERT in a CTE) is atomic by itself, so no explicit transaction is needed.
  await coreRun(
    db,
    `WITH changed AS (
      UPDATE monthly_kpis SET closed_at = NULL, updated_at = $1 WHERE id = $2 AND closed_at IS NOT NULL RETURNING *
    ) INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
      SELECT $3::text, id, client_id, month_key, 'reopened', $4::text, $5::text, $6::text, row_to_json(changed)::text FROM changed`,
    [timestamp, id, crypto.randomUUID(), actorUserId, normalizedReason, timestamp],
  );
  const saved = await coreGet(db, `SELECT * FROM monthly_kpis WHERE id = $1`, [id]);
  return rowToMonthlyKpi(saved);
}

export async function listMonthlyKpiEvents(id: string, db: CoreQueryable = getCoreDb()) {
  return await coreAll<Record<string, unknown>>(db, `SELECT id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json
    FROM monthly_kpi_events WHERE kpi_id = $1 ORDER BY occurred_at DESC, id DESC`, [id]);
}

export async function getDailyStatById(id: string, db: CoreQueryable = getCoreDb()) {
  const row = await coreGet(db, `SELECT * FROM daily_stats WHERE id = $1`, [id]);
  return row ? rowToDailyStat(row) : null;
}

/** The old SQL inliner wrote non-finite numbers as NULL; keep that so NOT NULL still rejects them. */
function finiteOrNull(value: number) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Single atomic INSERT ... ON CONFLICT on the UNIQUE(client_id, stat_date) index, so two concurrent writers of the same
 * day cannot race between a lookup and an insert. stat_date is a native DATE: only a real calendar day written as
 * YYYY-MM-DD is accepted (UserFacingError otherwise), so one day can never be stored under two spellings.
 */
export async function upsertDailyStat(input: {
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
}, db: CoreQueryable = getCoreDb()) {
  const statDate = assertCanonicalStatDate(input.statDate);
  const timestamp = nowIso();
  // $3::date is explicit: the column is DATE and the pool hands it back as the same YYYY-MM-DD string.
  // The ::numeric casts reproduce the assignment casts of the former inlined numeric literals: INTEGER columns round
  // fractional values (12.7 -> 13) and out-of-range values still fail, instead of PostgreSQL rejecting "12.7" as text.
  const row = await coreGet(
    db,
    `INSERT INTO daily_stats (
       id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
     ) VALUES ($1, $2, $3::date, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11, $12, $13, $13)
     ON CONFLICT (client_id, stat_date) DO UPDATE SET
       revenue = EXCLUDED.revenue,
       roas = EXCLUDED.roas,
       clicks = EXCLUDED.clicks,
       conversions = EXCLUDED.conversions,
       cpa = EXCLUDED.cpa,
       leads = EXCLUDED.leads,
       traffic = EXCLUDED.traffic,
       notes = EXCLUDED.notes,
       source = EXCLUDED.source,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      crypto.randomUUID(),
      input.clientId,
      statDate,
      finiteOrNull(input.revenue ?? 0),
      finiteOrNull(input.roas ?? 0),
      finiteOrNull(input.clicks ?? 0),
      finiteOrNull(input.conversions ?? 0),
      finiteOrNull(input.cpa ?? 0),
      finiteOrNull(input.leads ?? 0),
      finiteOrNull(input.traffic ?? 0),
      input.notes ?? null,
      input.source ?? 'manual',
      timestamp,
    ],
  );

  return row ? rowToDailyStat(row) : null;
}

export async function deleteDailyStat(id: string) {
  const result = await coreRun(getCoreDb(), `DELETE FROM daily_stats WHERE id = $1`, [id]);
  return result.changes > 0;
}

export async function getDashboardHealthSummary(options?: { clientIds?: string[] | null }) {
  const db = getCoreDb();
  const scope = options?.clientIds;
  const clientsWhere = scope ? `WHERE id = ANY($1::text[])` : '';
  const statsWhere = scope ? `WHERE client_id = ANY($1::text[])` : '';
  // COUNT(*) is bigint, which pg returns as a string; ::int keeps the numbers the API has always returned.
  const totalUsers = await coreGet<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM users`);
  const totalClients = await coreGet<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM clients ${clientsWhere}`, scopeParam(scope));
  const totalStats = await coreGet<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM daily_stats ${statsWhere}`, scopeParam(scope));
  return {
    users: totalUsers!.total,
    clients: totalClients!.total,
    dailyStats: totalStats!.total,
  };
}

export async function listClientsWithLatestStat(options?: { clientIds?: string[] | null }, db: CoreQueryable = getCoreDb()) {
  const clients = await listClients(options, db);
  const scope = options?.clientIds;
  // One query for every client's newest stat (same ordering as the former per-client LIMIT 1 lookups).
  const latestRows = await coreAll(
    db,
    `SELECT DISTINCT ON (client_id) * FROM daily_stats ${scope ? 'WHERE client_id = ANY($1::text[])' : ''}
     ORDER BY client_id, stat_date DESC, created_at DESC`,
    scopeParam(scope),
  );
  const latestByClient = new Map(latestRows.map((row) => [row.client_id as string, rowToDailyStat(row)]));
  const clientsWithStats = clients.map((client) => ({
    ...client,
    latestStat: latestByClient.get(client.id) ?? null,
  }));

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

/**
 * Revenue per client inside the inclusive [end - days + 1, end] window, computed with ONE grouped query (replaces a
 * listDailyStats call per client). Revenues are aggregated in listDailyStats order and summed in JavaScript so the
 * totals are bit-identical to sumRevenueWindow over the same rows. Clients without rows are absent from the map.
 */
export async function getRevenueWindowsByClient(
  options: { clientIds?: string[] | null } | undefined,
  endDate: string,
  days = 30,
  db: CoreQueryable = getCoreDb(),
) {
  const { startDate } = sumRevenueWindow([], endDate, days);
  const scope = options?.clientIds;
  // stat_date is a native DATE, so the window bounds compare as dates (no collation involved).
  const rows = await coreAll<{ client_id: string; revenues: Array<number | string> }>(
    db,
    `SELECT client_id, array_agg(revenue ORDER BY stat_date DESC, created_at DESC) AS revenues
     FROM daily_stats
     WHERE stat_date >= $1::date AND stat_date <= $2::date ${scope ? 'AND client_id = ANY($3::text[])' : ''}
     GROUP BY client_id`,
    [startDate, endDate, ...scopeParam(scope)],
  );
  const windows = new Map<string, ReturnType<typeof sumRevenueWindow>>();
  for (const row of rows) {
    const revenues = row.revenues.map(Number);
    windows.set(row.client_id, {
      total: revenues.reduce((total, revenue) => total + revenue, 0),
      count: revenues.length,
      startDate,
      endDate,
    });
  }
  return windows;
}

/** Clients with their newest stat and 30-day revenue window in a constant number of queries (no per-client lookups). */
export async function listClientsWithRevenueWindow(
  options: { clientIds?: string[] | null } | undefined,
  endDate: string,
  days = 30,
  db: CoreQueryable = getCoreDb(),
) {
  const clients = await listClientsWithLatestStat(options, db);
  const windows = await getRevenueWindowsByClient(options, endDate, days, db);
  const empty = sumRevenueWindow([], endDate, days);
  return clients.map((client) => ({
    ...client,
    revenue30d: windows.get(client.id) ?? empty,
  }));
}
