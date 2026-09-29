import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { signInToDashboard, signOutToDashboard } from '../src/lib/authNavigation.ts';

test('an interactive login always lands on the agency dashboard, not the URL left open before it', async () => {
  const calls: string[] = [];
  const navigate = (to: string, options?: { replace?: boolean }) => { calls.push(`navigate:${to}:${options?.replace ? 'replace' : 'push'}`); };
  const signIn = async (email: string, password: string) => { calls.push(`signIn:${email}:${password}`); };
  await signInToDashboard(signIn, navigate, 'ana@example.com', 'secreto');
  assert.deepEqual(calls, ['navigate:/:replace', 'signIn:ana@example.com:secreto'], 'the stale page is never rendered once the session exists');
});

test('a failed login still rejects so the login screen can show the error', async () => {
  const signIn = async () => { throw new Error('Credenciales inválidas'); };
  await assert.rejects(signInToDashboard(signIn, () => undefined, 'ana@example.com', 'mal'), /Credenciales inválidas/);
});

test('logging out leaves the URL at the dashboard so the next login does not resume a stale page', async () => {
  const calls: string[] = [];
  const signOut = async () => { calls.push('signOut'); };
  await signOutToDashboard(signOut, (to, options) => { calls.push(`navigate:${to}:${options?.replace ? 'replace' : 'push'}`); });
  assert.deepEqual(calls, ['signOut', 'navigate:/:replace']);
});

test('the login screen and the profile logout go through the dashboard-landing helpers', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const profile = readFileSync('src/components/UserProfile.tsx', 'utf8');
  assert.match(app, /signInToDashboard\(/);
  assert.doesNotMatch(app, /onLogin=\{signIn\}/);
  assert.match(profile, /signOutToDashboard\(/);
});
