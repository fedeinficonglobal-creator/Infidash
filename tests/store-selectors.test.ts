import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { shallow } from 'zustand/shallow';
import * as selectors from '../src/store/selectors.ts';
import { useClientStore } from '../src/store/useClientStore.ts';
import { useContentStore } from '../src/store/useContentStore.ts';
import { useRrssStore } from '../src/store/useRrssStore.ts';

const clientInitial = useClientStore.getState();
const contentInitial = useContentStore.getState();
const rrssInitial = useRrssStore.getState();

beforeEach(() => {
  useClientStore.setState({ ...clientInitial, sessionToken: 'token', currentUser: { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin' } as never, clients: [], activeClientId: null, activeTabId: 'overview' }, true);
  useContentStore.setState({ ...contentInitial, jobs: [], items: [] }, true);
  useRrssStore.setState({ ...rrssInitial, jobs: [], items: [] }, true);
});
afterEach(() => {
  useClientStore.setState(clientInitial, true);
  useContentStore.setState(contentInitial, true);
  useRrssStore.setState(rrssInitial, true);
});

/** Applies a selector before and after a store update and reports whether a shallow-subscribed component would re-render. */
// The store and selector types are deliberately loose so one probe can drive the three stores and heterogeneous selector lists.
function rerenders(store: { getState: () => unknown; setState: (partial: never, replace?: boolean) => void }, select: (s: never) => unknown, update: object) {
  const snapshot = store.getState() as never;
  const before = select(snapshot);
  store.setState(update as never);
  const after = select(store.getState() as never);
  store.setState(snapshot, true); // each probe starts from the same state
  // Single-value selectors are compared by identity (as useStore does); shallow() would treat any two Dates as equal.
  return before instanceof Date ? !Object.is(before, after) : !shallow(before, after);
}

const job = (id: string) => ({ id, kind: 'generate_content', status: 'running', clientId: 'c1' }) as never;

test('every exported selector is a function', () => {
  for (const [name, value] of Object.entries(selectors)) {
    if (name.startsWith('select')) assert.equal(typeof value, 'function', name);
  }
});

test('job polling does not re-render components that do not read jobs', () => {
  const update = { jobs: [job('j1')] };
  const unrelated = [selectors.selectContentFilterBar, selectors.selectContentMonth, selectors.selectContentPagination, selectors.selectContentCreatePanel];
  for (const select of unrelated) assert.equal(rerenders(useContentStore, select, update), false);
});

test('job polling does re-render the components that read jobs', () => {
  const update = { jobs: [job('j1')] };
  assert.equal(rerenders(useContentStore, selectors.selectContentTab, update), true);
  assert.equal(rerenders(useContentStore, selectors.selectContentDetail, update), true);
});

test('related content updates change the matching selectors', () => {
  assert.equal(rerenders(useContentStore, selectors.selectContentMonth, { month: new Date(2030, 1, 1) }), true);
  assert.equal(rerenders(useContentStore, selectors.selectContentPagination, { page: 2 }), true);
  assert.equal(rerenders(useContentStore, selectors.selectContentFilterBar, { items: [] }), true);
  assert.equal(rerenders(useContentStore, selectors.selectContentCreatePanel, { isSaving: true }), true);
  assert.equal(rerenders(useContentStore, selectors.selectContentDetail, { selectedId: 'x' }), true);
});

test('RRSS job polling only re-renders the posts section, not the idea detail or dialogs', () => {
  const update = { jobs: [job('j1')] };
  for (const select of [selectors.selectRrssAccounts, selectors.selectRrssDraftDialog, selectors.selectRrssIdeaDetail]) assert.equal(rerenders(useRrssStore, select, update), false);
  assert.equal(rerenders(useRrssStore, selectors.selectRrssPostsSection, update), true);
  assert.equal(rerenders(useRrssStore, selectors.selectRrssIdeaDetail, { selectedId: 'idea-1' }), true);
  assert.equal(rerenders(useRrssStore, selectors.selectRrssAccounts, { publishingAccounts: [] }), true);
  assert.equal(rerenders(useRrssStore, selectors.selectRrssDraftDialog, { socialPosts: [] }), true);
});

test('a client switch does not change the session or app shell selectors', () => {
  const update = { activeClientId: 'c2', activeTabId: 'sales' };
  for (const select of [selectors.selectSession, selectors.selectAppShell, selectors.selectUserProfile, selectors.selectReportsSession, selectors.selectSessionToken, selectors.selectCurrentUser]) {
    assert.equal(rerenders(useClientStore, select, update), false);
  }
  assert.equal(rerenders(useClientStore, selectors.selectSidebar, update), true);
});

test('related client updates change the matching selectors', () => {
  const user = { id: 'u2', email: 'x@y.z', name: 'X', role: 'viewer' } as never;
  assert.equal(rerenders(useClientStore, selectors.selectSession, { currentUser: user }), true);
  assert.equal(rerenders(useClientStore, selectors.selectSession, { sessionToken: 'other' }), true);
  assert.equal(rerenders(useClientStore, selectors.selectAppShell, { authError: 'boom' }), true);
  assert.equal(rerenders(useClientStore, selectors.selectUsersAdmin, { clients: [] }), true);
  assert.equal(rerenders(useClientStore, selectors.selectAgencyDashboard, { clients: [] }), true);
  assert.equal(rerenders(useClientStore, selectors.selectUserProfile, { currentUser: user }), true);
});

test('selectors return the same shallow result when nothing changed', () => {
  for (const select of [selectors.selectSession, selectors.selectSidebar, selectors.selectAppShell]) {
    assert.ok(shallow(select(useClientStore.getState()), select(useClientStore.getState())));
  }
  for (const select of [selectors.selectContentTab, selectors.selectContentDetail]) {
    assert.ok(shallow(select(useContentStore.getState()), select(useContentStore.getState())));
  }
});
