import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('test runner defaults to explicit unit files and classifies every suite', () => {
  const result = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--list'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout);
  assert.ok(files.includes('tests/test-runner.test.ts'));
  assert.ok(files.includes('tests/content-persistence.test.ts'));
  assert.ok(!files.includes('tests/monthly-model.test.ts'));
  assert.ok(!files.includes('tests/api-regression.test.ts'));
  assert.ok(!files.includes('tests/client-memberships.test.ts'));
  assert.ok(files.every((file: string) => !file.includes('*')));
  const all = [...files, 'tests/monthly-model.test.ts', 'tests/api-regression.test.ts', 'tests/client-memberships.test.ts'].sort();
  assert.deepEqual(all, readdirSync('tests').filter(file => file.endsWith('.test.ts')).map(file => `tests/${file}`).sort());
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(scripts.test, 'node scripts/run-tests.mjs');
  assert.equal(scripts['test:unit'], 'node scripts/run-tests.mjs unit');
  assert.equal(scripts['test:db'], 'node scripts/run-tests.mjs db');
  assert.equal(scripts['test:api'], 'node scripts/run-tests.mjs api');
});

test('unsafe suites have a guard before side-effectful imports or requests', () => {
  for (const file of ['monthly-model', 'api-regression', 'client-memberships']) {
    const source = readFileSync(`tests/${file}.test.ts`, 'utf8');
    assert.match(source, /^import '\.\/helpers\/isolated-harness-required\.js';/);
    if (file === 'monthly-model') {
      assert.doesNotMatch(source, /from ['"]\.\.\/src\/lib\/database\.js/);
      assert.match(source, /await import\('\.\.\/src\/lib\/database\.js'\)/);
    }
  }
});
