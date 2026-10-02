import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';

import { apiRequest, getClients } from '../src/services/infidashApi.ts';
import { request as contentRequest } from '../src/services/contentApi.ts';
import {
  isAbortError,
  resetUnauthorizedLatch,
  setUnauthorizedHandler,
} from '../src/services/sessionExpiry.ts';
import {
  getActiveClientSignal,
  SESSION_EXPIRED_MESSAGE,
  registerSessionExpiryHandler,
  useClientStore,
} from '../src/store/useClientStore.ts';

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as unknown as { window?: unknown }).window;

// The session helpers need window.localStorage; provide a minimal one under node.
function installLocalStorage() {
  const data = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    },
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function resetStore() {
  useClientStore.setState({
    activeClientId: null,
    activeTabId: 'overview',
    clients: [],
    sessionToken: null,
    currentUser: null,
    isBootstrapping: false,
    isAuthenticating: false,
    isRefreshingClients: false,
    authError: null,
    dataError: null,
    sessionExpiredMessage: null,
  });
}

let calls: string[];

beforeEach(() => {
  calls = [];
  installLocalStorage();
  resetUnauthorizedLatch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerSessionExpiryHandler();
  (globalThis as unknown as { window?: unknown }).window = originalWindow;
  resetStore();
});

function countHandler() {
  setUnauthorizedHandler((token) => { calls.push(token); });
}

test('a 401 on an authenticated request calls the handler once even for parallel 401s', async () => {
  countHandler();
  globalThis.fetch = async () => json(401, { error: 'Sesión inválida' });
  const results = await Promise.allSettled([
    apiRequest('/api/clients', {}, 'tok'),
    apiRequest('/api/users', {}, 'tok'),
    contentRequest('/api/content/summary', 'tok'),
  ]);
  assert.deepEqual(calls, ['tok']);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal((result as PromiseRejectedResult).reason.status, 401);
  }
  assert.equal((results[0] as PromiseRejectedResult).reason.message, 'Sesión inválida');
});

test('the latch re-arms when a new session starts', async () => {
  countHandler();
  globalThis.fetch = async () => json(401, { error: 'x' });
  await apiRequest('/api/clients', {}, 'a').catch(() => undefined);
  resetUnauthorizedLatch();
  await apiRequest('/api/clients', {}, 'b').catch(() => undefined);
  assert.deepEqual(calls, ['a', 'b']);
});

test('401 on login or logout does not trigger the handler', async () => {
  countHandler();
  globalThis.fetch = async () => json(401, { error: 'Credenciales inválidas' });
  await assert.rejects(apiRequest('/api/auth/login', { method: 'POST', body: '{}' }), /Credenciales inválidas/);
  await assert.rejects(apiRequest('/api/auth/login', { method: 'POST', body: '{}' }, 'tok'), /Credenciales/);
  await assert.rejects(apiRequest('/api/auth/logout', { method: 'POST' }, 'tok'));
  assert.deepEqual(calls, []);
});

test('401 without a token, or other statuses, do not trigger the handler', async () => {
  countHandler();
  globalThis.fetch = async () => json(401, { error: 'x' });
  await assert.rejects(apiRequest('/api/public/thing'));
  globalThis.fetch = async () => json(403, { error: 'x' });
  await assert.rejects(apiRequest('/api/clients', {}, 'tok'));
  await assert.rejects(contentRequest('/api/content/summary', 'tok'));
  assert.deepEqual(calls, []);
});

test('a throwing handler does not change the original rejection', async () => {
  setUnauthorizedHandler(() => { throw new Error('handler exploded'); });
  globalThis.fetch = async () => json(401, { error: 'Sesión inválida' });
  await assert.rejects(apiRequest('/api/clients', {}, 'tok'), (error: Error & { status?: number }) => {
    assert.equal(error.message, 'Sesión inválida');
    assert.equal(error.status, 401);
    return true;
  });
});

test('the signal reaches fetch and aborting rejects with an AbortError', async () => {
  let received: AbortSignal | null | undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    received = init?.signal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  }) as typeof fetch;
  const controller = new AbortController();
  const pending = apiRequest('/api/clients', { signal: controller.signal }, 'tok');
  controller.abort();
  await assert.rejects(pending, (error) => isAbortError(error));
  assert.equal(received, controller.signal);
  assert.equal(isAbortError(new Error('x')), false);
  assert.equal(isAbortError(null), false);
});

test('the content request helper also forwards the signal', async () => {
  let received: AbortSignal | null | undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    received = init?.signal;
    return json(200, {});
  }) as typeof fetch;
  const controller = new AbortController();
  await contentRequest('/api/content/summary', 'tok', { signal: controller.signal });
  assert.equal(received, controller.signal);
});

test('the session-expiry handler clears the session without calling the server logout', async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return json(401, { error: 'Sesión inválida' });
  };
  useClientStore.setState({ sessionToken: 'tok', currentUser: { id: 'u' } as never, activeClientId: 'c1', clients: [{ id: 'c1' } as never] });
  await assert.rejects(getClients('tok'));
  const state = useClientStore.getState();
  assert.equal(state.sessionToken, null);
  assert.equal(state.currentUser, null);
  assert.deepEqual(state.clients, []);
  assert.equal(state.activeClientId, null);
  assert.equal(state.sessionExpiredMessage, SESSION_EXPIRED_MESSAGE);
  assert.deepEqual(urls, ['/api/clients'], 'no logout request was sent');
});

test('an explicit logout shows no expiry message', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  useClientStore.setState({ sessionToken: 'tok', currentUser: { id: 'u' } as never });
  await useClientStore.getState().signOut();
  assert.equal(useClientStore.getState().sessionExpiredMessage, null);
  assert.equal(useClientStore.getState().sessionToken, null);
});

test('signing in again clears the expiry message and shows the normal login error', async () => {
  useClientStore.setState({ sessionExpiredMessage: SESSION_EXPIRED_MESSAGE });
  globalThis.fetch = async () => json(401, { error: 'Credenciales inválidas' });
  await assert.rejects(useClientStore.getState().signIn('a@b.c', 'bad'));
  assert.equal(useClientStore.getState().sessionExpiredMessage, null);
  assert.equal(useClientStore.getState().authError, 'Credenciales inválidas');
});

test('a stale 401 from a previous session does not log out the new one', async () => {
  useClientStore.setState({ sessionToken: 'new-token', currentUser: { id: 'u' } as never });
  globalThis.fetch = async () => json(401, { error: 'x' });
  await apiRequest('/api/clients', {}, 'old-token').catch(() => undefined);
  assert.equal(useClientStore.getState().sessionToken, 'new-token');
  assert.equal(useClientStore.getState().sessionExpiredMessage, null);
});

test('switching the active client aborts the previous client scope', () => {
  useClientStore.setState({ activeClientId: 'c1' });
  const first = getActiveClientSignal();
  assert.equal(first.aborted, false);
  useClientStore.getState().setActiveClient('c2');
  assert.equal(first.aborted, true);
  const second = getActiveClientSignal();
  assert.notEqual(second, first);
  assert.equal(second.aborted, false);
  useClientStore.getState().setActiveClient('c2');
  assert.equal(second.aborted, false, 'selecting the same client keeps its scope');
});

test('a clients response that finishes after logout is aborted and ignored', async () => {
  const signals: AbortSignal[] = [];
  let release: () => void = () => undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    signals.push(init!.signal!);
    await new Promise<void>((resolve) => { release = resolve; });
    return json(200, { clients: [{ id: 'late', slug: 'late', name: 'Late', healthScore: 1, latestStat: null }] });
  }) as typeof fetch;
  useClientStore.setState({ sessionToken: 'tok', currentUser: { id: 'u' } as never });
  const refresh = useClientStore.getState().refreshClients();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 1);
  const pendingFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await useClientStore.getState().signOut();
  globalThis.fetch = pendingFetch;
  assert.equal(signals[0].aborted, true);
  release();
  await refresh;
  assert.deepEqual(useClientStore.getState().clients, []);
  assert.equal(useClientStore.getState().dataError, null);
});
