CREATE SCHEMA IF NOT EXISTS editorial;

CREATE TABLE editorial.client_settings (
  client_id TEXT PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  language TEXT NOT NULL DEFAULT 'es',
  editorial_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  workflow_bindings JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE editorial.calendars (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  summary TEXT,
  insights JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE editorial.plan_items (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL,
  title TEXT NOT NULL,
  theme TEXT,
  rationale TEXT,
  format TEXT,
  keyword_primary TEXT,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(keywords) = 'array'),
  entities JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entities) = 'array'),
  cta TEXT,
  priority TEXT,
  planned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'generating', 'review', 'ready', 'generation_failed', 'archived')),
  source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, calendar_id, source_key),
  FOREIGN KEY (client_id, calendar_id) REFERENCES editorial.calendars(client_id, id) ON DELETE CASCADE
);

CREATE TABLE editorial.contents (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_item_id UUID,
  title TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  excerpt TEXT,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'archived')),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, plan_item_id),
  FOREIGN KEY (client_id, plan_item_id) REFERENCES editorial.plan_items(client_id, id) ON DELETE RESTRICT
);

CREATE TABLE editorial.content_revisions (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  content_id UUID NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  content_snapshot JSONB NOT NULL,
  prompt_version TEXT,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  author_type TEXT NOT NULL CHECK (author_type IN ('ai', 'user', 'import', 'system')),
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, content_id, id),
  UNIQUE (content_id, revision_number),
  FOREIGN KEY (client_id, content_id) REFERENCES editorial.contents(client_id, id) ON DELETE CASCADE
);

CREATE TABLE editorial.publishing_accounts (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('wordpress', 'postiz')),
  instance_key TEXT NOT NULL,
  external_account_id TEXT,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  rrss_channel_id TEXT REFERENCES public.rrss_channels(id) ON DELETE SET NULL,
  integration_id TEXT REFERENCES public.integrations(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, provider, instance_key, platform, external_account_id)
);

CREATE TABLE editorial.publications (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  content_id UUID NOT NULL,
  account_id UUID NOT NULL,
  occurrence_key TEXT NOT NULL DEFAULT 'primary',
  content_revision_id UUID,
  copy TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'scheduled', 'published', 'failed', 'unknown', 'cancel_requested', 'cancelled', 'draft')),
  desired_scheduled_at TIMESTAMPTZ,
  confirmed_scheduled_at TIMESTAMPTZ,
  postiz_post_id TEXT,
  provider_post_id TEXT,
  external_url TEXT,
  published_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (content_id, account_id, occurrence_key),
  FOREIGN KEY (client_id, content_id) REFERENCES editorial.contents(client_id, id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, account_id) REFERENCES editorial.publishing_accounts(client_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, content_id, content_revision_id)
    REFERENCES editorial.content_revisions(client_id, content_id, id) ON DELETE RESTRICT
);

CREATE TABLE editorial.jobs (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('generate_plan', 'generate_content', 'publish', 'reschedule', 'cancel', 'reconcile')),
  target_id UUID,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  execution_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE editorial.events (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  event_type TEXT NOT NULL,
  source_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX events_source_event_unique
  ON editorial.events (client_id, entity_type, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE editorial.legacy_mappings (
  source_system TEXT NOT NULL,
  source_entity TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id UUID NOT NULL,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_hash TEXT NOT NULL,
  PRIMARY KEY (source_system, source_entity, source_id, client_id)
);

CREATE TABLE editorial.research_snapshots (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  fetched_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'partial', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE INDEX plan_items_client_planned_at_idx ON editorial.plan_items (client_id, planned_at);
CREATE INDEX publications_client_status_schedule_idx ON editorial.publications (client_id, status, desired_scheduled_at);
CREATE INDEX jobs_ready_idx ON editorial.jobs (status, next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX contents_client_status_idx ON editorial.contents (client_id, status, updated_at DESC);
CREATE INDEX research_snapshots_client_period_idx ON editorial.research_snapshots (client_id, period_start, period_end);

CREATE UNIQUE INDEX publications_wordpress_external_id_unique
  ON editorial.publications (account_id, provider_post_id)
  WHERE provider_post_id IS NOT NULL;

CREATE UNIQUE INDEX publications_postiz_external_id_unique
  ON editorial.publications (account_id, postiz_post_id)
  WHERE postiz_post_id IS NOT NULL;
