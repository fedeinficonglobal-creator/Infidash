import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),
  orgId: text('org_id').references(() => organizations.id),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  industry: text('industry'),
  healthScore: integer('health_score').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey(),
  clientId: text('client_id').references(() => clients.id),
  type: text('type').notNull(),
  credentialsJson: text('credentials_json').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastSync: text('last_sync'),
});

export const dailyStats = sqliteTable('daily_stats', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  statDate: text('stat_date').notNull(),
  revenue: real('revenue').notNull().default(0),
  roas: real('roas').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
  cpa: real('cpa').notNull().default(0),
  leads: integer('leads').notNull().default(0),
  traffic: integer('traffic').notNull().default(0),
  notes: text('notes'),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const aiInsights = sqliteTable('ai_insights', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  insightJson: text('insight_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'viewer'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});
