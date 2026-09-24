import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserProfile } from '../src/components/UserProfile.js';
import { getAvatarInitials } from '../src/lib/avatarInitials.js';

test('profile uses local initials instead of a fake remote avatar upload', () => {
  const html = renderToStaticMarkup(createElement(UserProfile));
  assert.match(html, /Iniciales de Usuario de Infidash/);
  assert.doesNotMatch(html, /ui-avatars\.com|images\.unsplash\.com|Cambiar avatar/);
});

test('avatar initials are deterministic and handle blank names', () => {
  assert.equal(getAvatarInitials('José María'), 'JM');
  assert.equal(getAvatarInitials('  '), 'U');
});
