import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entries = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

test('client operations data and raw n8n exports are ignored by git, not only by a local exclude', () => {
  const ignored = entries('.gitignore');
  for (const pattern of ['docs/*.csv', 'docs/Blog *.json', 'docs/Plan de Contenidos *.json', 'n8n-import/']) {
    assert.ok(ignored.includes(pattern), `.gitignore must list ${pattern}`);
  }
});

test('the Docker build context leaves out documentation, local imports, tests and tooling folders', () => {
  const ignored = entries('.dockerignore');
  for (const entry of ['docs', 'n8n-import', 'tests', '.atl', '.claude', '.github']) {
    assert.ok(ignored.includes(entry), `.dockerignore must list ${entry}`);
  }
});

test('no client data file or raw n8n export is tracked by git', () => {
  const tracked = execFileSync('git', ['ls-files', 'docs', 'n8n-import'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const offenders = tracked.filter((file) => /\.csv$/i.test(file) || /(^|\/)(Blog |Plan de Contenidos )[^/]*\.json$/.test(file));
  assert.deepEqual(offenders, []);
});
