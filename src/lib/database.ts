import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { getBootstrapUsers } from './bootstrapUsers.js';
import { hasLiveIntegrationAdapter, resolveIntegrationSaveState, statusForIntegrationView } from './integrationState.js';
import { createSessionToken, hashPassword, hashToken, normalizeEmail, nowIso, verifyPassword } from './auth.js';
import { DEFAULT_KPI_THRESHOLDS, normalizeKpiThresholds, parseKpiThresholdsJson, type KpiThresholds } from './kpiThresholds.js';
import { dueMonthlyKpiMonth, nextMonthKey } from './monthlyCloseClock.js';
import { parseWooRefundPolicy } from './woocommerce.js';
import type { WooCommerceOrderSummary } from './woocommerce.js';
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

interface DbRunResult {
  changes: number;
}

interface PreparedStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): DbRunResult;
}

interface AppDatabase {
  kind: 'postgres';
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  tableColumns(tableName: string): string[];
  backup(filePath: string): Promise<void>;
}

let database: AppDatabase | null = null;

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

function escapeSqlLiteral(value: unknown) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }

  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function inlineSqlParams(sql: string, params: unknown[]) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Date)) {
    const record = params[0] as Record<string, unknown>;
    return sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => escapeSqlLiteral(record[key]));
  }

  let index = 0;
  return sql.replace(/\?/g, () => {
    if (index >= params.length) {
      throw new Error(`Missing SQL parameter at position ${index + 1}`);
    }

    const value = params[index];
    index += 1;
    return escapeSqlLiteral(value);
  });
}

function getPostgresConnectionString() {
  const connectionString = process.env.DATABASE_URL ?? process.env.INFIDASH_DATABASE_URL ?? '';
  return connectionString.trim() || null;
}

function getPostgresClientEnv() {
  const env = { ...process.env };
  if (!env.PGSSLMODE && env.DATABASE_SSL) {
    env.PGSSLMODE = env.DATABASE_SSL;
  }
  if (!env.PGCONNECT_TIMEOUT) {
    env.PGCONNECT_TIMEOUT = '5';
  }
  return env;
}

function runPostgresCommand(connectionString: string, sql: string) {
  const result = spawnSync(
    'psql',
    [
      '-X',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--dbname',
      connectionString,
      '-c',
      sql,
    ],
    {
      encoding: 'utf8',
      env: getPostgresClientEnv(),
    }
  );

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || 'unknown postgres error').trim();
    throw new Error(message);
  }

  return (result.stdout || '').trim();
}

function runPostgresQuery<T = unknown>(connectionString: string, sql: string): T[] {
  const wrapped = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS data FROM (${sql}) AS t`;
  const raw = runPostgresCommand(connectionString, wrapped);
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as T[];
  return Array.isArray(parsed) ? parsed : [];
}

function createPostgresDatabase(connectionString: string): AppDatabase {
  return {
    kind: 'postgres',
    prepare(sql) {
      return {
        get: (...params: unknown[]) => {
          const finalSql = inlineSqlParams(sql, params);
          const rows = runPostgresQuery<Record<string, unknown>>(connectionString, finalSql);
          return rows[0] ?? undefined;
        },
        all: (...params: unknown[]) => {
          const finalSql = inlineSqlParams(sql, params);
          return runPostgresQuery<Record<string, unknown>>(connectionString, finalSql);
        },
        run: (...params: unknown[]) => {
          const finalSql = inlineSqlParams(sql, params).trim().replace(/;\s*$/, '');
          const normalized = finalSql.replace(/\s+$/, '');
          const dmlMatch = /^(insert|update|delete)\b/i.test(normalized);
          if (!dmlMatch) {
            runPostgresCommand(connectionString, normalized);
            return { changes: 0 };
          }

          const wrapped = `WITH affected AS (${normalized} RETURNING 1) SELECT COUNT(*)::int AS changes FROM affected`;
          const raw = runPostgresCommand(connectionString, wrapped);
          return { changes: Number(raw || 0) };
        },
      };
    },
    exec(sql) {
      runPostgresCommand(connectionString, sql);
    },
    tableColumns(tableName) {
      const rows = runPostgresQuery<{ column_name: string }>(
        connectionString,
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ${escapeSqlLiteral(tableName)}
          ORDER BY ordinal_position
        `,
      );
      return rows.map((row) => row.column_name);
    },
    async backup(filePath) {
      ensureDirectoryExists(filePath);
      const result = spawnSync(
        'pg_dump',
        [
          '--dbname',
          connectionString,
          '--format=plain',
          '--no-owner',
          '--no-privileges',
        ],
        {
          encoding: 'utf8',
          env: getPostgresClientEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      if (result.status !== 0) {
        const message = (result.stderr || result.stdout || 'unknown pg_dump error').trim();
        throw new Error(message);
      }

      fs.writeFileSync(filePath, result.stdout || '', 'utf8');
    },
  };
}

function createDatabase() {
  const connectionString = getPostgresConnectionString();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to start Infidash');
  }

  runPostgresCommand(connectionString, 'SELECT 1');
  return createPostgresDatabase(connectionString);
}

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
  'ai_insights',
] as const;

type LegacySqliteDump = Partial<Record<(typeof legacySqliteTables)[number], Array<Record<string, unknown>>>>;

function readLegacySqliteDump(): LegacySqliteDump | null {
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

  const result = spawnSync('python', ['-c', script, legacySqlitePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || 'unknown sqlite export error').trim();
    throw new Error(message);
  }

  const raw = (result.stdout || '').trim();
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as LegacySqliteDump;
}

function importLegacySqliteData(db: AppDatabase) {
  if (process.env.NODE_ENV === 'production' || process.env.INFIDASH_SKIP_LEGACY_SQLITE_IMPORT === '1') {
    return;
  }

  const dump = readLegacySqliteDump();
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
    aiInsights: 0,
  };

  const orgIdMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const clientIdMap = new Map<string, string>();

  const getOrgIdBySlug = (slug: string) => {
    const row = db.prepare(`SELECT id FROM organizations WHERE slug = ?`).get(slug) as { id: string } | undefined;
    return row?.id ?? null;
  };

  const getUserIdByEmail = (email: string) => {
    const row = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: string } | undefined;
    return row?.id ?? null;
  };

  const getClientIdBySlug = (slug: string) => {
    const row = db.prepare(`SELECT id FROM clients WHERE slug = ?`).get(slug) as { id: string } | undefined;
    return row?.id ?? null;
  };

  const insertOrganization = db.prepare(
    `INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING`
  );
  for (const row of dump.organizations ?? []) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    insertOrganization.run(
      legacyId || crypto.randomUUID(),
      String(row.name ?? slug),
      slug,
      String(row.created_at ?? nowIso()),
    );
    const destId = getOrgIdBySlug(slug) ?? legacyId;
    if (legacyId && destId) {
      orgIdMap.set(legacyId, destId);
    }
    importCounts.organizations += 1;
  }

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING`
  );
  for (const row of dump.users ?? []) {
    const email = normalizeEmail(String(row.email ?? ''));
    if (!email) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    insertUser.run(
      legacyId || crypto.randomUUID(),
      email,
      String(row.name ?? 'Usuario').trim() || 'Usuario',
      String(row.password_hash ?? row.passwordHash ?? ''),
      String(row.role ?? 'viewer'),
      Number(row.active ?? 1) ? 1 : 0,
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    );
    const destId = getUserIdByEmail(email) ?? legacyId;
    if (legacyId && destId) {
      userIdMap.set(legacyId, destId);
    }
    importCounts.users += 1;
  }

  const insertClient = db.prepare(
    `INSERT INTO clients (id, org_id, name, slug, logo_url, industry, health_score, kpi_thresholds_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO NOTHING`
  );
  for (const row of dump.clients ?? []) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) {
      continue;
    }

    const legacyId = String(row.id ?? '');
    const legacyOrgId = String(row.org_id ?? '').trim();
    const orgId = legacyOrgId ? orgIdMap.get(legacyOrgId) ?? getOrgIdBySlug(legacyOrgId) ?? legacyOrgId : null;
    insertClient.run(
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
    );
    const destId = getClientIdBySlug(slug) ?? legacyId;
    if (legacyId && destId) {
      clientIdMap.set(legacyId, destId);
    }
    importCounts.clients += 1;
  }

  const insertIntegration = db.prepare(
    `INSERT INTO integrations (
      id, client_id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, provider) DO NOTHING`
  );
  for (const row of dump.integrations ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    insertIntegration.run(
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
    );
    importCounts.integrations += 1;
  }

  const insertDailyStat = db.prepare(
    `INSERT INTO daily_stats (
      id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, stat_date) DO NOTHING`
  );
  for (const row of dump.daily_stats ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    insertDailyStat.run(
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.stat_date ?? '').trim(),
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
    );
    importCounts.dailyStats += 1;
  }

  const insertUxSnapshot = db.prepare(
    `INSERT INTO ux_snapshots (
      id, client_id, snapshot_date, sessions, page_views, rage_clicks, dead_clicks, scroll_depth_avg, engaged_sessions,
      conversions, conversion_rate, notes, source, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, snapshot_date) DO NOTHING`
  );
  for (const row of dump.ux_snapshots ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    insertUxSnapshot.run(
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
    );
    importCounts.uxSnapshots += 1;
  }

  const insertRrssChannel = db.prepare(
    `INSERT INTO rrss_channels (
      id, client_id, platform_key, label, is_active, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, platform_key, label) DO NOTHING`
  );
  for (const row of dump.rrss_channels ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    insertRrssChannel.run(
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.platform_key ?? '').trim(),
      String(row.label ?? '').trim(),
      Number(row.is_active ?? 1) ? 1 : 0,
      Number(row.sort_order ?? 0),
      String(row.created_at ?? nowIso()),
      String(row.updated_at ?? nowIso()),
    );
    importCounts.rrssChannels += 1;
  }

  const insertMonthlyKpi = db.prepare(
    `INSERT INTO monthly_kpis (
      id, client_id, department_key, metric_key, month_key, target_value, target_text, actual_value, actual_text,
      status, difference_value, difference_pct, notes, closed_at, created_by_user_id, updated_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, department_key, metric_key, month_key) DO NOTHING`
  );
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

    insertMonthlyKpi.run(
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
    );
    importCounts.monthlyKpis += 1;
  }

  const insertAiInsight = db.prepare(
    `INSERT INTO ai_insights (id, client_id, insight_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  );
  for (const row of dump.ai_insights ?? []) {
    const legacyClientId = String(row.client_id ?? '').trim();
    const clientId = legacyClientId ? clientIdMap.get(legacyClientId) ?? legacyClientId : String(row.client_id ?? '');
    if (!clientId) {
      continue;
    }

    insertAiInsight.run(
      String(row.id ?? crypto.randomUUID()),
      clientId,
      String(row.insight_json ?? '{}'),
      String(row.created_at ?? nowIso()),
    );
    importCounts.aiInsights += 1;
  }

  const importedAnything = Object.values(importCounts).some((count) => count > 0);
  if (importedAnything) {
    console.warn('[infidash] Migración legacy SQLite→Postgres completada', importCounts);
  }
}

function getBackupFilePath(label?: string | null) {
  ensureDirectoryExists(path.join(backupDir, 'backup.placeholder'));
  const stamp = nowIso().replace(/[:.]/g, '-');
  const safeLabel = sanitizeBackupLabel(label);
  return path.join(backupDir, `infidash-${safeLabel}-${stamp}.sql`);
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


function initializeSchema(db: AppDatabase) {
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

    CREATE TABLE IF NOT EXISTS client_memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, client_id)
    );

    CREATE INDEX IF NOT EXISTS idx_client_memberships_user ON client_memberships (user_id);

    CREATE TABLE IF NOT EXISTS schema_backfills (
      key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS woocommerce_sales_snapshots (
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      purchase_from TEXT NOT NULL,
      purchase_to TEXT NOT NULL,
      orders_json JSONB NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (integration_id, source_key, purchase_from, purchase_to),
      CHECK (purchase_from <= purchase_to)
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

    CREATE TABLE IF NOT EXISTS monthly_kpi_cycles (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      closed_at TEXT,
      closed_by_user_id TEXT,
      close_token TEXT,
      reopened_at TEXT,
      reopened_by_user_id TEXT,
      reopen_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (client_id, month_key)
    );

    CREATE TABLE IF NOT EXISTS monthly_kpi_events (
      id TEXT PRIMARY KEY,
      kpi_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('closed', 'reopened')),
      actor_user_id TEXT,
      reason TEXT,
      occurred_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monthly_kpi_events_kpi_time ON monthly_kpi_events (kpi_id, occurred_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS ai_insights (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      insight_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'wordpress',
      name TEXT,
      email TEXT,
      phone TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed', 'lost')),
      dedupe_key TEXT,
      raw_payload_json TEXT NOT NULL DEFAULT '{}',
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_client_received_id ON leads (client_id, received_at DESC, id DESC);
  `);
}

function ensureLeadSchema(db: AppDatabase) {
  if (!db.tableColumns('leads').includes('dedupe_key')) {
    db.exec(`ALTER TABLE leads ADD COLUMN dedupe_key TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_integration_delivery ON leads (integration_id, dedupe_key) WHERE dedupe_key IS NOT NULL`);
}

function ensureClientMembershipsBackfill(db: AppDatabase) {
  const marker = db.prepare(`SELECT 1 FROM schema_backfills WHERE key = ?`).get('client_memberships_v1');
  if (marker) return;

  const viewers = db.prepare(`SELECT id FROM users WHERE role = 'viewer'`).all() as { id: string }[];
  const clients = db.prepare(`SELECT id FROM clients`).all() as { id: string }[];
  const insert = db.prepare(
    `INSERT INTO client_memberships (id, user_id, client_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, client_id) DO NOTHING`
  );
  for (const viewer of viewers) {
    for (const client of clients) {
      insert.run(crypto.randomUUID(), viewer.id, client.id, nowIso());
    }
  }

  db.prepare(`INSERT INTO schema_backfills (key, completed_at) VALUES (?, ?)`).run('client_memberships_v1', nowIso());
}

function ensureUxSnapshotSchema(db: AppDatabase) {
  const existingColumns = new Set(db.tableColumns('ux_snapshots'));
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

function ensureClientThresholdSchema(db: AppDatabase) {
  if (!db.tableColumns('clients').includes('kpi_thresholds_json')) {
    db.exec(`ALTER TABLE clients ADD COLUMN kpi_thresholds_json TEXT NOT NULL DEFAULT '{}'`);
  }
}

function ensureIntegrationSchema(db: AppDatabase) {
  const existingColumns = new Set(db.tableColumns('integrations'));
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

  if (!existingColumns.has('webhook_secret')) {
    addColumn(`webhook_secret TEXT`);
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

function seedDefaults(db: AppDatabase) {
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

  const existingAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  const users = getBootstrapUsers(process.env, Boolean(existingAdmin));

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
    ensureLeadSchema(database);
    ensureUxSnapshotSchema(database);
    ensureClientMembershipsBackfill(database);
    seedDefaults(database);
    importLegacySqliteData(database);
  }

  return database;
}

function getClientIdsForUser(userId: string, role: UserRole): string[] | null {
  if (role === 'admin') return null;
  const rows = getDatabase().prepare(`SELECT client_id FROM client_memberships WHERE user_id = ?`).all(userId) as { client_id: string }[];
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

function rowToUser(row: any): PublicUser {
  const base = rowToUserBase(row);
  return { ...base, clientIds: getClientIdsForUser(base.id, base.role) };
}

function rowsToUsers(rows: any[]): PublicUser[] {
  const membershipRows = getDatabase().prepare(`SELECT user_id, client_id FROM client_memberships`).all() as { user_id: string; client_id: string }[];
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

export function listUsers() {
  const rows = getDatabase().prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as any[];
  return rowsToUsers(rows);
}

function setClientMemberships(db: AppDatabase, userId: string, clientIds: string[]) {
  db.prepare(`DELETE FROM client_memberships WHERE user_id = ?`).run(userId);
  const insert = db.prepare(`INSERT INTO client_memberships (id, user_id, client_id, created_at) VALUES (?, ?, ?, ?)`);
  const timestamp = nowIso();
  for (const clientId of clientIds) {
    insert.run(crypto.randomUUID(), userId, clientId, timestamp);
  }
}

export function createUser(input: { email: string; name: string; password: string; role: UserRole; clientIds?: string[] }) {
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
  if (input.role === 'viewer') {
    setClientMemberships(db, record.id, input.clientIds ?? []);
  }
  return rowToUser(record);
}

export function updateUserRole(userId: string, updates: Partial<{ role: UserRole; active: boolean; name: string; clientIds: string[] }>) {
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

  if (nextRole === 'admin') {
    // Membership rows only ever exist for viewers — clear them so a later
    // demotion back to viewer never silently resurrects stale access.
    db.prepare(`DELETE FROM client_memberships WHERE user_id = ?`).run(userId);
  } else if (updates.clientIds) {
    setClientMemberships(db, userId, updates.clientIds);
  }

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

function clientIdsInClause(clientIds: string[]) {
  return clientIds.length ? `(${clientIds.map((id) => escapeSqlLiteral(id)).join(',')})` : '(NULL)';
}

export function listClients(options?: { clientIds?: string[] | null }) {
  const scope = options?.clientIds;
  const where = scope ? `WHERE id IN ${clientIdsInClause(scope)}` : '';
  const rows = getDatabase().prepare(`SELECT * FROM clients ${where} ORDER BY name ASC`).all();
  return rows.map(rowToClient);
}

export function getClientBySlug(slug: string) {
  const row = getDatabase().prepare(`SELECT * FROM clients WHERE slug = ?`).get(slug) as any;
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

export function createClient(input: { name: string; industry?: string | null; logoUrl?: string | null; healthScore?: number; kpiThresholds?: Partial<KpiThresholds> | null }) {
  const db = getDatabase();
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

  db.prepare(
    `INSERT INTO clients (id, name, slug, logo_url, industry, health_score, kpi_thresholds_json, created_at, updated_at)
     VALUES (@id, @name, @slug, @logo_url, @industry, @health_score, @kpi_thresholds_json, @created_at, @updated_at)`
  ).run(record);

  return rowToClient(record);
}

export function updateClient(clientId: string, input: { name?: string; industry?: string | null; logoUrl?: string | null; healthScore?: number; kpiThresholds?: Partial<KpiThresholds> | null }) {
  const db = getDatabase();
  const existing = getClientById(clientId);
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

  db.prepare(
    `UPDATE clients
     SET name = ?, slug = ?, logo_url = ?, industry = ?, health_score = ?, kpi_thresholds_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    nextName,
    slug,
    nextLogoUrl ?? null,
    nextIndustry ?? null,
    nextHealthScore,
    JSON.stringify(nextThresholds),
    timestamp,
    clientId,
  );

  return getClientById(clientId);
}

export function deleteClient(clientId: string) {
  const db = getDatabase();
  const exists = db.prepare(`SELECT 1 FROM clients WHERE id = ?`).get(clientId);
  db.prepare(`DELETE FROM clients WHERE id = ?`).run(clientId);
  return Boolean(exists);
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
  if (provider === 'woocommerce') parseWooRefundPolicy(config.refundPolicy);
  const credentials = normalizeIntegrationSection(definition.credentialFields, { ...previousCredentials, ...(input.credentials ?? {}) });
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
    db.prepare(
      `UPDATE integrations
       SET client_id = ?, provider = ?, label = ?, status = ?, config_json = ?, credentials_json = ?, is_active = ?, last_sync = ?, last_error = ?, webhook_secret = ?, updated_at = ?
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
      webhookSecret,
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
    webhook_secret: webhookSecret,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO integrations (
      id, client_id, provider, label, status, config_json, credentials_json, is_active, last_sync, last_error, webhook_secret, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    record.webhook_secret,
    record.created_at,
    record.updated_at,
  );

  const created = db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(record.id) as any;
  return rowToIntegration(created);
}

export function getIntegrationByWebhookSecret(secret: string) {
  if (!secret) {
    return null;
  }

  const row = getDatabase().prepare(`SELECT * FROM integrations WHERE webhook_secret = ? AND is_active = 1 AND status <> 'disabled'`).get(secret) as any;
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
export function saveWooCommerceSalesSnapshot(input: Omit<WooCommerceSalesSnapshot, 'syncedAt'>) {
  const syncedAt = nowIso();
  getDatabase().prepare(`INSERT INTO woocommerce_sales_snapshots
      (integration_id, source_key, purchase_from, purchase_to, orders_json, synced_at)
    VALUES (?, ?, ?, ?, ?::jsonb, ?)
    ON CONFLICT (integration_id, source_key, purchase_from, purchase_to)
    DO UPDATE SET orders_json = EXCLUDED.orders_json, synced_at = EXCLUDED.synced_at`)
    .run(input.integrationId, input.sourceKey, input.from, input.to, JSON.stringify(input.orders), syncedAt);
  return { ...input, syncedAt };
}

export function getWooCommerceSalesSnapshot(input: Pick<WooCommerceSalesSnapshot, 'integrationId' | 'sourceKey' | 'from' | 'to'>): WooCommerceSalesSnapshot | null {
  const row = getDatabase().prepare(`SELECT integration_id, source_key, purchase_from, purchase_to, orders_json, synced_at
    FROM woocommerce_sales_snapshots WHERE integration_id = ? AND source_key = ? AND purchase_from = ? AND purchase_to = ?`)
    .get(input.integrationId, input.sourceKey, input.from, input.to) as any;
  if (!row) return null;
  const orders = typeof row.orders_json === 'string' ? JSON.parse(row.orders_json) : row.orders_json;
  if (!Array.isArray(orders)) throw new Error('El resumen WooCommerce guardado no es válido');
  return { integrationId: row.integration_id, sourceKey: row.source_key, from: row.purchase_from,
    to: row.purchase_to, orders, syncedAt: row.synced_at };
}

export function setClientIntegrationActive(id: string, active: boolean) {
  const db = getDatabase();
  const existing = getIntegrationRowById(id);
  if (!existing) return null;
  db.prepare(`UPDATE integrations SET is_active = ?, status = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
    .run(active ? 1 : 0, active ? 'pending' : 'disabled', nowIso(), id);
  return rowToIntegration(getIntegrationRowById(id));
}

export function rotateClientIntegrationWebhook(id: string) {
  const db = getDatabase();
  const existing = getIntegrationRowById(id);
  if (!existing || existing.provider !== 'wordpress') return null;
  db.prepare(`UPDATE integrations SET webhook_secret = ?, updated_at = ? WHERE id = ?`)
    .run(crypto.randomBytes(24).toString('hex'), nowIso(), id);
  return rowToIntegration(getIntegrationRowById(id));
}

export function insertLead(input: {
  clientId: string;
  integrationId: string | null;
  source: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  rawPayload: Record<string, unknown>;
  dedupeKey?: string | null;
}) {
  const db = getDatabase();
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
    dedupe_key: input.dedupeKey ?? null,
    raw_payload_json: JSON.stringify(input.rawPayload ?? {}),
    received_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(
    `INSERT INTO leads (
      id, client_id, integration_id, source, name, email, phone, message, status, dedupe_key, raw_payload_json, received_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  ).run(
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
  );
  const created = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(record.id) as any;
  if (created) return { lead: rowToLead(created), duplicate: false };
  if (!record.dedupe_key || !record.integration_id) throw new Error('No se pudo guardar el lead');
  const existing = db.prepare(`SELECT * FROM leads WHERE integration_id = ? AND dedupe_key = ?`)
    .get(record.integration_id, record.dedupe_key) as any;
  if (!existing) throw new Error('No se pudo recuperar el lead duplicado');
  return { lead: rowToLead(existing), duplicate: true };
}

export function listLeadsByClient(clientId: string, query: { limit: number; offset: number; status: string | null; source: string | null }) {
  const db = getDatabase();
  const conditions = ['client_id = ?'];
  const parameters: Array<string | number> = [clientId];
  if (query.status) {
    conditions.push('status = ?');
    parameters.push(query.status);
  }
  if (query.source) {
    conditions.push('source = ?');
    parameters.push(query.source);
  }
  const where = conditions.join(' AND ');
  const count = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status IN ('new', 'in_progress') THEN 1 ELSE 0 END) AS open_count,
    SUM(CASE WHEN status IN ('closed', 'lost') THEN 1 ELSE 0 END) AS resolved_count
    FROM leads WHERE ${where}`).get(...parameters) as any;
  const rows = db.prepare(`SELECT * FROM leads WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...parameters, query.limit, query.offset) as any[];
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
  const status: IntegrationStatus = 'pending';
  const lastError = missingFields.length > 0
    ? `Faltan campos obligatorios: ${missingFields.join(', ')}`
    : hasLiveIntegrationAdapter(integration.provider)
      ? 'Configuración completa; falta una prueba o sincronización real.'
      : 'La configuración está completa, pero este proveedor todavía no dispone de una prueba/sincronización real.';

  db.prepare(`UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(
    status,
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

export function setClientIntegrationStatus(id: string, status: IntegrationStatus, lastError: string | null = null, lastSync?: string) {
  const db = getDatabase();
  const timestamp = nowIso();
  if (lastSync) {
    db.prepare(`UPDATE integrations SET status = ?, last_error = ?, last_sync = ?, updated_at = ? WHERE id = ? AND is_active = 1`).run(status, lastError, lastSync, timestamp, id);
  } else {
    db.prepare(`UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND is_active = 1`).run(status, lastError, timestamp, id);
  }
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

export function listDailyStats(clientId?: string, options?: { clientIds?: string[] | null }) {
  if (clientId) {
    const rows = getDatabase().prepare(`SELECT * FROM daily_stats WHERE client_id = ? ORDER BY stat_date DESC, created_at DESC`).all(clientId);
    return rows.map(rowToDailyStat);
  }
  const scope = options?.clientIds;
  const where = scope ? `WHERE client_id IN ${clientIdsInClause(scope)}` : '';
  const rows = getDatabase().prepare(`SELECT * FROM daily_stats ${where} ORDER BY stat_date DESC, created_at DESC`).all();
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

  db.prepare(`UPDATE integrations SET status = ?, last_sync = ?, last_error = ?, updated_at = ? WHERE id = ? AND is_active = 1`).run(
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
  nextMonthKey(input.monthKey);
  if (getMonthlyKpiCycleRow(input.clientId, input.monthKey)?.closed_at) {
    throw new Error('El mes está cerrado; un administrador debe reabrirlo antes de modificarlo');
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

  if (existing?.client_id !== undefined && existing.client_id !== input.clientId) {
    throw new Error('El KPI no pertenece a este cliente');
  }
  if (existing?.closed_at) {
    throw new Error('El KPI está cerrado; un administrador debe reabrirlo antes de modificarlo');
  }

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
    const update = db.prepare(
      `UPDATE monthly_kpis
       SET department_key = ?, metric_key = ?, month_key = ?, target_value = ?, target_text = ?, actual_value = ?, actual_text = ?, status = ?, difference_value = ?, difference_pct = ?, notes = ?, closed_at = ?, created_by_user_id = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ? AND closed_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM monthly_kpi_cycles WHERE client_id = ? AND month_key = ? AND closed_at IS NOT NULL
       )`
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
      record.client_id,
      record.month_key,
    );
    if (update.changes === 0) throw new Error('El KPI está cerrado; un administrador debe reabrirlo antes de modificarlo');
  } else {
    const insert = db.prepare(
      `INSERT INTO monthly_kpis (
        id, client_id, department_key, metric_key, month_key, target_value, target_text, actual_value, actual_text, status,
        difference_value, difference_pct, notes, closed_at, created_by_user_id, updated_by_user_id, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM monthly_kpi_cycles WHERE client_id = ? AND month_key = ? AND closed_at IS NOT NULL)`
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
      record.client_id,
      record.month_key,
    );
    if (insert.changes === 0) throw new Error('El mes está cerrado; un administrador debe reabrirlo antes de modificarlo');
  }

  const saved = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(record.id) as any;
  return rowToMonthlyKpi(saved);
}

export function closeMonthlyKpi(id: string, closedAt = nowIso(), actorUserId: string | null = null) {
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  if (!existing) {
    return null;
  }
  if (existing.closed_at) return rowToMonthlyKpi(existing);
  const timestamp = nowIso();
  db.prepare(`WITH changed AS (
    UPDATE monthly_kpis SET closed_at = ?, updated_at = ? WHERE id = ? AND closed_at IS NULL RETURNING *
  ) INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
    SELECT ?, id, client_id, month_key, 'closed', ?, NULL, ?, row_to_json(changed)::text FROM changed`)
    .run(closedAt, timestamp, id, crypto.randomUUID(), actorUserId, timestamp);
  const saved = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  return rowToMonthlyKpi(saved);
}

export function getMonthlyKpiById(id: string) {
  const row = getDatabase().prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  return row ? rowToMonthlyKpi(row) : null;
}

function getMonthlyKpiCycleRow(clientId: string, monthKey: string) {
  return getDatabase().prepare(`SELECT * FROM monthly_kpi_cycles WHERE client_id = ? AND month_key = ?`)
    .get(clientId, monthKey) as any;
}

export function listMonthlyKpiCycles(clientId: string) {
  const rows = getDatabase().prepare(`SELECT * FROM monthly_kpi_cycles WHERE client_id = ? ORDER BY month_key DESC`)
    .all(clientId) as any[];
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

function transitionMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string | null, at: Date, allowReclose: boolean) {
  const nextMonth = nextMonthKey(monthKey);
  const timestamp = at.toISOString();
  const closeToken = crypto.randomUUID();
  const db = getDatabase();
  db.prepare(`WITH cycle AS (
    INSERT INTO monthly_kpi_cycles (client_id, month_key, closed_at, closed_by_user_id, close_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (client_id, month_key) DO UPDATE SET
      closed_at = EXCLUDED.closed_at, closed_by_user_id = EXCLUDED.closed_by_user_id,
      close_token = EXCLUDED.close_token, reopened_at = NULL, reopened_by_user_id = NULL,
      reopen_reason = NULL, updated_at = EXCLUDED.updated_at
    WHERE monthly_kpi_cycles.closed_at IS NULL AND ? = 1
    RETURNING client_id, month_key, closed_at
  ), closed_rows AS (
    UPDATE monthly_kpis m SET closed_at = cycle.closed_at, updated_at = cycle.closed_at
    FROM cycle WHERE m.client_id = cycle.client_id AND m.month_key = cycle.month_key AND m.closed_at IS NULL
    RETURNING m.*
  ), audit_rows AS (
    INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
    SELECT gen_random_uuid()::text, id, client_id, month_key, 'closed', ?, NULL, ?, row_to_json(closed_rows)::text
    FROM closed_rows
  ), next_rows AS (
    INSERT INTO monthly_kpis (id, client_id, department_key, metric_key, month_key, target_value, target_text,
      actual_value, actual_text, status, difference_value, difference_pct, notes, closed_at,
      created_by_user_id, updated_by_user_id, created_at, updated_at)
    SELECT gen_random_uuid()::text, m.client_id, m.department_key, m.metric_key, ?, m.target_value, m.target_text,
      NULL, NULL, 'unknown', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?
    FROM monthly_kpis m JOIN cycle ON m.client_id = cycle.client_id AND m.month_key = cycle.month_key
    ON CONFLICT (client_id, department_key, metric_key, month_key) DO NOTHING
  ) SELECT COUNT(*) FROM cycle`)
    .run(clientId, monthKey, timestamp, actorUserId, closeToken, timestamp, timestamp,
      allowReclose ? 1 : 0, actorUserId, timestamp, nextMonth, timestamp, timestamp);
  return getMonthlyKpiCycleRow(clientId, monthKey)?.close_token === closeToken;
}

export function closeMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string, at = new Date()) {
  if (!getClientById(clientId)) return null;
  if (listMonthlyKpis(clientId, monthKey).length === 0) return null;
  transitionMonthlyKpiCycle(clientId, monthKey, actorUserId, at, true);
  return listMonthlyKpiCycles(clientId).find((cycle) => cycle.monthKey === monthKey) ?? null;
}

export function reopenMonthlyKpiCycle(clientId: string, monthKey: string, actorUserId: string, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) throw new Error('La reapertura requiere un motivo de hasta 500 caracteres');
  const current = getMonthlyKpiCycleRow(clientId, monthKey);
  if (current && !current.closed_at) throw new Error('El ciclo ya está abierto');
  if (!current && !listMonthlyKpis(clientId, monthKey).some((kpi) => kpi.closedAt)) return null;
  const timestamp = nowIso();
  getDatabase().prepare(`WITH cycle AS (
    INSERT INTO monthly_kpi_cycles (client_id, month_key, closed_at, closed_by_user_id, close_token,
      reopened_at, reopened_by_user_id, reopen_reason, created_at, updated_at)
    VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT (client_id, month_key) DO UPDATE SET closed_at = NULL,
      reopened_at = EXCLUDED.reopened_at, reopened_by_user_id = EXCLUDED.reopened_by_user_id,
      reopen_reason = EXCLUDED.reopen_reason, updated_at = EXCLUDED.updated_at
    WHERE monthly_kpi_cycles.closed_at IS NOT NULL
    RETURNING client_id, month_key
  ), opened_rows AS (
    UPDATE monthly_kpis m SET closed_at = NULL, updated_at = ? FROM cycle
    WHERE m.client_id = cycle.client_id AND m.month_key = cycle.month_key AND m.closed_at IS NOT NULL
    RETURNING m.*
  ), audit_rows AS (
    INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
    SELECT gen_random_uuid()::text, id, client_id, month_key, 'reopened', ?, ?, ?, row_to_json(opened_rows)::text
    FROM opened_rows
  ) SELECT COUNT(*) FROM cycle`)
    .run(clientId, monthKey, timestamp, actorUserId, normalizedReason, timestamp, timestamp, timestamp,
      actorUserId, normalizedReason, timestamp);
  return listMonthlyKpiCycles(clientId).find((cycle) => cycle.monthKey === monthKey) ?? null;
}

export function closeDueMonthlyKpiCycles(now = new Date(), onlyClientId?: string) {
  const dueMonth = dueMonthlyKpiMonth(now);
  const db = getDatabase();
  let closed = 0;
  let candidate: { client_id: string; month_key: string } | undefined;
  const findCandidate = () => db.prepare(`SELECT m.client_id, m.month_key FROM monthly_kpis m
    WHERE m.month_key <= ? AND m.month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      AND (? IS NULL OR m.client_id = ?)
      AND NOT EXISTS (SELECT 1 FROM monthly_kpi_cycles c WHERE c.client_id = m.client_id AND c.month_key = m.month_key)
    GROUP BY m.client_id, m.month_key ORDER BY m.month_key ASC, m.client_id ASC LIMIT 1`)
    .get(dueMonth, onlyClientId ?? null, onlyClientId ?? null) as { client_id: string; month_key: string } | undefined;
  // The adapter starts a psql process for each candidate. Bound each scheduler
  // tick so a long historical catch-up does not monopolize the API process.
  for (let processed = 0; processed < 10; processed += 1) {
    candidate = findCandidate();
    if (!candidate) break;
    if (transitionMonthlyKpiCycle(candidate.client_id, candidate.month_key, null, now, false)) closed += 1;
  }
  return { dueMonth, closed, pending: Boolean(findCandidate()) };
}

export function reopenMonthlyKpi(id: string, actorUserId: string, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) throw new Error('La reapertura requiere un motivo de hasta 500 caracteres');
  const db = getDatabase();
  const existing = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  if (!existing) return null;
  if (!existing.closed_at) throw new Error('El KPI ya está abierto');
  const timestamp = nowIso();
  db.prepare(`WITH changed AS (
    UPDATE monthly_kpis SET closed_at = NULL, updated_at = ? WHERE id = ? AND closed_at IS NOT NULL RETURNING *
  ) INSERT INTO monthly_kpi_events (id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json)
    SELECT ?, id, client_id, month_key, 'reopened', ?, ?, ?, row_to_json(changed)::text FROM changed`)
    .run(timestamp, id, crypto.randomUUID(), actorUserId, normalizedReason, timestamp);
  const saved = db.prepare(`SELECT * FROM monthly_kpis WHERE id = ?`).get(id) as any;
  return rowToMonthlyKpi(saved);
}

export function listMonthlyKpiEvents(id: string) {
  return getDatabase().prepare(`SELECT id, kpi_id, client_id, month_key, action, actor_user_id, reason, occurred_at, snapshot_json
    FROM monthly_kpi_events WHERE kpi_id = ? ORDER BY occurred_at DESC, id DESC`).all(id) as Array<Record<string, unknown>>;
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

export function getDashboardHealthSummary(options?: { clientIds?: string[] | null }) {
  const db = getDatabase();
  const scope = options?.clientIds;
  const clientsWhere = scope ? `WHERE id IN ${clientIdsInClause(scope)}` : '';
  const statsWhere = scope ? `WHERE client_id IN ${clientIdsInClause(scope)}` : '';
  const totalUsers = db.prepare(`SELECT COUNT(*) as total FROM users`).get() as { total: number };
  const totalClients = db.prepare(`SELECT COUNT(*) as total FROM clients ${clientsWhere}`).get() as { total: number };
  const totalStats = db.prepare(`SELECT COUNT(*) as total FROM daily_stats ${statsWhere}`).get() as { total: number };
  return {
    users: totalUsers.total,
    clients: totalClients.total,
    dailyStats: totalStats.total,
  };
}

export function listClientsWithLatestStat(options?: { clientIds?: string[] | null }) {
  const clients = listClients(options);
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
