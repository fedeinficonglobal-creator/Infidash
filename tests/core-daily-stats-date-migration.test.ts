import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMigrations, isCoreMigration, orderMigrations } from '../src/server/content/migrations.js';

// DB-less guards for db/migrations/0006_core_daily_stats_date.sql. Its behavior on real data is covered by the
// disposable-database suite (tests/core-baseline-migration.db.test.ts); here we pin the file and its safety shape.

const MIGRATION = '0006_core_daily_stats_date.sql';
const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');

// sha256 of the migration with LF line endings. The runner refuses to boot when an applied migration changes, so any
// edit after release must be a new migration; update this pin only while the file is still unreleased.
const MIGRATION_SHA256 = '51381c7cf9c5cf6b3c5ca0edd92646ecb22030347a7d7f4a91997bee44e43eb2';

const read = async () => readFile(path.join(migrationsDirectory, MIGRATION), 'utf8');

test('0006 is a core migration that runs after the baseline and is checksum-stable', async () => {
  const versions = await discoverMigrations(migrationsDirectory);
  assert.ok(isCoreMigration(MIGRATION));
  const ordered = orderMigrations(versions);
  assert.ok(ordered.indexOf(MIGRATION) > ordered.indexOf('0004_core_baseline.sql'));
  assert.ok(ordered.indexOf(MIGRATION) > ordered.indexOf('0005_core_drop_ai_insights.sql'));
  const sql = await read();
  assert.ok(!sql.includes('\r'), 'migrations must be LF');
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), MIGRATION_SHA256);
});

test('0006 is guarded, quarantines before deleting, dedupes per client and day, and keeps the unique key', async () => {
  const sql = await read();
  const at = (fragment: string | RegExp) => {
    const index = typeof fragment === 'string' ? sql.indexOf(fragment) : sql.search(fragment);
    assert.ok(index >= 0, `missing: ${fragment}`);
    return index;
  };

  // Conversion only runs while the column is still TEXT, so a rerun is a no-op.
  assert.match(sql, /table_name = 'daily_stats' AND column_name = 'stat_date' AND data_type = 'text'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_stats_invalid_dates/);

  // Invalid rows are copied to the quarantine table BEFORE they are deleted, and duplicates keep the latest update.
  assert.ok(at('INSERT INTO daily_stats_invalid_dates') < at('DELETE FROM daily_stats WHERE stat_date_canonical IS NULL'));
  assert.match(sql, /PARTITION BY client_id, stat_date_canonical\s+ORDER BY updated_at COLLATE "C" DESC/);
  assert.match(sql, /ranked\.day_rank > 1/);
  assert.ok(at('DELETE FROM daily_stats WHERE stat_date_canonical IS NULL') < at('PARTITION BY'));

  // Dedupe happens before the type change (which would fail on duplicate days) and the helper column is dropped.
  assert.ok(at('PARTITION BY') < at('ALTER COLUMN stat_date TYPE DATE USING stat_date_canonical'));
  assert.ok(at('ALTER COLUMN stat_date TYPE DATE') < at('DROP COLUMN stat_date_canonical'));

  // Unparseable text is caught per row instead of aborting the deploy.
  assert.match(sql, /EXCEPTION WHEN OTHERS THEN\s+parsed := NULL;/);

  // The unique key survives the rewrite; the trailing statement guarantees it exists when the block was skipped.
  assert.match(sql.trimEnd(), /CREATE UNIQUE INDEX IF NOT EXISTS daily_stats_client_id_stat_date_key ON daily_stats \(client_id, stat_date\);$/);

  // Data loss is announced loudly.
  assert.match(sql, /RAISE WARNING 'daily_stats: % row\(s\) with an invalid stat_date/);
  assert.match(sql, /DATA LOSS, duplicates only/);
});
