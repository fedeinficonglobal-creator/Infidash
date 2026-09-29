import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useContentStore } from '../src/store/useContentStore.ts';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('components navigate through the router, never by writing the active client or tab', () => {
  const files = [...sourceFiles('src/components'), 'src/App.tsx'];
  const offenders = files.filter((file) => /\bsetActive(Tab|Client)\(/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the Contenidos page opens on the article list first', () => {
  assert.equal(useContentStore.getInitialState().view, 'list');
});

test('the sidebar no longer links to the global Contenidos page; each client menu has its own', () => {
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
  assert.doesNotMatch(sidebar, /GLOBAL_CONTENT_PATH/);
  assert.doesNotMatch(sidebar, /Contenidos globales/);
  assert.match(sidebar, /label: 'Contenidos'/);
});
