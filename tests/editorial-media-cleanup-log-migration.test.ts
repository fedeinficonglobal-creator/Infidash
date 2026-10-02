import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMigrations, isCoreMigration, orderMigrations } from '../src/server/content/migrations.js';

// DB-less guards for db/migrations/0008_editorial_media_cleanup_log.sql (audit log of the Postiz media cleanup).

const MIGRATION = '0008_editorial_media_cleanup_log.sql';
const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');

// sha256 of the migration with LF line endings. Update this pin only while the file is still unreleased.
const MIGRATION_SHA256 = 'a76064ed9c67933fb320b8464a2412be652362eaeaa4322671bc90d6a29d9bab';

const read = async () => readFile(path.join(migrationsDirectory, MIGRATION), 'utf8');

test('0008 is an editorial (non-core) migration, ordered last and checksum-stable', async () => {
  const versions = await discoverMigrations(migrationsDirectory);
  assert.ok(!isCoreMigration(MIGRATION));
  const ordered = orderMigrations(versions);
  assert.equal(ordered[ordered.length - 1], MIGRATION);
  const sql = await read();
  assert.ok(!sql.includes('\r'), 'migrations must be LF');
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), MIGRATION_SHA256);
});

test('0008 is idempotent, has the documented columns and never touches posts', async () => {
  const sql = await read();
  const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  assert.match(statements, /CREATE TABLE IF NOT EXISTS editorial\.media_cleanup_log/);
  assert.match(statements, /id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
  assert.match(statements, /url TEXT NOT NULL/);
  assert.match(statements, /file_name TEXT NOT NULL/);
  assert.match(statements, /bytes BIGINT NOT NULL/);
  assert.match(statements, /reason TEXT NOT NULL/);
  assert.match(statements, /deleted_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.equal((statements.match(/CREATE INDEX/g) ?? []).length, (statements.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length);
  assert.doesNotMatch(statements, /\b(DROP|DELETE|UPDATE|ALTER)\b/i);
  assert.doesNotMatch(statements, /social_posts|publications/);
});
