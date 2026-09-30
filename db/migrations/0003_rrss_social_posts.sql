-- Social media (RRSS) pipeline: RRSS calendars and ideas live beside blog ones,
-- and each generated post draft is one row per (idea, Postiz account).

ALTER TABLE editorial.calendars
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'blog' CHECK (kind IN ('blog', 'rrss'));

ALTER TABLE editorial.plan_items
  ADD COLUMN networks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(networks) = 'array');

-- 0001 declared the kinds CHECK inline, so PostgreSQL named it jobs_kind_check.
ALTER TABLE editorial.jobs
  DROP CONSTRAINT IF EXISTS jobs_kind_check;

ALTER TABLE editorial.jobs
  ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('generate_plan', 'generate_content', 'publish', 'reschedule', 'cancel', 'reconcile', 'generate_rrss_plan', 'generate_rrss'));

CREATE TABLE editorial.social_posts (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_item_id UUID NOT NULL,
  account_id UUID NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('gmb', 'facebook', 'instagram', 'other')),
  copy TEXT NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array'),
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'approved', 'scheduled', 'discarded')),
  -- A composite (client_id, publication_id) FK cannot use ON DELETE SET NULL without also nulling
  -- client_id (column lists need PostgreSQL 15+), so this references the publication id alone.
  publication_id UUID REFERENCES editorial.publications(id) ON DELETE SET NULL,
  generation_job_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id),
  UNIQUE (client_id, plan_item_id, account_id),
  FOREIGN KEY (client_id, plan_item_id) REFERENCES editorial.plan_items(client_id, id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, account_id) REFERENCES editorial.publishing_accounts(client_id, id) ON DELETE RESTRICT
);

CREATE INDEX social_posts_client_plan_item_idx ON editorial.social_posts (client_id, plan_item_id);
CREATE INDEX social_posts_client_status_idx ON editorial.social_posts (client_id, status);
CREATE INDEX calendars_client_kind_idx ON editorial.calendars (client_id, kind);
