import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('no server secret is injected into the client bundle', () => {
  const config = readFileSync('vite.config.ts', 'utf8');
  assert.doesNotMatch(config, /GEMINI/i, 'vite.config.ts must not define GEMINI_API_KEY for the browser');
  assert.doesNotMatch(config, /define\s*:/, 'vite.config.ts must not inline environment values into the bundle');
});

test('the dead Gemini client is gone', () => {
  assert.equal(existsSync('src/services/aiService.ts'), false);
});

test('unused dependencies stay out of package.json', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const dependency of ['@google/genai', 'drizzle-orm', 'motion']) {
    assert.equal(dependency in declared, false, `${dependency} is unused and must not be a dependency`);
  }
});

test('vite.config.ts is type-checked instead of opting out', () => {
  assert.doesNotMatch(readFileSync('vite.config.ts', 'utf8'), /@ts-nocheck/);
});

test('CI audits dependencies for high severity findings', () => {
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /npm audit --audit-level=high/);
});
