import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { contrastRatio, TAILWIND_COLORS as C } from '../src/lib/contrast.js';
import { listTsx, readSource, toPosix } from './helpers/jsx-tags.js';

test('contrastRatio matches known WCAG values', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio(C.white, C.white), 1);
  assert.throws(() => contrastRatio('nope', C.white));
});

test('slate-400 fails AA for small text on white; slate-500/600 pass', () => {
  assert.ok(contrastRatio(C.slate400, C.white) < 4.5);
  assert.ok(contrastRatio(C.slate500, C.white) >= 4.5);
  assert.ok(contrastRatio(C.slate600, C.white) >= 4.5);
  assert.ok(contrastRatio(C.slate700, C.white) >= 4.5);
});

test('slate-400 and slate-300 are fine on dark slate panels', () => {
  assert.ok(contrastRatio(C.slate400, C.slate900) >= 4.5);
  assert.ok(contrastRatio(C.slate300, C.slate900) >= 4.5);
});

// Light-background text must not use slate-300/400. Variant-prefixed classes (hover:, disabled:...)
// are ignored: disabled controls are exempt and hover colours are transient.
const ALLOWLIST: Array<{ file: string; contains: string; reason: string }> = [
  { file: 'src/components/AiInsightsTab.tsx', contains: 'space-y-6 text-slate-300', reason: 'Inside the bg-slate-900 / bg-rose-950 summary panel' },
  { file: 'src/components/IntegrationsTab.tsx', contains: 'text-xs text-slate-400 leading-relaxed mb-6', reason: 'Inside the bg-slate-900 operational summary panel' },
  { file: 'src/components/OverviewTab.tsx', contains: 'tracking-widest text-slate-400">Insight operativo', reason: 'Inside the bg-slate-900 insight panel' },
  { file: 'src/components/OverviewTab.tsx', contains: 'text-xs text-slate-300 leading-relaxed mb-6', reason: 'Inside the bg-slate-900 insight panel' },
];
const LOW_CONTRAST = /(?<![\w:-])text-slate-(?:300|400)\b/;

test('no text-slate-300/400 on light backgrounds in src/**/*.tsx', () => {
  const root = process.cwd();
  const offenders: string[] = [];
  for (const file of listTsx(resolve(root, 'src'))) {
    const rel = toPosix(root, file);
    readSource(file).split('\n').forEach((line, index) => {
      if (!LOW_CONTRAST.test(line)) return;
      if (/\bbg-(?:slate|gray|zinc)-(?:800|900|950)\b/.test(line)) return;
      if (ALLOWLIST.some((entry) => entry.file === rel && line.includes(entry.contains))) return;
      offenders.push(`${rel}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
