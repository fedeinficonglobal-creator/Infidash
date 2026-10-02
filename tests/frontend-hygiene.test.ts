import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InitialsAvatar } from '../src/components/InitialsAvatar.js';
import { CLIENT_AVATAR_PALETTE, clientColor, clientLogoUrl } from '../src/lib/clientAvatar.js';
import { contrastRatio } from '../src/lib/contrast.js';

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [full] : [];
  });
}

const posix = (file: string) => relative(ROOT, file).split('\\').join('/');
const read = (file: string) => readFileSync(file, 'utf8');

test('no stylesheet or index.html loads a third-party font or stylesheet', () => {
  const files = [...walk(join(ROOT, 'src'), ['.css']), join(ROOT, 'index.html')];
  for (const file of files) {
    const text = read(file);
    assert.ok(!/@import\s+url\(\s*['"]?https?:/i.test(text), `${posix(file)} imports a remote stylesheet`);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/i.test(text), `${posix(file)} references Google Fonts`);
  }
});

test('frontend sources never reference the Google Fonts hosts', () => {
  for (const file of walk(join(ROOT, 'src'), ['.ts', '.tsx', '.css']).filter((f) => !posix(f).startsWith('src/server/'))) {
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/i.test(read(file)), `${posix(file)} references Google Fonts`);
  }
});

// Only the legacy-URL guard in clientAvatar.ts may mention the host: old rows still store such URLs.
const UI_AVATARS_ALLOWLIST = new Set(['src/lib/clientAvatar.ts']);

test('ui-avatars.com is only mentioned by the legacy-URL guard', () => {
  for (const file of walk(join(ROOT, 'src'), ['.ts', '.tsx'])) {
    if (UI_AVATARS_ALLOWLIST.has(posix(file))) continue;
    assert.ok(!/ui-avatars\.com/i.test(read(file)), `${posix(file)} references ui-avatars.com`);
  }
});

test('the entry self-hosts the fonts through @fontsource packages', () => {
  const main = read(join(ROOT, 'src/main.tsx'));
  for (const weight of ['400', '500', '600', '700']) assert.ok(main.includes(`@fontsource/inter/latin-${weight}.css`));
  for (const weight of ['500', '700']) assert.ok(main.includes(`@fontsource/space-grotesk/latin-${weight}.css`));
  const css = read(join(ROOT, 'src/index.css'));
  assert.match(css, /--font-sans:\s*"Inter"/);
  assert.match(css, /--font-display:\s*"Space Grotesk"/);
});

test('every avatar background keeps white text at WCAG AA (4.5:1) or better', () => {
  assert.ok(CLIENT_AVATAR_PALETTE.length >= 6);
  for (const background of CLIENT_AVATAR_PALETTE) {
    assert.ok(contrastRatio(background, '#ffffff') >= 4.5, `${background} -> ${contrastRatio(background, '#ffffff').toFixed(2)}`);
  }
});

test('clientColor is a deterministic hash into the palette', () => {
  assert.equal(clientColor('inficon-global'), clientColor('inficon-global'));
  for (const seed of ['', 'a', 'Óptica Ñandú', 'x'.repeat(500)]) assert.ok(CLIENT_AVATAR_PALETTE.includes(clientColor(seed)));
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => clientColor(`cliente-${i}`))).size >= 4);
});

test('clientLogoUrl treats legacy ui-avatars URLs as no logo', () => {
  assert.equal(clientLogoUrl('https://ui-avatars.com/api/?name=Acme&background=random'), null);
  assert.equal(clientLogoUrl('HTTP://UI-AVATARS.COM/api/?name=x'), null);
  assert.equal(clientLogoUrl(null), null);
  assert.equal(clientLogoUrl('  '), null);
  assert.equal(clientLogoUrl('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');
});

test('InitialsAvatar renders local initials for no logo and for legacy ui-avatars logos', () => {
  for (const logo of [undefined, null, '', 'https://ui-avatars.com/api/?name=Acme+Corp&background=random']) {
    const html = renderToStaticMarkup(createElement(InitialsAvatar, { name: 'Acme Corp', seed: 'acme-corp', logo }));
    assert.ok(!html.includes('<img'), `${logo} should not render an image`);
    assert.ok(!html.includes('ui-avatars'), `${logo} must not leak the third-party host`);
    assert.match(html, />AC</);
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="Acme Corp"/);
    assert.match(html, /color:#ffffff/);
  }
});

test('InitialsAvatar hides itself from assistive technology when decorative', () => {
  const html = renderToStaticMarkup(createElement(InitialsAvatar, { name: 'Acme Corp', decorative: true }));
  assert.match(html, /aria-hidden="true"/);
  assert.ok(!html.includes('role="img"'));
  assert.ok(!html.includes('aria-label'));
});

test('InitialsAvatar renders a real logo as an image', () => {
  const html = renderToStaticMarkup(createElement(InitialsAvatar, { name: 'Acme', logo: 'https://cdn.example.com/a.png' }));
  assert.match(html, /<img[^>]+src="https:\/\/cdn\.example\.com\/a\.png"/);
  assert.match(html, /alt="Acme"/);
});
