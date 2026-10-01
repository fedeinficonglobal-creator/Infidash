import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RrssDraftsToolbar } from '../src/components/rrss/RrssIdeaPanel.tsx';
import { appendMediaItem, bulkUploadTargets, manualDraftAccounts } from '../src/lib/rrss.ts';
import { useRrssStore } from '../src/store/useRrssStore.ts';
import type { PublishingAccount } from '../src/services/contentApi.ts';
import type { SocialPost } from '../src/services/rrssApi.ts';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { method: string; url: string; body: any };
function recordFetch(respond: (call: Call, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const call = { method: init?.method ?? 'GET', url: String(input), body: typeof raw === 'string' ? JSON.parse(raw) : raw ?? null };
    calls.push(call);
    return respond(call, calls);
  }) as typeof fetch;
  return calls;
}

function post(input: Partial<SocialPost> = {}): SocialPost {
  return {
    id: 'post-1', clientId: 'client-a', planItemId: 'item-1', accountId: 'account-ig', accountLabel: 'Instagram Inficon', network: 'instagram', copy: 'Copy',
    media: [], status: 'review', publicationId: null, publicationStatus: null, publicationScheduledAt: null, generationJobId: null, version: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...input,
  };
}

function account(id: string, instanceKey: string, label: string, input: Partial<PublishingAccount> = {}): PublishingAccount {
  return { id, clientId: 'client-a', provider: 'postiz', instanceKey, externalAccountId: null, platform: 'blog', label, timezone: 'Europe/Madrid', active: true, ...input };
}

const IDEA = { id: 'item-1', clientId: 'client-a', calendarId: 'cal', calendarTitle: 'Ideas sueltas', title: 'Idea', theme: null, rationale: null, format: null, keywords: [], cta: null, plannedAt: null, status: 'proposed', networks: [], version: 3, createdAt: '', updatedAt: '', socialPosts: [] };
const JPG = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'portada.jpg', { type: 'image/jpeg' });
const MP4 = () => new File([new Uint8Array([0, 0, 0, 0x18])], 'clip.mp4', { type: 'video/mp4' });
const GIF = () => new File([new Uint8Array([1])], 'anim.gif', { type: 'image/gif' });

afterEach(() => {
  globalThis.fetch = originalFetch;
  useRrssStore.getState().reset('');
});

// ---------------------------------------------------------------------------
// Pure helpers

test('manual draft accounts are the active Postiz accounts without a draft for the idea, with a reason when none is left', () => {
  const accounts = [account('a-ig', 'x-instagram', 'IG'), account('a-gmb', 'x-gmb', 'GMB'), account('a-off', 'x-facebook', 'FB', { active: false }), account('a-wp', 'x-wp', 'WP', { provider: 'wordpress' })];
  const open = manualDraftAccounts(accounts, [post({ accountId: 'a-ig', status: 'discarded' })]);
  assert.deepEqual(open.accounts.map(({ id }) => id), ['a-gmb'], 'any existing draft, whatever its status, blocks its account');
  assert.equal(open.emptyReason, null);
  assert.equal(manualDraftAccounts(accounts, [post({ accountId: 'a-ig' }), post({ id: 'p2', accountId: 'a-gmb' })]).emptyReason, 'Todas las cuentas ya tienen borrador');
  assert.equal(manualDraftAccounts([], []).emptyReason, 'No hay cuentas de Postiz activas');
  assert.equal(manualDraftAccounts([account('a-off', 'x-facebook', 'FB', { active: false })], []).emptyReason, 'No hay cuentas de Postiz activas');
});

test('bulk upload targets are the editable drafts only, and media merges skip duplicate URLs', () => {
  const posts = [post({ id: 'r', status: 'review' }), post({ id: 'a', status: 'approved' }), post({ id: 's', status: 'scheduled' }), post({ id: 'd', status: 'discarded' })];
  assert.deepEqual(bulkUploadTargets(posts).map(({ id }) => id), ['r', 'a']);
  const media = [{ url: 'https://cdn.example/1.jpg' }, { url: 'https://cdn.example/2.jpg' }];
  assert.deepEqual(appendMediaItem(media, { url: 'https://cdn.example/3.jpg', type: 'image', name: '3.jpg' }), [...media, { url: 'https://cdn.example/3.jpg', type: 'image', name: '3.jpg' }], 'keeps the existing order and appends');
  assert.equal(appendMediaItem(media, { url: 'https://cdn.example/2.jpg' }), null, 'already contains the URL');
});

// ---------------------------------------------------------------------------
// Store: «Nuevo borrador»

test('createManualDraft posts the draft, then uploads each valid file to it one by one and refreshes the drafts', async () => {
  const created = { ...post({ id: 'post-new', accountId: 'a-gmb', network: 'gmb', copy: 'Copy manual' }), plan_item_id: 'item-1' };
  let media: any[] = [];
  const calls = recordFetch(({ method, url }) => {
    if (method === 'POST' && url === '/api/content/plan-items/item-1/social-posts') return jsonResponse({ socialPost: created }, 201);
    if (method === 'POST' && url === '/api/social-posts/post-new/media') { media = [...media, { url: `https://postiz.example/${media.length}`, type: 'image' }]; return jsonResponse({ socialPost: { ...created, media, version: 1 + media.length } }); }
    if (url === '/api/content/plan-items/item-1/social-posts') return jsonResponse({ socialPosts: [{ ...created, media }] });
    return jsonResponse({}, 404);
  });
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ items: [IDEA as any], selectedId: 'item-1', socialPosts: [] });
  const result = await useRrssStore.getState().createManualDraft('token', 'item-1', { accountId: 'a-gmb', copy: 'Copy manual', files: [JPG(), GIF(), MP4()] });
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST /api/content/plan-items/item-1/social-posts',
    'POST /api/social-posts/post-new/media',
    'POST /api/social-posts/post-new/media',
    'GET /api/content/plan-items/item-1/social-posts',
  ]);
  assert.deepEqual(calls[0].body, { accountId: 'a-gmb', copy: 'Copy manual' });
  assert.equal(((calls[1].body as FormData).get('file') as File).name, 'portada.jpg');
  assert.equal(((calls[2].body as FormData).get('file') as File).name, 'clip.mp4');
  assert.equal(result.socialPost.id, 'post-new');
  assert.deepEqual(result.failedFiles.map(({ name }) => name), ['anim.gif']);
  assert.match(result.failedFiles[0].error, /Formato no admitido/);
  assert.equal(useRrssStore.getState().socialPosts[0].media.length, 2);
  const idea = useRrssStore.getState().items[0];
  assert.equal(idea.status, 'review', 'mirrors the server: a proposed idea moves to review');
  assert.equal(idea.version, 4);
});

test('createManualDraft keeps the draft when an upload fails and reports the failed file', async () => {
  const created = { ...post({ id: 'post-new' }), plan_item_id: 'item-1' };
  recordFetch(({ method, url }) => {
    if (method === 'POST' && url.endsWith('/social-posts')) return jsonResponse({ socialPost: created }, 201);
    if (url.endsWith('/media')) return jsonResponse({ error: 'Postiz no respondió', code: 'POSTIZ_UPLOAD_FAILED' }, 502);
    return jsonResponse({ socialPosts: [created] });
  });
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ items: [{ ...IDEA, status: 'review' } as any], selectedId: 'item-1' });
  const result = await useRrssStore.getState().createManualDraft('token', 'item-1', { accountId: 'account-ig', copy: 'Copy', files: [JPG()] });
  assert.deepEqual(result.failedFiles, [{ name: 'portada.jpg', error: 'Postiz no respondió' }]);
  assert.equal(useRrssStore.getState().socialPosts[0].id, 'post-new');
  assert.equal(useRrssStore.getState().items[0].version, 3, 'an idea already in review is left unchanged');
});

test('createManualDraft rejects and uploads nothing when the draft cannot be created', async () => {
  const calls = recordFetch(() => jsonResponse({ error: 'Ya existe un borrador para esa cuenta; edítalo', code: 'SOCIAL_POST_EXISTS' }, 409));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ items: [IDEA as any], selectedId: 'item-1' });
  await assert.rejects(() => useRrssStore.getState().createManualDraft('token', 'item-1', { accountId: 'account-ig', copy: 'Copy', files: [JPG()] }), /Ya existe un borrador/);
  assert.equal(calls.length, 1);
  assert.equal(useRrssStore.getState().items[0].status, 'proposed');
});

// ---------------------------------------------------------------------------
// Store: «Subir creatividad para todos»

const UPLOADED = { url: 'https://postiz.example/uploads/new.jpg', type: 'image', name: 'portada.jpg' };

function bulkFetch(options: { staleOnce?: string } = {}) {
  let uploads = 0;
  let stale = options.staleOnce;
  const state = new Map<string, SocialPost>();
  const calls = recordFetch(({ method, url, body }) => {
    const media = url.match(/^\/api\/social-posts\/([^/]+)\/media$/);
    if (method === 'POST' && media) {
      uploads += 1;
      const current = state.get(media[1])!;
      const item = { ...UPLOADED, url: `https://postiz.example/uploads/new-${uploads}.jpg` };
      const next = { ...current, media: [...current.media, item], status: 'review' as const, version: current.version + 1 };
      state.set(next.id, next);
      return jsonResponse({ socialPost: next });
    }
    const patch = url.match(/^\/api\/social-posts\/([^/]+)$/);
    if (method === 'PATCH' && patch) {
      const current = state.get(patch[1])!;
      if (stale === patch[1]) {
        stale = undefined;
        state.set(current.id, { ...current, media: [{ url: 'https://cdn.example/other.jpg' }], version: 7 });
        return jsonResponse({ error: 'El post fue modificado por otra ejecución', code: 'STALE_VERSION' }, 409);
      }
      if (body.expectedVersion !== current.version) return jsonResponse({ error: 'El post fue modificado por otra ejecución', code: 'STALE_VERSION' }, 409);
      const next = { ...current, media: body.media, status: 'review' as const, version: current.version + 1 };
      state.set(next.id, next);
      return jsonResponse({ socialPost: next });
    }
    if (url === '/api/content/plan-items/item-1/social-posts') return jsonResponse({ socialPosts: [...state.values()] });
    return jsonResponse({}, 404);
  });
  return { calls, state };
}

function seed(posts: SocialPost[], state: Map<string, SocialPost>) {
  posts.forEach((item) => state.set(item.id, item));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ items: [{ ...IDEA, status: 'review' } as any], selectedId: 'item-1', socialPosts: posts });
}

test('uploadToAllDrafts uploads each file once and appends the same item to every other editable draft', async () => {
  const { calls, state } = bulkFetch();
  seed([
    post({ id: 'p1', status: 'review', version: 4, media: [{ url: 'https://cdn.example/a.jpg' }] }),
    post({ id: 'p2', accountId: 'a2', status: 'approved', version: 2, media: [{ url: 'https://cdn.example/b.jpg' }] }),
    post({ id: 'p3', accountId: 'a3', status: 'scheduled', version: 9 }),
    post({ id: 'p4', accountId: 'a4', status: 'discarded', version: 9 }),
  ], state);
  const result = await useRrssStore.getState().uploadToAllDrafts('token', 'item-1', [JPG(), MP4()]);
  const mediaCalls = calls.filter(({ url }) => url.endsWith('/media'));
  assert.deepEqual(mediaCalls.map(({ url }) => url), ['/api/social-posts/p1/media', '/api/social-posts/p1/media'], 'each file is uploaded once, to the first target');
  const patches = calls.filter(({ method }) => method === 'PATCH');
  assert.deepEqual(patches.map(({ url }) => url), ['/api/social-posts/p2', '/api/social-posts/p2'], 'non-editable drafts are excluded');
  assert.deepEqual(patches[0].body, { media: [{ url: 'https://cdn.example/b.jpg' }, { ...UPLOADED, url: 'https://postiz.example/uploads/new-1.jpg' }], expectedVersion: 2 });
  assert.deepEqual(patches[1].body.media.map(({ url }: any) => url), ['https://cdn.example/b.jpg', 'https://postiz.example/uploads/new-1.jpg', 'https://postiz.example/uploads/new-2.jpg'], 'files keep their order');
  assert.equal(patches[1].body.expectedVersion, 3, 'uses the version returned by the previous PATCH');
  assert.ok(calls.at(-1)!.url.endsWith('/plan-items/item-1/social-posts'), 'the drafts are refreshed at the end');
  assert.deepEqual(result.failures, []);
  assert.equal(result.approvedReturned, true);
  assert.equal(useRrssStore.getState().bulkUpload?.status, 'done');
});

test('uploadToAllDrafts skips drafts that already contain the uploaded URL', async () => {
  const { calls, state } = bulkFetch();
  seed([
    post({ id: 'p1', version: 1 }),
    post({ id: 'p2', accountId: 'a2', version: 1, media: [{ url: 'https://postiz.example/uploads/new-1.jpg' }] }),
    post({ id: 'p5', accountId: 'a5', version: 1 }),
  ], state);
  const result = await useRrssStore.getState().uploadToAllDrafts('token', 'item-1', [JPG()]);
  assert.deepEqual(calls.filter(({ method }) => method === 'PATCH').map(({ url }) => url), ['/api/social-posts/p5']);
  assert.equal(result.approvedReturned, false);
});

test('uploadToAllDrafts refetches a stale draft once and retries with its fresh version and media', async () => {
  const { calls, state } = bulkFetch({ staleOnce: 'p2' });
  seed([post({ id: 'p1', version: 1 }), post({ id: 'p2', accountId: 'a2', version: 2 })], state);
  const result = await useRrssStore.getState().uploadToAllDrafts('token', 'item-1', [JPG()]);
  const patches = calls.filter(({ method }) => method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.equal(patches[0].body.expectedVersion, 2);
  assert.ok(calls.findIndex(({ method, url }) => method === 'GET' && url.endsWith('/social-posts')) < calls.indexOf(patches[1]), 'refetches before retrying');
  assert.deepEqual(patches[1].body, { media: [{ url: 'https://cdn.example/other.jpg' }, { ...UPLOADED, url: 'https://postiz.example/uploads/new-1.jpg' }], expectedVersion: 7 });
  assert.deepEqual(result.failures, []);
});

test('uploadToAllDrafts reports invalid files and failed drafts without stopping the batch', async () => {
  const { calls, state } = bulkFetch({ staleOnce: 'p2' });
  seed([post({ id: 'p1', version: 1 }), post({ id: 'p2', accountId: 'a2', accountLabel: 'GMB Inficon', version: 2 })], state);
  // A second conflict after the refetch is reported, not retried again.
  const original = globalThis.fetch;
  let patches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH' && ++patches === 2) return jsonResponse({ error: 'El post fue modificado por otra ejecución', code: 'STALE_VERSION' }, 409);
    return original(input, init);
  }) as typeof fetch;
  const result = await useRrssStore.getState().uploadToAllDrafts('token', 'item-1', [GIF(), JPG()]);
  assert.equal(calls.filter(({ url }) => url.endsWith('/media')).length, 1, 'the invalid file is never sent');
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /anim\.gif.*Formato no admitido/);
  assert.match(result.failures[1], /GMB Inficon.*portada\.jpg/);
});

// ---------------------------------------------------------------------------
// Static render

test('the drafts toolbar shows «Nuevo borrador» and «Subir creatividad para todos» to admins', () => {
  const render = (props: Partial<Parameters<typeof RrssDraftsToolbar>[0]>) => renderToStaticMarkup(createElement(RrssDraftsToolbar, { admin: true, ideaStatus: 'review', posts: [post()], busy: false, bulkUpload: null, onNewDraft: () => {}, onBulkUpload: () => {}, ...props }));
  const bulkButton = (html: string) => html.match(/<label[^>]*>(?:(?!<\/label>).)*Subir creatividad para todos/)![0];
  const html = render({});
  assert.match(html, /Nuevo borrador/);
  assert.match(html, /Subir creatividad para todos/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/quicktime"/);
  assert.match(html, /multiple/);
  assert.doesNotMatch(bulkButton(html), /aria-disabled="true"/);

  const none = render({ posts: [post({ status: 'scheduled' }), post({ id: 'p2', status: 'discarded' })] });
  assert.match(bulkButton(none), /aria-disabled="true"/);
  assert.match(bulkButton(none), /title="No hay borradores editables \(en revisión o aprobados\)"/);
  assert.match(none, /<input[^>]*type="file"[^>]*disabled=""/);

  assert.doesNotMatch(render({ ideaStatus: 'generating' }), /Nuevo borrador/, 'hidden while the idea is generating');
  assert.equal(render({ admin: false }), '', 'viewers see neither action');

  const progress = render({ bulkUpload: { status: 'running', progress: 'Subiendo 1/2…', failures: [], approvedReturned: false } });
  assert.match(progress, /Subiendo 1\/2…/);
  const done = render({ bulkUpload: { status: 'done', progress: null, failures: ['anim.gif: Formato no admitido'], approvedReturned: true } });
  assert.match(done, /anim\.gif: Formato no admitido/);
  assert.match(done, /Los borradores aprobados vuelven a revisión/);
});
