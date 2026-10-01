-- sessions.expires_at and leads.received_at: TEXT (ISO-8601 written with toISOString()) -> native TIMESTAMPTZ.
--
-- Both columns always held fixed-width UTC strings ('2024-01-31T10:00:00.000Z'), but nothing enforced it, so
-- production may contain other spellings or unparseable text. This migration:
--
--   1. Parses every value row by row. Only text that looks like YYYY-MM-DD[ or T followed by a time] is cast, and a
--      cast failure (impossible day, year 0000, malformed time) is caught per row instead of aborting the deploy.
--      Special inputs such as 'now', 'epoch' or 'infinity' never reach the cast. Text without an explicit offset is
--      read in the session time zone of the migration connection.
--   2. sessions: DELETES (DATA LOSS, unreadable sessions only) the rows whose expires_at cannot be parsed. A session
--      with an unreadable expiry can never be proven valid, and its owner simply signs in again.
--   3. leads: NEVER deletes. A lead whose received_at cannot be parsed falls back to its created_at when that parses,
--      otherwise to now(). The original text is preserved verbatim, together with the value that replaced it, in
--      leads_received_at_fallbacks (no foreign key, never blocks boot) so the owner can review and correct it.
--   4. Converts both columns with ALTER COLUMN ... TYPE TIMESTAMPTZ USING <parsed helper column>. Each ALTER takes an
--      ACCESS EXCLUSIVE lock and rewrites the table and its indexes (including idx_leads_client_received_id, which is
--      rebuilt over the new type keeping its (client_id, received_at DESC, id DESC) definition); both tables are
--      small, and the whole migration is one transaction in the runner, so any failure rolls everything back.
--   5. Adds idx_sessions_expires_at, which supports the hourly purge (DELETE ... WHERE expires_at <= now).
--
-- Idempotent: each conversion is guarded on the column still being TEXT, so a rerun only keeps the indexes.
-- The number of deleted sessions and of lead fallbacks is reported with RAISE WARNING (visible in the deploy log).
DO $migration$
DECLARE
  r RECORD;
  parsed TIMESTAMPTZ;
  fallback TIMESTAMPTZ;
  deleted_sessions INTEGER := 0;
  fallback_leads INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'sessions' AND column_name = 'expires_at' AND data_type = 'text'
  ) THEN
    ALTER TABLE sessions ADD COLUMN expires_at_ts TIMESTAMPTZ;

    FOR r IN SELECT id, expires_at FROM sessions LOOP
      parsed := NULL;
      IF btrim(r.expires_at) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ].*)?$' THEN
        BEGIN
          parsed := btrim(r.expires_at)::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          parsed := NULL;
        END;
      END IF;
      UPDATE sessions SET expires_at_ts = parsed WHERE id = r.id;
    END LOOP;

    DELETE FROM sessions WHERE expires_at_ts IS NULL;
    GET DIAGNOSTICS deleted_sessions = ROW_COUNT;

    ALTER TABLE sessions ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at_ts;
    ALTER TABLE sessions DROP COLUMN expires_at_ts;

    IF deleted_sessions > 0 THEN
      RAISE WARNING 'sessions: % session(s) with an unparseable expires_at deleted', deleted_sessions;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'leads' AND column_name = 'received_at' AND data_type = 'text'
  ) THEN
    CREATE TABLE IF NOT EXISTS leads_received_at_fallbacks (
      lead_id TEXT PRIMARY KEY,
      original_received_at TEXT NOT NULL,
      replacement_received_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE leads ADD COLUMN received_at_ts TIMESTAMPTZ;

    FOR r IN SELECT id, received_at, created_at FROM leads LOOP
      parsed := NULL;
      IF btrim(r.received_at) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ].*)?$' THEN
        BEGIN
          parsed := btrim(r.received_at)::timestamptz;
        EXCEPTION WHEN OTHERS THEN
          parsed := NULL;
        END;
      END IF;

      IF parsed IS NULL THEN
        fallback := NULL;
        IF btrim(r.created_at) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ].*)?$' THEN
          BEGIN
            fallback := btrim(r.created_at)::timestamptz;
          EXCEPTION WHEN OTHERS THEN
            fallback := NULL;
          END;
        END IF;
        parsed := COALESCE(fallback, now());

        INSERT INTO leads_received_at_fallbacks (lead_id, original_received_at, replacement_received_at)
        VALUES (r.id, r.received_at, parsed)
        ON CONFLICT (lead_id) DO NOTHING;
        fallback_leads := fallback_leads + 1;
      END IF;

      UPDATE leads SET received_at_ts = parsed WHERE id = r.id;
    END LOOP;

    ALTER TABLE leads ALTER COLUMN received_at TYPE TIMESTAMPTZ USING received_at_ts;
    ALTER TABLE leads DROP COLUMN received_at_ts;

    IF fallback_leads > 0 THEN
      RAISE WARNING 'leads: % lead(s) with an unparseable received_at kept with a fallback date (originals in leads_received_at_fallbacks)', fallback_leads;
    END IF;
  END IF;
END
$migration$;

-- ALTER COLUMN TYPE already rebuilds the leads index over the TIMESTAMPTZ column; this is a no-op when it exists.
CREATE INDEX IF NOT EXISTS idx_leads_client_received_id ON leads (client_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
