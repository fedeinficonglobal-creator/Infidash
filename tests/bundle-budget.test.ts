import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// Guards the initial JavaScript payload (entry + modulepreloaded chunks) of a production build.
// Skips when `npm run build` has not produced dist/ yet.
const distDirectory = resolve(process.cwd(), 'dist');
const indexPath = resolve(distDirectory, 'index.html');
const BUDGET_BYTES = 400 * 1024;

test('initial bundle stays within budget and excludes heavy lazy chunks', { skip: existsSync(indexPath) ? false : 'dist/ not built; run `npm run build` first' }, () => {
  const html = readFileSync(indexPath, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map((match) => match[1]);
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*\shref="([^"]+\.js)"/g)].map((match) => match[1]);
  const initial = [...new Set([...scripts, ...preloads])];

  assert.ok(scripts.length > 0, 'index.html must reference an entry script');

  let total = 0;
  for (const asset of initial) {
    assert.doesNotMatch(asset, /charts|UsersAdmin/i, `${asset} must not be loaded eagerly`);
    total += statSync(resolve(distDirectory, asset.replace(/^\//, ''))).size;
  }

  assert.ok(total < BUDGET_BYTES, `initial JS is ${(total / 1024).toFixed(1)} KB, budget is ${BUDGET_BYTES / 1024} KB`);
});
