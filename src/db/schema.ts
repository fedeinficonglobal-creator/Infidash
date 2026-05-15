import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  industry: text('industry'),
  healthScore: integer('health_score').default(0),
  healthData: jsonb('health_data'), // Breakdowns
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => clients.id),
  type: text('type').notNull(), // 'woocommerce', 'google_ads', 'meta_ads', etc.
  credentials: jsonb('credentials').notNull(),
  isActive: boolean('is_active').default(true),
  lastSync: timestamp('last_sync'),
});

export const metricsSnapshots = pgTable('metrics_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => clients.id),
  periodDate: timestamp('period_date').notNull(),
  source: text('source').notNull(),
  metrics: jsonb('metrics').notNull(), // { revenue, roas, clicks, etc. }
  createdAt: timestamp('created_at').defaultNow(),
});

export const aiInsights = pgTable('ai_insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => clients.id),
  insightJson: jsonb('insight_json').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
