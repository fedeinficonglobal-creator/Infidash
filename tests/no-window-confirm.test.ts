import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const srcRoot = resolve(import.meta.dirname, '..', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Removes block and line comments so prose mentioning the native dialog does not trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const NATIVE_CONFIRM = /\b(?:window|globalThis|self)\s*\.\s*confirm\s*\(|(?<![\w.$])confirm\s*\(/;

test('the native confirm dialog detector matches window.confirm and bare confirm calls only', () => {
  assert.match('if (!window.confirm("x")) return;', NATIVE_CONFIRM);
  assert.match('const ok = confirm("x");', NATIVE_CONFIRM);
  assert.doesNotMatch(stripComments('// window.confirm(x)\n/* confirm(y) */'), NATIVE_CONFIRM);
});

test('source code never uses the native window.confirm dialog', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(srcRoot)) {
    stripComments(readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, index) => {
      // `await confirm(` is the accessible useConfirm() hook; a bare `confirm(` is the native dialog.
      const withoutHook = line.replace(/await\s+confirm\s*\(/g, 'await useConfirmCall(');
      if (NATIVE_CONFIRM.test(withoutHook)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'use useConfirm() from src/hooks/useConfirm.tsx instead of window.confirm');
});
