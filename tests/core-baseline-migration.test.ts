import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMigrations, isCoreMigration, orderMigrations } from '../src/server/content/migrations.js';

const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations');
const BASELINE = '0004_core_baseline.sql';

// sha256 of the baseline with LF line endings. The runner refuses to boot when an applied migration changes, so any
// edit to this file must be a new migration instead; update this pin only while the file is still unreleased.
const BASELINE_SHA256 = '9c435141087e63bc5335babc49383a19f8fa16a6a63f8c2496708867693d075c';

async function readBaseline() {
  return (await readFile(path.join(migrationsDirectory, BASELINE), 'utf8')).replace(/\r\n/g, '\n');
}

function splitDoBlocks(sql: string) {
  const blocks: string[] = [];
  const rest = sql.replace(/DO \$\$\n([\s\S]*?)\n\$\$;/g, (_match, body: string) => {
    blocks.push(body);
    return '';
  });
  return { blocks, rest };
}

test('core baseline is a core migration and runs before the editorial ones', async () => {
  const versions = await discoverMigrations(migrationsDirectory);
  assert.ok(versions.includes(BASELINE));
  assert.ok(isCoreMigration(BASELINE));
  assert.ok(!isCoreMigration('0001_editorial_schema.sql'));
  assert.equal(orderMigrations(versions)[0], BASELINE);
  assert.deepEqual(orderMigrations(['0001_a.sql', '0002_core_b.sql', '0003_c.sql', '0004_core_d.sql']), ['0002_core_b.sql', '0004_core_d.sql', '0001_a.sql', '0003_c.sql']);
});

test('core baseline checksum is stable', async () => {
  const sql = await readBaseline();
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), BASELINE_SHA256);
});

test('every statement of the core baseline is idempotent', async () => {
  const sql = await readBaseline();
  const { blocks, rest } = splitDoBlocks(sql);

  // Outside DO blocks only guarded CREATE statements are allowed.
  const statements = rest.split(/;\s*(?:\n|$)/).map((statement) => statement.replace(/^(\s*--.*\n)+/g, '').trim()).filter(Boolean);
  assert.ok(statements.length > 20);
  for (const statement of statements) {
    assert.match(statement, /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS \w+/, statement.slice(0, 80));
  }
  assert.doesNotMatch(sql, /CREATE (?:UNIQUE )?(?:TABLE|INDEX)(?! IF NOT EXISTS)/);

  // Every ADD COLUMN lives in a DO block guarded by an information_schema check on the very same table and column.
  assert.equal((sql.match(/ADD COLUMN/g) ?? []).length, blocks.length);
  assert.ok(blocks.length >= 25);
  for (const block of blocks) {
    const guard = block.match(/table_name = '(\w+)' AND column_name = '(\w+)'/);
    assert.ok(guard, block);
    assert.match(block, /IF NOT EXISTS \(\n\s*SELECT 1 FROM information_schema\.columns/);
    assert.match(block, new RegExp(`ALTER TABLE ${guard[1]} ADD COLUMN ${guard[2]} `));
  }
});
