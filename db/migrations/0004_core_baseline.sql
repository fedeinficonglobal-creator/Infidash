-- Core (public schema) baseline, frozen from the DDL that src/lib/database.ts used to run at boot
-- (initializeSchema + ensure*Schema). Every statement is guarded so this file is a strict no-op on a database
-- that already has the core schema and builds the full schema on an empty one. Statement text was moved verbatim:
-- later migrations change types, this one must not. Data seeds, the client_memberships backfill and the
-- integrations row normalization stay in code (src/lib/database.ts); they are data work, not schema.

-- 1. initializeSchema
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

CREATE TABLE IF NOT EXISTS ga4_snapshots (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  sessions_json JSONB NOT NULL,
  traffic_sources_json JSONB NOT NULL,
  top_pages_json JSONB NOT NULL,
  landing_pages_json JSONB NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (integration_id, property_id, period_from, period_to),
  CHECK (period_from <= period_to)
);

CREATE TABLE IF NOT EXISTS google_ads_snapshots (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  campaigns_json JSONB NOT NULL,
  currency_code TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (integration_id, customer_id, period_from, period_to),
  CHECK (period_from <= period_to)
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

CREATE TABLE IF NOT EXISTS operational_plans (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('web', 'rrss')),
  period_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  rows_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id, domain, period_key)
);

CREATE TABLE IF NOT EXISTS report_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  pdf_base64 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  last_sent_at TEXT,
  last_sent_to TEXT,
  last_send_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_runs_client_generated ON report_runs(client_id, generated_at DESC);

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

-- 2. ensureClientThresholdSchema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'clients' AND column_name = 'kpi_thresholds_json'
  ) THEN
    ALTER TABLE clients ADD COLUMN kpi_thresholds_json TEXT NOT NULL DEFAULT '{}';
  END IF;
END
$$;

-- 3. ensureIntegrationSchema (legacy tables created before these columns existed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'provider'
  ) THEN
    ALTER TABLE integrations ADD COLUMN provider TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'label'
  ) THEN
    ALTER TABLE integrations ADD COLUMN label TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'status'
  ) THEN
    ALTER TABLE integrations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'config_json'
  ) THEN
    ALTER TABLE integrations ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'credentials_json'
  ) THEN
    ALTER TABLE integrations ADD COLUMN credentials_json TEXT NOT NULL DEFAULT '{}';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE integrations ADD COLUMN last_error TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE integrations ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE integrations ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE integrations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'last_sync'
  ) THEN
    ALTER TABLE integrations ADD COLUMN last_sync TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'integrations' AND column_name = 'webhook_secret'
  ) THEN
    ALTER TABLE integrations ADD COLUMN webhook_secret TEXT;
  END IF;
END
$$;

-- 4. ensureLeadSchema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'leads' AND column_name = 'dedupe_key'
  ) THEN
    ALTER TABLE leads ADD COLUMN dedupe_key TEXT;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_integration_delivery ON leads (integration_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 5. ensureUxSnapshotSchema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'snapshot_date'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN snapshot_date TEXT NOT NULL DEFAULT '';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'sessions'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN sessions INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'page_views'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN page_views INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'rage_clicks'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN rage_clicks INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'dead_clicks'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN dead_clicks INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'scroll_depth_avg'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN scroll_depth_avg REAL NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'engaged_sessions'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN engaged_sessions INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'conversions'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN conversions INTEGER NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'conversion_rate'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN conversion_rate REAL NOT NULL DEFAULT 0;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'notes'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN notes TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'source'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'clarity';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'payload_json'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'ux_snapshots' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE ux_snapshots ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  END IF;
END
$$;
