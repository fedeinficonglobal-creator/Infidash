import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMigrations, isCoreMigration, orderMigrations } from '../src/server/content/migrations.js';

// DB-less guards for db/migrations/0007_core_timestamptz_sessions_leads.sql. Its behavior on real data is covered by
// the disposable-database suite (tests/core-baseline-migration.db.test.ts); here we pin the file and its safety shape.

const MIGRATION = '0007_core_timestamptz_sessions_leads.sql';
const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');

// sha256 of the migration with LF line endings. The runner refuses to boot when an applied migration changes, so any
// edit after release must be a new migration; update this pin only while the file is still unreleased.
const MIGRATION_SHA256 = '129926ccaf4d561d4eedd519d2318c2ea3b5bcc344f83802ca0716dcfe927bc2';

const read = async () => readFile(path.join(migrationsDirectory, MIGRATION), 'utf8');

test('0007 is a core migration that runs after 0006 and is checksum-stable', async () => {
  const versions = await discoverMigrations(migrationsDirectory);
  assert.ok(isCoreMigration(MIGRATION));
  const ordered = orderMigrations(versions);
  assert.ok(ordered.indexOf(MIGRATION) > ordered.indexOf('0006_core_daily_stats_date.sql'));
  const sql = await read();
  assert.ok(!sql.includes('\r'), 'migrations must be LF');
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), MIGRATION_SHA256);
});

test('0007 is guarded, parses defensively, never deletes leads and indexes the session expiry', async () => {
  const sql = await read();
  const at = (fragment: string | RegExp) => {
    const index = typeof fragment === 'string' ? sql.indexOf(fragment) : sql.search(fragment);
    assert.ok(index >= 0, `missing: ${fragment}`);
    return index;
  };

  // Each conversion only runs while its column is still TEXT, so a rerun is a no-op.
  assert.match(sql, /table_name = 'sessions' AND column_name = 'expires_at' AND data_type = 'text'/);
  assert.match(sql, /table_name = 'leads' AND column_name = 'received_at' AND data_type = 'text'/);

  // Unparseable text is caught per row (session expiry, lead date, lead created_at fallback) instead of aborting.
  assert.equal((sql.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length, 3);

  // The only DELETE is the one for unparseable SESSIONS, and it runs before the type change.
  const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--'));
  assert.equal(statements.filter((line) => line.includes('DELETE FROM')).length, 1);
  assert.ok(at('DELETE FROM sessions WHERE expires_at_ts IS NULL') < at('ALTER TABLE sessions ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at_ts'));

  // Leads keep their rows: the original text is recorded before the conversion, then the helper column is dropped.
  assert.ok(at('INSERT INTO leads_received_at_fallbacks') < at('ALTER TABLE leads ALTER COLUMN received_at TYPE TIMESTAMPTZ USING received_at_ts'));
  assert.match(sql, /parsed := COALESCE\(fallback, now\(\)\)/);
  assert.ok(at('USING received_at_ts') < at('DROP COLUMN received_at_ts'));
  assert.ok(at('USING expires_at_ts') < at('DROP COLUMN expires_at_ts'));

  // The listing index and the purge index exist afterwards (the trailing statements cover the skipped-block case).
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_leads_client_received_id ON leads \(client_id, received_at DESC, id DESC\);/);
  assert.match(sql.trimEnd(), /CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions \(expires_at\);$/);

  // Data loss and fallbacks are announced loudly.
  assert.match(sql, /RAISE WARNING 'sessions: % session\(s\) with an unparseable expires_at deleted'/);
  assert.match(sql, /RAISE WARNING 'leads: % lead\(s\) with an unparseable received_at/);
  assert.match(sql, /DATA LOSS, unreadable sessions only/);
});
