-- daily_stats.stat_date: TEXT -> native DATE.
--
-- The old API stored whatever text it was given, so production may hold non-canonical spellings of the same day
-- ('2024-01-31' and '2024-01-31T00:00:00Z' were two distinct rows) and unparseable values. This migration:
--
--   1. QUARANTINES rows whose stat_date is not a real calendar day written as YYYY-MM-DD, optionally followed by a
--      time part ('2024-01-31T00:00:00Z', '2024-01-31 10:00:00+02'). They are copied verbatim into
--      daily_stats_invalid_dates (no foreign key, never blocks boot) and then removed from daily_stats. Nothing is
--      guessed: ambiguous spellings such as '31/01/2024' vs '01/31/2024' are NOT converted. The owner can review the
--      quarantine table and re-insert corrected rows through the API.
--   2. DELETES DUPLICATE DAYS (DATA LOSS, duplicates only): when several rows of one client map to the same calendar
--      day, only the most recently updated one (updated_at, then created_at, then id) survives; the others are
--      permanently deleted. The day of a timestamp is the one WRITTEN in the text (no time zone conversion).
--   3. Converts the column with ALTER COLUMN ... TYPE DATE. This takes an ACCESS EXCLUSIVE lock and rewrites the
--      table (and rebuilds its indexes), which is fine for the size of this table; the whole migration is one
--      transaction in the runner, so any failure rolls everything back.
--   4. Guarantees UNIQUE (client_id, stat_date) afterwards; ON CONFLICT (client_id, stat_date) depends on it.
--
-- Idempotent: once stat_date is a DATE the conversion block is skipped and only the guarded unique index remains.
-- The counts of quarantined and deleted rows are reported with RAISE WARNING (visible in the deploy log).
DO $migration$
DECLARE
  r RECORD;
  parsed DATE;
  quarantined_rows INTEGER := 0;
  deleted_duplicates INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'daily_stats' AND column_name = 'stat_date' AND data_type = 'text'
  ) THEN
    CREATE TABLE IF NOT EXISTS daily_stats_invalid_dates (
      LIKE daily_stats,
      quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE daily_stats ADD COLUMN stat_date_canonical DATE;

    -- Row by row so one bad value only quarantines itself: the cast is attempted only for text that already looks
    -- like YYYY-MM-DD[ time], and an impossible day ('2024-02-30') or year 0000 is caught and left NULL.
    FOR r IN SELECT id, stat_date FROM daily_stats LOOP
      parsed := NULL;
      IF btrim(r.stat_date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9:.,+Zz -]*)?$' THEN
        BEGIN
          parsed := substr(btrim(r.stat_date), 1, 10)::date;
        EXCEPTION WHEN OTHERS THEN
          parsed := NULL;
        END;
      END IF;
      UPDATE daily_stats SET stat_date_canonical = parsed WHERE id = r.id;
    END LOOP;

    -- Copy first, delete second, in the same transaction.
    INSERT INTO daily_stats_invalid_dates (
      id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
    )
    SELECT id, client_id, stat_date, revenue, roas, clicks, conversions, cpa, leads, traffic, notes, source, created_at, updated_at
    FROM daily_stats
    WHERE stat_date_canonical IS NULL;
    GET DIAGNOSTICS quarantined_rows = ROW_COUNT;

    DELETE FROM daily_stats WHERE stat_date_canonical IS NULL;

    DELETE FROM daily_stats d
    USING (
      SELECT id,
             row_number() OVER (
               PARTITION BY client_id, stat_date_canonical
               ORDER BY updated_at COLLATE "C" DESC, created_at COLLATE "C" DESC, id COLLATE "C" DESC
             ) AS day_rank
      FROM daily_stats
    ) ranked
    WHERE d.id = ranked.id AND ranked.day_rank > 1;
    GET DIAGNOSTICS deleted_duplicates = ROW_COUNT;

    ALTER TABLE daily_stats ALTER COLUMN stat_date TYPE DATE USING stat_date_canonical;
    ALTER TABLE daily_stats DROP COLUMN stat_date_canonical;

    IF quarantined_rows > 0 THEN
      RAISE WARNING 'daily_stats: % row(s) with an invalid stat_date moved to daily_stats_invalid_dates', quarantined_rows;
    END IF;
    IF deleted_duplicates > 0 THEN
      RAISE WARNING 'daily_stats: % duplicate row(s) of an already stored client/day deleted (latest update kept)', deleted_duplicates;
    END IF;
  END IF;
END
$migration$;

-- ALTER COLUMN TYPE keeps the original UNIQUE(client_id, stat_date) constraint (and its index, rebuilt over the DATE
-- column). This is a no-op when it exists, because the constraint's index owns the same name.
CREATE UNIQUE INDEX IF NOT EXISTS daily_stats_client_id_stat_date_key ON daily_stats (client_id, stat_date);
