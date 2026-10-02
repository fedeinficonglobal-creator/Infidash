import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { listTsx, openingTags, readSource, toPosix } from './helpers/jsx-tags.js';

// Non-interactive elements must not carry click handlers unless they are exposed as buttons.
const root = process.cwd();
const FORBIDDEN = new Set(['div', 'li', 'tr', 'td', 'span', 'article', 'section', 'img']);

// Allowlist keyed by file + substring that must appear in the tag text.
const ALLOWLIST: Array<{ file: string; contains: string; reason: string }> = [
  {
    file: 'src/components/AgencyDashboard.tsx',
    contains: 'onClick={() => goToClient(client.id)}',
    reason: 'Table row click is a mouse convenience; each row also has a real name button (keyboard and screen readers). A tr cannot be a button without breaking table semantics.',
  },
];

test('onClick is never attached to non-interactive elements without role=button and tabIndex', () => {
  const offenders: string[] = [];
  for (const file of listTsx(resolve(root, 'src'))) {
    const rel = toPosix(root, file);
    for (const tag of openingTags(readSource(file))) {
      if (!FORBIDDEN.has(tag.name) || !/\bonClick=/.test(tag.text)) continue;
      if (/role="button"/.test(tag.text) && /tabIndex=/.test(tag.text)) continue;
      if (ALLOWLIST.some((a) => a.file === rel && tag.text.includes(a.contains))) continue;
      offenders.push(`${rel}:${tag.line} <${tag.name}>`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('tag tokenizer handles multi-line tags and arrow functions', () => {
  const tags = openingTags('<div\n  onClick={() => go(1)}\n  className="a>b"\n>x</div>');
  assert.equal(tags.length, 1);
  assert.match(tags[0].text, /onClick/);
});
