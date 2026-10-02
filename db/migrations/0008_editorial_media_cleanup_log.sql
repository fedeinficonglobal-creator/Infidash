-- Audit log of the Postiz media cleanup (scripts/postiz-media-cleanup.ts). One row per deleted file so the owner can
-- see what was removed. It is informational only: posts and publications are never modified by the cleanup.

CREATE TABLE IF NOT EXISTS editorial.media_cleanup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  reason TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_cleanup_log_url_idx ON editorial.media_cleanup_log (url);
CREATE INDEX IF NOT EXISTS media_cleanup_log_deleted_at_idx ON editorial.media_cleanup_log (deleted_at DESC);
