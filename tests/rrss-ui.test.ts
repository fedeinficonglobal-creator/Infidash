import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { RrssTab } from '../src/components/RrssTab.tsx';
import { RrssToolbar } from '../src/components/rrss/RrssPostsSection.tsx';
import { SocialPostCard } from '../src/components/rrss/SocialPostCard.tsx';
import { canGeneratePosts, canSchedulePost, draftsSummary, mediaKind, moveMediaItem, networkFromInstanceKey, preselectAccountIds, removeMediaItem, rrssIdeaDisplayStatus, socialPostDisplayStatus, socialPostStatusLabel, validateCreativeFile } from '../src/lib/rrss.ts';
import { ConfirmProvider } from '../src/hooks/useConfirm.tsx';
import { useRrssStore } from '../src/store/useRrssStore.ts';
import type { SocialPost } from '../src/services/rrssApi.ts';
import type { Client } from '../src/store/useClientStore.ts';

const originalFetch = globalThis.fetch;
const READY = { enabled: true, jobs: { generate_plan: true, generate_content: true, publish: true, reschedule: true, cancel: true, reconcile: true, generate_rrss_plan: true, generate_rrss: true } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { method: string; url: string; body: any; headers: Headers };
function recordFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const call = { method: init?.method ?? 'GET', url: String(input), body: typeof raw === 'string' ? JSON.parse(raw) : raw ?? null, headers: new Headers(init?.headers ?? {}) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
}

function post(input: Partial<SocialPost> = {}): SocialPost {
  return {
    id: 'post-1', clientId: 'client-a', planItemId: 'item-1', accountId: 'account-ig', accountLabel: 'Instagram Inficon', network: 'instagram', copy: 'Copy del post',
    media: [{ url: 'https://cdn.example/a.jpg', type: 'image', name: 'a.jpg' }, { url: 'https://cdn.example/b.mp4' }, { url: 'https://cdn.example/c.png', type: 'image' }],
    status: 'review', publicationId: null, publicationStatus: null, publicationScheduledAt: null, generationJobId: null, version: 4, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...input,
  };
}

const IDEA_ROW = { id: 'item-1', client_id: 'client-a', calendar_id: 'calendar-rrss', calendar_title: 'Plan de redes', title: 'Idea de verano', theme: 'Verano', rationale: null, format: 'post', keywords: [], cta: null, planned_at: null, status: 'approved', networks: ['instagram'], version: 3, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', social_posts: [] };

afterEach(() => {
  globalThis.fetch = originalFetch;
  useRrssStore.getState().reset('');
});

// ---------------------------------------------------------------------------
// Pure helpers

test('frontend network detection mirrors the server: instance_key only, facebook before instagram before GMB', () => {
  assert.equal(networkFromInstanceKey('inficonglobal-gmb'), 'gmb');
  assert.equal(networkFromInstanceKey('Cliente-Google-Business'), 'gmb');
  assert.equal(networkFromInstanceKey('inficonglobal-facebook'), 'facebook');
  assert.equal(networkFromInstanceKey('INFICON-INSTAGRAM'), 'instagram');
  assert.equal(networkFromInstanceKey('facebook-google'), 'facebook');
  assert.equal(networkFromInstanceKey('instagram-gmb'), 'instagram');
  assert.equal(networkFromInstanceKey('blog'), 'other');
  assert.equal(networkFromInstanceKey(null), 'other');
  const accounts = [{ id: 'a-gmb', instanceKey: 'x-gmb' }, { id: 'a-ig', instanceKey: 'x-instagram' }, { id: 'a-fb', instanceKey: 'x-facebook' }];
  assert.deepEqual(preselectAccountIds(accounts, ['instagram', 'gmb']), ['a-gmb', 'a-ig']);
  assert.deepEqual(preselectAccountIds(accounts, []), []);
});

test('media type comes from the stored type, else from the file extension', () => {
  assert.equal(mediaKind({ url: 'https://cdn.example/a.jpg', type: 'video' }), 'video');
  assert.equal(mediaKind({ url: 'https://cdn.example/clip.MP4?x=1' }), 'video');
  assert.equal(mediaKind({ url: 'https://cdn.example/clip.mov' }), 'video');
  assert.equal(mediaKind({ url: 'https://cdn.example/foto.webp' }), 'image');
  assert.equal(mediaKind({ url: 'https://cdn.example/sin-extension' }), 'image');
});

test('client-side creative validation applies the server type and size limits', () => {
  const MB = 1024 * 1024;
  assert.equal(validateCreativeFile({ type: 'image/jpeg', size: 10 * MB }), null);
  assert.equal(validateCreativeFile({ type: 'image/png', size: 1 }), null);
  assert.equal(validateCreativeFile({ type: 'video/quicktime', size: 200 * MB }), null);
  assert.match(validateCreativeFile({ type: 'image/webp', size: 10 * MB + 1 })!, /10 MB/);
  assert.match(validateCreativeFile({ type: 'video/mp4', size: 200 * MB + 1 })!, /200 MB/);
  assert.match(validateCreativeFile({ type: 'image/gif', size: 1 })!, /Formato no admitido/);
  assert.match(validateCreativeFile({ type: '', size: 1 })!, /Formato no admitido/);
});

test('draft helpers summarize, label, and gate scheduling and media moves', () => {
  assert.equal(draftsSummary([]), 'Sin borradores');
  assert.equal(draftsSummary([{ status: 'review' }]), '1 borrador');
  assert.equal(draftsSummary([{ status: 'review' }, { status: 'scheduled' }, { status: 'approved' }]), '3 borradores · 1 programado');
  assert.equal(draftsSummary([{ status: 'scheduled' }, { status: 'scheduled' }]), '2 borradores · 2 programados');
  assert.equal(socialPostDisplayStatus(post({ status: 'scheduled', publicationStatus: 'published' })), 'published');
  assert.equal(socialPostDisplayStatus(post({ status: 'scheduled', publicationStatus: 'cancelled' })), 'cancelled');
  assert.equal(socialPostDisplayStatus(post({ status: 'scheduled', publicationStatus: 'pending' })), 'scheduled');
  assert.equal(socialPostDisplayStatus(post({ status: 'discarded' })), 'discarded');
  assert.deepEqual(['review', 'approved', 'scheduled', 'published', 'cancelled', 'discarded'].map(socialPostStatusLabel), ['Revisión', 'Aprobado', 'Programado', 'Publicado', 'Cancelado', 'Descartado']);
  assert.equal(canSchedulePost(post({ status: 'approved' })), true);
  assert.equal(canSchedulePost(post({ status: 'review' })), false);
  assert.equal(canSchedulePost(post({ status: 'scheduled', publicationStatus: 'cancelled' })), true);
  assert.equal(canSchedulePost(post({ status: 'scheduled', publicationStatus: 'failed' })), true);
  assert.equal(canSchedulePost(post({ status: 'scheduled', publicationStatus: 'scheduled' })), false);
  const media = post().media;
  assert.deepEqual(moveMediaItem(media, 0, 1).map(({ url }) => url), [media[1].url, media[0].url, media[2].url]);
  assert.deepEqual(moveMediaItem(media, 0, -1), media, 'moving past the edge is a no-op');
  assert.deepEqual(removeMediaItem(media, 1).map(({ url }) => url), [media[0].url, media[2].url]);
  assert.equal(canGeneratePosts({ status: 'approved' }, READY), true);
  assert.equal(canGeneratePosts({ status: 'proposed' }, READY), false);
  assert.equal(canGeneratePosts({ status: 'generation_failed' }, READY), true);
  assert.equal(canGeneratePosts({ status: 'review' }, { ...READY, jobs: { ...READY.jobs, generate_rrss: false } }), false);
});

// ---------------------------------------------------------------------------
// Store and services

test('the ideas list requests 20 per page with cursors and «Anterior» returns to the exact previous page', async () => {
  const calls = recordFetch(({ url }) => {
    if (url.includes('/rrss/items')) return jsonResponse({ items: [IDEA_ROW], next_cursor: url.includes('cursor=c1') ? 'c2' : 'c1' });
    return jsonResponse({ items: [], next_cursor: null });
  });
  useRrssStore.getState().reset('client-a');
  useRrssStore.getState().setFilters({ status: 'approved', format: 'reel', search: 'verano' });
  await useRrssStore.getState().load('token');
  const first = calls.find(({ url }) => url.includes('/rrss/items'))!.url;
  assert.match(first, /^\/api\/clients\/client-a\/rrss\/items\?/);
  assert.match(first, /limit=20/);
  assert.match(first, /status=approved/);
  assert.match(first, /format=reel/);
  assert.match(first, /search=verano/);
  assert.doesNotMatch(first, /cursor=/);
  assert.equal(useRrssStore.getState().items[0].socialPosts.length, 0);
  assert.equal(useRrssStore.getState().items[0].networks[0], 'instagram');
  calls.length = 0;
  await useRrssStore.getState().nextPage('token');
  assert.match(calls.find(({ url }) => url.includes('/rrss/items'))!.url, /cursor=c1&limit=20|limit=20.*cursor=c1|cursor=c1.*limit=20/);
  assert.equal(useRrssStore.getState().page, 2);
  calls.length = 0;
  await useRrssStore.getState().previousPage('token');
  assert.doesNotMatch(calls.find(({ url }) => url.includes('/rrss/items'))!.url, /cursor=/);
  assert.equal(useRrssStore.getState().page, 1);
});

test('generating a social plan saves the inputs before creating the generate_rrss_plan job', async () => {
  const calls = recordFetch(({ url, body }) => url.endsWith('/rrss-plan-inputs') ? jsonResponse(body) : jsonResponse({ job: { id: 'job-plan', client_id: 'client-a', kind: 'generate_rrss_plan', status: 'pending', target_id: null }, replayed: false }, 202));
  useRrssStore.getState().reset('client-a');
  const inputs = { topic: 'Verano', keywords: ['playa'], networks: ['gmb', 'instagram'], postsPerWeek: 3, weeksHorizon: 4 };
  await useRrssStore.getState().generatePlan('token', inputs);
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), ['PUT /api/clients/client-a/rrss-plan-inputs', 'POST /api/content/jobs']);
  assert.deepEqual(calls[0].body, inputs);
  assert.equal(calls[1].body.kind, 'generate_rrss_plan');
  assert.equal(calls[1].body.clientId, 'client-a');
  assert.ok(calls[1].body.idempotencyKey);
  assert.equal(useRrssStore.getState().jobs[0]?.id, 'job-plan');
});

test('generating a social plan creates no job when saving the inputs fails', async () => {
  const calls = recordFetch(() => jsonResponse({ error: 'Elige al menos una red social', code: 'INVALID_PAYLOAD' }, 400));
  useRrssStore.getState().reset('client-a');
  await assert.rejects(() => useRrssStore.getState().generatePlan('token', { topic: 'Verano', keywords: [], networks: [], postsPerWeek: 3, weeksHorizon: 4 }), /Elige al menos una red social/);
  assert.deepEqual(calls.map(({ method }) => method), ['PUT']);
  assert.equal(useRrssStore.getState().jobs.length, 0);
});

test('generating posts sends the selected accounts and the AI image choice for the idea', async () => {
  const calls = recordFetch(() => jsonResponse({ job: { id: 'job-rrss', client_id: 'client-a', kind: 'generate_rrss', status: 'pending', target_id: 'item-1' }, replayed: false }, 202));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ items: [{ ...IDEA_ROW, clientId: 'client-a', socialPosts: [], plannedAt: null, version: 3, status: 'approved' } as any] });
  await useRrssStore.getState().generatePosts('token', 'item-1', { accountIds: ['account-ig', 'account-gmb'], generateImage: false });
  assert.equal(calls[0].url, '/api/content/jobs');
  assert.equal(calls[0].body.kind, 'generate_rrss');
  assert.equal(calls[0].body.targetId, 'item-1');
  assert.equal(calls[0].body.expectedVersion, 3);
  assert.deepEqual(calls[0].body.payload, { accountIds: ['account-ig', 'account-gmb'], generateImage: false });
  const idea = useRrssStore.getState().items[0];
  assert.equal(idea.status, 'generating', 'mirrors the server: the idea moves to generating');
  assert.equal(idea.version, 4);
});

test('uploading a creative posts FormData (not JSON) to the media endpoint and stores the updated draft', async () => {
  const calls = recordFetch(() => jsonResponse({ socialPost: { ...post(), media: [...post().media, { url: 'https://postiz.example/x.jpg', type: 'image', name: 'x.jpg' }], version: 5, plan_item_id: 'item-1' } }));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ socialPosts: [post()] });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' });
  await useRrssStore.getState().uploadFiles('token', 'post-1', [file]);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, '/api/social-posts/post-1/media');
  assert.ok(calls[0].body instanceof FormData);
  assert.equal(((calls[0].body as FormData).get('file') as File).name, 'x.jpg');
  assert.equal(calls[0].headers.get('content-type'), null, 'the browser sets the multipart boundary itself');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer token');
  assert.equal(useRrssStore.getState().socialPosts[0].media.length, 4);
  assert.deepEqual(useRrssStore.getState().uploads['post-1'] ?? [], []);
});

test('invalid creatives are refused client-side, per file, without calling the API', async () => {
  const calls = recordFetch(() => jsonResponse({ socialPost: post() }));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ socialPosts: [post()] });
  const gif = new File([new Uint8Array([1])], 'anim.gif', { type: 'image/gif' });
  await useRrssStore.getState().uploadFiles('token', 'post-1', [gif]);
  assert.equal(calls.length, 0);
  const entries = useRrssStore.getState().uploads['post-1'];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'anim.gif');
  assert.equal(entries[0].status, 'error');
  assert.match(entries[0].error!, /Formato no admitido/);
});

test('removing and reordering media send a PATCH with the new array and the expected version', async () => {
  const calls = recordFetch(({ body }) => jsonResponse({ socialPost: { ...post(), media: body.media, version: 5 } }));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ socialPosts: [post()] });
  const [a, b, c] = post().media;
  await useRrssStore.getState().moveMedia('token', 'post-1', 0, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, '/api/social-posts/post-1');
  assert.deepEqual(calls[0].body, { media: [b, a, c], expectedVersion: 4 });
  await useRrssStore.getState().removeMedia('token', 'post-1', 2);
  assert.deepEqual(calls[1].body, { media: [b, a], expectedVersion: 5 });
  assert.deepEqual(useRrssStore.getState().socialPosts[0].media, [b, a]);
});

test('saving the copy sends a PATCH with only the copy', async () => {
  const calls = recordFetch(({ body }) => jsonResponse({ socialPost: { ...post(), copy: body.copy, version: 5 } }));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ socialPosts: [post({ status: 'approved' })] });
  await useRrssStore.getState().saveCopy('token', 'post-1', 'Nuevo copy');
  assert.deepEqual(calls[0].body, { copy: 'Nuevo copy', expectedVersion: 4 });
  assert.equal(useRrssStore.getState().socialPosts[0].copy, 'Nuevo copy');
});

test('scheduling a draft sends the date, the optional URL, its version and a stable idempotency key', async () => {
  const calls = recordFetch(() => jsonResponse({ socialPost: { ...post(), status: 'scheduled', publication_id: 'pub-1', version: 5 }, publication: { id: 'pub-1', status: 'pending', confirmed_scheduled_at: null }, job: { id: 'job-publish', kind: 'publish', status: 'pending', target_id: 'pub-1' }, replayed: false }, 202));
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ socialPosts: [post({ status: 'approved' })] });
  await useRrssStore.getState().schedulePost('token', 'post-1', { desiredScheduledAt: '2026-10-20T09:00:00.000Z', externalUrl: 'https://example.com' });
  assert.equal(calls[0].url, '/api/social-posts/post-1/schedule');
  assert.equal(calls[0].body.desiredScheduledAt, '2026-10-20T09:00:00.000Z');
  assert.equal(calls[0].body.externalUrl, 'https://example.com');
  assert.equal(calls[0].body.expectedVersion, 4);
  assert.match(calls[0].body.idempotencyKey, /post-1/);
  const stored = useRrssStore.getState().socialPosts[0];
  assert.equal(stored.status, 'scheduled');
  assert.equal(stored.publicationStatus, 'pending');
  assert.equal(useRrssStore.getState().jobs[0]?.id, 'job-publish');

  useRrssStore.setState({ socialPosts: [post({ status: 'approved' })] });
  await useRrssStore.getState().schedulePost('token', 'post-1', { desiredScheduledAt: '2026-10-20T09:00:00.000Z' });
  assert.equal(calls[1].body.idempotencyKey, calls[0].body.idempotencyKey.replace('https://example.com', ''), 'the key only depends on the request');
  assert.equal('externalUrl' in calls[1].body, false);
});

test('drafts of the open idea are refetched once its generate_rrss job settles', async () => {
  const calls = recordFetch(({ url }) => {
    if (url === '/api/content/jobs/job-rrss') return jsonResponse({ job: { id: 'job-rrss', client_id: 'client-a', kind: 'generate_rrss', status: 'succeeded', target_id: 'item-1' } });
    if (url === '/api/content/plan-items/item-1/social-posts') return jsonResponse({ socialPosts: [{ ...post(), plan_item_id: 'item-1' }] });
    return jsonResponse({ items: [], next_cursor: null });
  });
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ selectedId: 'item-1', jobs: [{ id: 'job-rrss', clientId: 'client-a', kind: 'generate_rrss', status: 'running', targetId: 'item-1' }] as any });
  await useRrssStore.getState().pollJobs('token');
  assert.equal(useRrssStore.getState().jobs[0].status, 'succeeded');
  assert.ok(calls.some(({ url }) => url === '/api/content/plan-items/item-1/social-posts'));
  assert.equal(useRrssStore.getState().socialPosts[0]?.id, 'post-1');

  calls.length = 0;
  useRrssStore.setState({ selectedId: 'item-1', jobs: [{ id: 'job-rrss', clientId: 'client-a', kind: 'generate_rrss', status: 'running', targetId: 'item-other' }] as any });
  await useRrssStore.getState().pollJobs('token');
  assert.ok(!calls.some(({ url }) => url.includes('/social-posts')), 'jobs for other ideas do not refetch the open drafts');
});

test('a settled generate_rrss_plan job refreshes the ideas list', async () => {
  const calls = recordFetch(({ url }) => {
    if (url === '/api/content/jobs/job-plan') return jsonResponse({ job: { id: 'job-plan', client_id: 'client-a', kind: 'generate_rrss_plan', status: 'succeeded', target_id: null } });
    if (url.includes('/rrss/items')) return jsonResponse({ items: [IDEA_ROW], next_cursor: null });
    return jsonResponse({ items: [], next_cursor: null });
  });
  useRrssStore.getState().reset('client-a');
  useRrssStore.setState({ jobs: [{ id: 'job-plan', clientId: 'client-a', kind: 'generate_rrss_plan', status: 'running', targetId: null }] as any });
  const refreshed = await useRrssStore.getState().pollJobs('token');
  assert.equal(refreshed, true);
  assert.ok(calls.some(({ url }) => url.includes('/rrss/items')));
  assert.equal(useRrssStore.getState().items[0]?.id, 'item-1');
});

// ---------------------------------------------------------------------------
// Static render

const client: Client = {
  id: 'client-a', slug: 'client-a', name: 'Cliente A', logo: '', health: 70, industry: 'Moda',
  metrics: {
    revenue: { label: 'Ingresos', value: '1.000 €', change: 0, trend: 'neutral' },
    roas: { label: 'ROAS', value: '2x', change: 0, trend: 'neutral' },
    conversions: { label: 'Conversiones', value: '12', change: 0, trend: 'neutral' },
    cpa: { label: 'CPA', value: '10 €', change: 0, trend: 'neutral' },
  },
  kpiThresholds: {} as Client['kpiThresholds'],
};

test('the RRSS tab renders both sections with «Publicaciones» selected by default', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ConfirmProvider, null, createElement(RrssTab, { client }))));
  assert.match(html, /role="tablist"/);
  assert.match(html, /Publicaciones/);
  assert.match(html, /Planificación mensual/);
  assert.match(html, /aria-selected="true"[^>]*>Publicaciones/);
  assert.match(html, /Plan RRSS editable/, 'the monthly operational sheet is still rendered');
  assert.ok(html.indexOf('Ideas de redes') >= 0, 'the publications section lists ideas');
});

test('the toolbar shows plan and idea actions to admins only, gated by readiness', () => {
  const render = (props: Partial<Parameters<typeof RrssToolbar>[0]>) => renderToStaticMarkup(createElement(RrssToolbar, { admin: true, readiness: READY, isRefreshing: false, lastUpdatedAt: '2026-10-01T10:11:12.000Z', onGeneratePlan: () => {}, onNewIdea: () => {}, onRefresh: () => {}, ...props }));
  const ready = render({});
  assert.match(ready, /Generar plan de redes/);
  assert.match(ready, /Nueva idea/);
  assert.match(ready, /Actualizado \d\d:\d\d:\d\d/);
  assert.match(ready, /aria-label="Actualizar publicaciones"/);
  const planButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Generar plan de redes/)![0];
  assert.doesNotMatch(planButton(ready), /disabled=""/);
  const unbound = render({ readiness: { ...READY, jobs: { ...READY.jobs, generate_rrss_plan: false } } });
  assert.match(planButton(unbound), /disabled=""/);
  assert.match(planButton(unbound), /title="El workflow de plan de redes no está configurado para este cliente"/);
  assert.match(planButton(render({ readiness: null })), /disabled=""/, 'unknown readiness keeps the action disabled');
  const viewer = render({ admin: false });
  assert.doesNotMatch(viewer, /Generar plan de redes/);
  assert.doesNotMatch(viewer, /Nueva idea/);
  assert.match(viewer, /Actualizar publicaciones/);
});

test('a draft card renders the copy with a counter, media thumbnails and the actions for its status', () => {
  const handlers = { onSaveCopy: () => {}, onRemoveMedia: () => {}, onMoveMedia: () => {}, onUpload: () => {}, onApprove: () => {}, onDiscard: () => {}, onSchedule: () => {} };
  const html = renderToStaticMarkup(createElement(SocialPostCard, { post: post(), admin: true, canPublish: true, busy: false, uploads: [], ...handlers }));
  assert.match(html, /Instagram/);
  assert.match(html, /Instagram Inficon/);
  assert.match(html, /Revisión/);
  assert.match(html, /<textarea[^>]*>Copy del post<\/textarea>/);
  assert.match(html, /13 \/ 2200/);
  assert.match(html, /Guardar texto/);
  assert.match(html, /<img[^>]*src="https:\/\/cdn.example\/a.jpg"/);
  assert.match(html, /<video[^>]*src="https:\/\/cdn.example\/b.mp4"[^>]*muted|<video[^>]*muted[^>]*src="https:\/\/cdn.example\/b.mp4"/);
  assert.match(html, /Quitar/);
  assert.match(html, /aria-label="Mover a la izquierda/);
  assert.match(html, /Subir creatividad/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/quicktime"/);
  assert.match(html, /multiple/);
  assert.match(html, />Aprobar</);
  assert.match(html, /Descartar/);
  assert.doesNotMatch(html, />Programar</, 'a draft in review cannot be scheduled yet');

  const approved = renderToStaticMarkup(createElement(SocialPostCard, { post: post({ status: 'approved' }), admin: true, canPublish: true, busy: false, uploads: [], ...handlers }));
  assert.match(approved, />Programar</);
  assert.doesNotMatch(approved, />Aprobar</);
  const cancelled = renderToStaticMarkup(createElement(SocialPostCard, { post: post({ status: 'scheduled', publicationStatus: 'cancelled' }), admin: true, canPublish: true, busy: false, uploads: [], ...handlers }));
  assert.match(cancelled, /Cancelado/);
  assert.match(cancelled, />Programar</);
  assert.doesNotMatch(cancelled, /Subir creatividad/, 'scheduled drafts are read-only');
  const viewer = renderToStaticMarkup(createElement(SocialPostCard, { post: post({ status: 'approved' }), admin: false, canPublish: true, busy: false, uploads: [], ...handlers }));
  assert.doesNotMatch(viewer, /Guardar texto|Subir creatividad|>Programar<|Quitar/);
  const uploading = renderToStaticMarkup(createElement(SocialPostCard, { post: post(), admin: true, canPublish: true, busy: false, uploads: [{ key: 'u1', name: 'clip.mp4', status: 'uploading' }, { key: 'u2', name: 'anim.gif', status: 'error', error: 'Formato no admitido' }], ...handlers }));
  assert.match(uploading, /clip\.mp4/);
  assert.match(uploading, /animate-spin/);
  assert.match(uploading, /anim\.gif[\s\S]*Formato no admitido/);
});

test('the idea badge follows its drafts: published beats scheduled beats the idea status', () => {
  assert.equal(rrssIdeaDisplayStatus('review', []), 'review');
  assert.equal(rrssIdeaDisplayStatus('review', [{ status: 'review' }, { status: 'approved' }]), 'review');
  assert.equal(rrssIdeaDisplayStatus('review', [{ status: 'review' }, { status: 'scheduled', publicationStatus: 'scheduled' }]), 'scheduled');
  assert.equal(rrssIdeaDisplayStatus('review', [{ status: 'scheduled' }]), 'scheduled', 'list summaries may lack the publication status');
  assert.equal(rrssIdeaDisplayStatus('review', [{ status: 'scheduled', publicationStatus: 'scheduled' }, { status: 'scheduled', publicationStatus: 'published' }]), 'published');
  assert.equal(rrssIdeaDisplayStatus('review', [{ status: 'scheduled', publicationStatus: 'cancelled' }]), 'review', 'a cancelled publication does not keep the idea scheduled');
  assert.equal(rrssIdeaDisplayStatus('approved', [{ status: 'discarded' }]), 'approved');
});

test('the idea header and the ideas list both badge the derived status', () => {
  const panel = readFileSync('src/components/rrss/RrssIdeaPanel.tsx', 'utf8');
  const list = readFileSync('src/components/rrss/RrssPostsSection.tsx', 'utf8');
  assert.match(panel, /ContentStatusBadge status=\{rrssIdeaDisplayStatus\(idea\.status, socialPosts\)\}/);
  assert.match(list, /ContentStatusBadge status=\{rrssIdeaDisplayStatus\(item\.status, item\.socialPosts\)\}/);
});
