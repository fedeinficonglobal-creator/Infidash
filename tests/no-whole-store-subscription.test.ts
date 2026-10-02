import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

// A bare `useXStore()` subscribes to the whole store and re-renders on every update (no allowlist: none needs it).
test('components never subscribe to a whole Zustand store', () => {
  const offenders = walk(join(ROOT, 'src'))
    .filter((file) => /\.tsx$/.test(file) || relative(ROOT, file).includes('hooks'))
    .flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line, index) => /\buse(?:Client|Content)Store\(\s*\)/.test(line) ? [`${relative(ROOT, file)}:${index + 1}`] : []));
  assert.deepEqual(offenders, []);
});
