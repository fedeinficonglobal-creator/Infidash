CREATE TABLE editorial.service_tokens (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes) = 'array'),
  allowed_client_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_client_ids) = 'array'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE editorial.contents
  ADD COLUMN approved_revision_id UUID;

ALTER TABLE editorial.jobs
  ADD COLUMN result_hash TEXT;

ALTER TABLE editorial.contents
  ADD CONSTRAINT contents_approved_revision_fk
  FOREIGN KEY (client_id, id, approved_revision_id)
  REFERENCES editorial.content_revisions(client_id, content_id, id)
  ON DELETE RESTRICT;

CREATE INDEX service_tokens_active_hash_idx
  ON editorial.service_tokens (token_hash)
  WHERE active = TRUE;

CREATE INDEX events_entity_timeline_idx
  ON editorial.events (client_id, entity_type, entity_id, occurred_at DESC);
