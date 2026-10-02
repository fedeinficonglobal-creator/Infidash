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

test('spreadsheet exports are ignored anywhere in the repository and none is tracked', () => {
  const ignored = entries('.gitignore');
  for (const pattern of ['*.csv', '*.tsv', '*.xls', '*.xlsx']) {
    assert.ok(ignored.includes(pattern), `.gitignore must list ${pattern}`);
  }
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(tracked.filter((file) => /\.(csv|tsv|xlsx?)$/i.test(file)), []);
});

test('no tracked text file contains a well-known API key or token', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const skip = /(^package-lock\.json$|\.(png|jpe?g|gif|ico|woff2?|pdf|zip|gz)$)/i;
  const patterns: Array<[string, RegExp]> = [
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['OpenAI-style secret key', /\bsk-[A-Za-z0-9_-]{32,}/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
    ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    // A real key has a long base64 body right after the header (the GA4 test fixture uses a short fake one).
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----(?:\n|s)*[A-Za-z0-9+/=]{40,}/],
  ];
  const findings: string[] = [];
  for (const file of tracked) {
    if (skip.test(file)) continue;
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) findings.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('the product metadata no longer advertises the removed Gemini integration', () => {
  assert.doesNotMatch(readFileSync('metadata.json', 'utf8'), /gemini/i);
});
