import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ContentStatusBadge } from '../src/components/content/ContentStatusBadge.tsx';
import { readFileSync } from 'node:fs';
import { canCancelPublication, canReschedulePublication, canRunJob, displayPublications, displayStatus, contentRefreshDelayMs, filterItems, jobsForTimeline, monthDays, plainTextPreview, planItemActions, splitPlanInputs, timestampedIdempotencyKey } from '../src/lib/content.ts';
import { GeneratePlanDialog } from '../src/components/content/ContentTab.tsx';
import { camelize } from '../src/services/contentApi.ts';
import { useContentStore } from '../src/store/useContentStore.ts';
import type { PlanItem } from '../src/services/contentApi.ts';

const originalFetch = globalThis.fetch;

function item(input: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'item-1', clientId: 'client-a', calendarId: 'calendar-a', calendarTitle: 'Octubre', title: 'Guía de bombas', theme: 'Industria', rationale: null,
    format: 'blog', keywordPrimary: 'bombas industriales', keywords: [], entities: [], cta: null, priority: null, plannedAt: '2026-10-12T08:00:00.000Z',
    status: 'proposed', version: 1, createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z', contentId: null,
    contentStatus: null, contentTitle: null, contentVersion: null, publications: [], ...input,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  useContentStore.getState().reset();
  useContentStore.setState({ view: 'list', isLoading: false, isRefreshing: false });
});

test('content helpers filter by client, status, format and normalized search', () => {
  const items = [item(), item({ id: 'item-2', clientId: 'client-b', title: 'Caso real', status: 'review', format: 'linkedin' })];
  assert.deepEqual(filterItems(items, { clientId: 'client-a', status: 'proposed', format: 'blog', search: 'BOMBAS' }).map(({ id }) => id), ['item-1']);
  assert.equal(monthDays(new Date('2026-02-15T12:00:00Z')).length % 7, 0);
});

test('safe preview returns text and never injects markup', () => {
  const preview = plainTextPreview('<h1>Hola</h1><script>alert(1)</script><p>Mundo &amp; equipo</p>', null);
  assert.equal(preview.includes('<script>'), false);
  assert.equal(preview.includes('alert(1)'), false);
  assert.match(preview, /Hola/);
  assert.match(preview, /Mundo/);
});

test('API normalization maps PostgreSQL rows recursively to the typed UI contract', () => {
  assert.deepEqual(camelize({ client_id: 'a', nested_rows: [{ desired_scheduled_at: 'date' }] }), { clientId: 'a', nestedRows: [{ desiredScheduledAt: 'date' }] });
});

test('status badge includes readable text in addition to color and icon', () => {
  const html = renderToStaticMarkup(ContentStatusBadge({ status: 'generation_failed' }));
  assert.match(html, /Error de generación/);
  assert.match(html, /svg/);
});

test('content store loads summary and rows and prevents overlapping refreshes', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    return new Response(JSON.stringify(url.includes('/summary') ? { summary: { plan_items: { proposed: 1 }, contents: {}, publications: {}, incidents: 0 } } : { items: [{ ...item(), client_id: 'client-a', calendar_id: 'calendar-a', calendar_title: 'Octubre', planned_at: null, created_at: item().createdAt, updated_at: item().updatedAt }], next_cursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await useContentStore.getState().load('token');
  assert.equal(useContentStore.getState().items[0].clientId, 'client-a');
  assert.equal(useContentStore.getState().summary?.planItems.proposed, 1);
  assert.equal(calls, 3);
  useContentStore.setState({ isRefreshing: true });
  await useContentStore.getState().refresh('token');
  assert.equal(calls, 3);
});

test('editorial timeline includes jobs targeting publications attached to the plan item', () => {
  const job = (id: string, targetId: string | null) => ({ id, clientId: 'client-a', kind: 'publish' as const, status: 'succeeded', targetId, lastError: null, createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z' });
  assert.deepEqual(jobsForTimeline([job('publish-job', 'publication-1'), job('other-job', 'publication-2'), job('content-job', 'content-1'), job('no-target', null)], 'plan-1', 'content-1', ['publication-1']).map(({ id }) => id), ['publish-job', 'content-job']);
});

test('publication actions only offer cancel or reschedule in supported states', () => {
  assert.equal(canCancelPublication('scheduled'), true);
  assert.equal(canCancelPublication('cancel_requested'), false);
  assert.equal(canCancelPublication('published'), false);
  assert.equal(canReschedulePublication('scheduled'), true);
  assert.equal(canReschedulePublication('pending'), false);
  assert.equal(canReschedulePublication('unknown'), false);
});

test('content store restores durable job status after a browser reload', async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); urls.push(url);
    const payload = url.includes('/summary') ? { summary: { plan_items: {}, contents: {}, publications: {}, incidents: 0 } }
      : url.includes('/jobs') ? { items: [{ id: 'job-7', client_id: 'client-a', kind: 'generate_plan', status: 'running', target_id: null, last_error: null, created_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:00:00Z' }], next_cursor: null }
      : { items: [], next_cursor: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  useContentStore.getState().reset('client-a');
  await useContentStore.getState().load('token');
  assert.ok(urls.some((url) => url.includes('/content/jobs') && url.includes('clientId=client-a')));
  assert.equal(useContentStore.getState().jobs[0]?.id, 'job-7');
});

test('content store creates a calendar for the selected client and makes it selectable', async () => {
  let posted: any = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/clients/client-a/editorial-calendars');
    posted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ calendar: { id: 'calendar-new', client_id: 'client-a', title: posted.title, status: 'draft', start_date: null, end_date: null } }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const created = await useContentStore.getState().createCalendar('token', 'client-a', { title: 'Octubre' });
  assert.equal(posted.title, 'Octubre');
  assert.equal(created.id, 'calendar-new');
  assert.equal(useContentStore.getState().calendars[0]?.id, 'calendar-new');
});

test('content store sends status, format and search before server pagination', async () => {
  const urls:string[]=[];
  globalThis.fetch=async(input)=>{
    const url=String(input); urls.push(url);
    return new Response(JSON.stringify(url.includes('/summary')?{summary:{plan_items:{},contents:{},publications:{},incidents:0}}:{items:[],next_cursor:null}),{status:200,headers:{'content-type':'application/json'}});
  };
  useContentStore.setState({filters:{clientId:'client-a',status:'review',format:'blog',search:'bombas'}});
  await useContentStore.getState().load('token');
  const listUrl=urls.find((url)=>url.includes('/plan-items'))!;
  assert.match(listUrl,/status=review/);
  assert.match(listUrl,/format=blog/);
  assert.match(listUrl,/search=bombas/);
  assert.match(listUrl,/limit=20/);
});

test('late load-more response cannot append rows from a previous client filter', async () => {
  let releaseOldPage!: (response: Response) => void;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('cursor=old-page')) return new Promise<Response>((resolve) => { releaseOldPage = resolve; });
    if (url.includes('/summary')) return new Response(JSON.stringify({ summary: { plan_items: {}, contents: {}, publications: {}, incidents: 0 } }), { status: 200 });
    const clientId = new URL(url, 'http://localhost').searchParams.get('clientId');
    return new Response(JSON.stringify({ items: [{ ...item({ id: `item-${clientId}`, clientId }), client_id: clientId, calendar_id: 'calendar-a', calendar_title: 'Octubre', planned_at: null, created_at: item().createdAt, updated_at: item().updatedAt }], next_cursor: clientId === 'client-a' ? 'old-page' : null }), { status: 200 });
  };
  useContentStore.setState({ view: 'calendar', filters: { clientId: 'client-a', status: '', format: '', search: '' } });
  await useContentStore.getState().load('token');
  const oldPage = useContentStore.getState().loadMore('token');
  useContentStore.getState().setFilters({ clientId: 'client-b' });
  await useContentStore.getState().load('token');
  releaseOldPage(new Response(JSON.stringify({ items: [{ ...item({ id: 'stale-a', clientId: 'client-a' }), client_id: 'client-a', calendar_id: 'calendar-a', calendar_title: 'Octubre', planned_at: null, created_at: item().createdAt, updated_at: item().updatedAt }], next_cursor: null }), { status: 200 }));
  await oldPage;
  assert.deepEqual(useContentStore.getState().items.map(({ id }) => id), ['item-client-b']);
});

test('scheduling uses a stable idempotency key and stores publication plus job', async () => {
  let requestBody:any=null;
  globalThis.fetch=async(_input,init)=>{
    requestBody=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({publication:{id:'publication-1',client_id:'client-a',content_id:'content-1',account_id:'account-1',account_label:'Postiz',provider:'postiz',platform:'gmb',copy:null,status:'pending',desired_scheduled_at:'2026-10-01T09:00:00.000Z',confirmed_scheduled_at:null,external_url:null,published_at:null,last_synced_at:null,error_message:null,version:1,created_at:'2026-09-16T10:00:00.000Z',updated_at:'2026-09-16T10:00:00.000Z'},job:{id:'job-1',client_id:'client-a',kind:'publish',status:'pending',target_id:'publication-1',last_error:null,created_at:'2026-09-16T10:00:00.000Z',updated_at:'2026-09-16T10:00:00.000Z'},replayed:false}),{status:202,headers:{'content-type':'application/json'}});
  };
  const input={contentId:'content-1',clientId:'client-a',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',externalUrl:'https://example.com/article'};
  await useContentStore.getState().schedulePublication('token',input);
  assert.equal(requestBody.idempotencyKey,'schedule:content-1:3:account-1:2026-10-01T09:00:00.000Z:https://example.com/article');
  assert.equal(requestBody.externalUrl,'https://example.com/article');
  assert.equal(useContentStore.getState().publications[0].id,'publication-1');
  assert.equal(useContentStore.getState().jobs[0].id,'job-1');
});

test('admins can release a generation stuck in progress through the store', async () => {
  let request: { url: string; method?: string; body: any } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ plan_item: { ...item({ status: 'generation_failed', version: 6 }), client_id: 'client-a', calendar_id: 'calendar-a', planned_at: item().plannedAt } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  useContentStore.setState({ items: [item({ status: 'generating', version: 5 })] });
  await useContentStore.getState().releasePlanGeneration('token', 'item-1', 5);
  assert.deepEqual(request, { url: '/api/content/plan-items/item-1/release-generation', method: 'POST', body: { version: 5 } });
  assert.equal(useContentStore.getState().items[0].status, 'generation_failed');
  assert.equal(useContentStore.getState().items[0].version, 6);
});

test('a failed release surfaces the server conflict message', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Hay una generación en curso; espera a que termine o caduque', code: 'JOB_IN_PROGRESS' }), { status: 409, headers: { 'content-type': 'application/json' } });
  useContentStore.setState({ items: [item({ status: 'generating', version: 5 })] });
  await assert.rejects(() => useContentStore.getState().releasePlanGeneration('token', 'item-1', 5));
  assert.equal(useContentStore.getState().conflict, 'Hay una generación en curso; espera a que termine o caduque');
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('plan inputs load as plain string arrays that survive response camelization', async () => {
  let requested: string | null = null;
  globalThis.fetch = async (input) => { requested = String(input); return jsonResponse({ topic: 'Marketing local', keywords: ['seo_local', 'marketing'], competitors: ['foo.com'] }); };
  const inputs = await useContentStore.getState().loadPlanInputs('token', 'client-a');
  assert.equal(requested, '/api/clients/client-a/editorial-plan-inputs');
  assert.deepEqual(inputs, { topic: 'Marketing local', keywords: ['seo_local', 'marketing'], competitors: ['foo.com'] });
});

test('generating a plan saves the inputs before creating the generate_plan job', async () => {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith('/editorial-plan-inputs')) return jsonResponse({ topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] });
    return jsonResponse({ job: { id: 'job-plan', client_id: 'client-a', kind: 'generate_plan', status: 'pending', target_id: null, last_error: null, created_at: '2026-09-30T10:00:00.000Z', updated_at: '2026-09-30T10:00:00.000Z' }, replayed: false }, 202);
  };
  await useContentStore.getState().generatePlan('token', 'client-a', { topic: 'SEO', keywords: ['seo'], competitors: ['https://foo.com'] });
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), ['PUT /api/clients/client-a/editorial-plan-inputs', 'POST /api/content/jobs']);
  assert.deepEqual(calls[0].body, { topic: 'SEO', keywords: ['seo'], competitors: ['https://foo.com'] });
  assert.equal(calls[1].body.kind, 'generate_plan');
  assert.equal(calls[1].body.clientId, 'client-a');
  assert.equal(useContentStore.getState().jobs[0]?.id, 'job-plan');
  assert.equal(useContentStore.getState().isSaving, false);
});

test('generating a plan does not create the job when saving the inputs fails', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    return jsonResponse({ error: 'Añade al menos un competidor', code: 'INVALID_PAYLOAD' }, 400);
  };
  await assert.rejects(() => useContentStore.getState().generatePlan('token', 'client-a', { topic: 'SEO', keywords: ['seo'], competitors: [] }), /Añade al menos un competidor/);
  assert.deepEqual(calls, ['PUT /api/clients/client-a/editorial-plan-inputs']);
  assert.equal(useContentStore.getState().jobs.length, 0);
  assert.equal(useContentStore.getState().isSaving, false);
});

test('plan input text splits keywords on lines and commas and competitors on lines only', () => {
  assert.deepEqual(splitPlanInputs(' seo local, marketing\n\n  sem ,', { commas: true }), ['seo local', 'marketing', 'sem']);
  assert.deepEqual(splitPlanInputs('https://foo.com/?a=1,2\r\n\nbar.es  ', { commas: false }), ['https://foo.com/?a=1,2', 'bar.es']);
});

test('the generate plan dialog asks for a topic, keywords and competitors with cancel and submit actions', () => {
  const html = renderToStaticMarkup(createElement(GeneratePlanDialog, { clientId: 'client-a', onClose: () => {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /Tema/);
  assert.ok(html.indexOf('Tema') < html.indexOf('Keywords'), 'the topic field comes before keywords');
  assert.match(html, /<input[^>]*required/, 'the topic input is required');
  assert.match(html, /tema define el enfoque del plan/i);
  assert.match(html, /Keywords/);
  assert.match(html, /Competidores/);
  assert.match(html, /competidores se analizan/i);
  assert.match(html, /Cancelar/);
  assert.match(html, /Generar plan/);
});

test('editorial readiness is loaded per client and gates job-creating actions', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), '/api/clients/client-a/editorial-readiness');
    return new Response(JSON.stringify({ enabled: true, jobs: { generate_plan: true, generate_content: true, publish: true, reschedule: false, cancel: false, reconcile: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await useContentStore.getState().loadReadiness('token', 'client-a');
  const readiness = useContentStore.getState().readinessByClient['client-a'];
  assert.equal(canRunJob(readiness, 'generate_plan'), true, 'multi-word job kinds survive response camelization');
  assert.equal(canRunJob(readiness, 'generate_content'), true);
  assert.equal(canRunJob(readiness, 'publish'), true);
  assert.equal(canRunJob(readiness, 'cancel'), false);
  assert.equal(canRunJob(readiness, 'reschedule'), false);
  assert.equal(canRunJob(undefined, 'generate_content'), false, 'unknown readiness hides the action');
  assert.equal(canRunJob({ enabled: false, jobs: { ...readiness!.jobs } }, 'publish'), false);
});

test('plan item actions offer «Marcar como fallida» only to admins while generating, and hide unbound job actions', () => {
  const ready = { enabled: true, jobs: { generate_plan: true, generate_content: true, publish: true, reschedule: false, cancel: false, reconcile: true } };
  assert.deepEqual(planItemActions(item({ status: 'generating' }), { admin: true, readiness: undefined }), { generateContent: false, generateContentEnabled: false, releaseGeneration: true });
  assert.deepEqual(planItemActions(item({ status: 'generation_failed' }), { admin: true, readiness: ready }), { generateContent: true, generateContentEnabled: true, releaseGeneration: false });
  assert.deepEqual(planItemActions(item({ status: 'proposed' }), { admin: true, readiness: ready }), { generateContent: true, generateContentEnabled: false, releaseGeneration: false });
  assert.deepEqual(planItemActions(item({ status: 'generating' }), { admin: false, readiness: ready }), { generateContent: false, generateContentEnabled: false, releaseGeneration: false });
  const tab = readFileSync(new URL('../src/components/content/ContentTab.tsx', import.meta.url), 'utf8');
  assert.match(tab, /Marcar como fallida/);
  assert.match(tab, /borrador en WordPress/);
  for (const kind of ['publish', 'cancel', 'reschedule']) assert.ok(tab.includes(`canRunJob(readiness, '${kind}')`), `${kind} actions are gated by readiness`);
});

test('manual reconciliations get a fresh idempotency key so a failed reconcile can be retried', () => {
  assert.notEqual(timestampedIdempotencyKey('reconcile:job-1', 1), timestampedIdempotencyKey('reconcile:job-1', 2));
  assert.equal(timestampedIdempotencyKey('reconcile:job-1', 42), 'reconcile:job-1:42');
  const panel = readFileSync(new URL('../src/components/content/EditorialJobsPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /idempotencyKey: `reconcile:\$\{job\.id\}`/);
  assert.match(panel, /timestampedIdempotencyKey\(`reconcile:\$\{job\.id\}`\)/);
});

test('content auto-refresh polls fast only while a job is in flight', () => {
  const job = (status: string) => ({ status }) as any;
  assert.equal(contentRefreshDelayMs([]), 300_000, 'idle screens refresh every 5 minutes');
  assert.equal(contentRefreshDelayMs([job('succeeded'), job('failed'), job('unknown')]), 300_000, 'settled or human-blocked jobs do not need fast polling');
  assert.equal(contentRefreshDelayMs([job('succeeded'), job('pending')]), 30_000);
  assert.equal(contentRefreshDelayMs([job('running')]), 30_000);
  const tab = readFileSync('src/components/content/ContentTab.tsx', 'utf8');
  assert.ok(tab.includes('contentRefreshDelayMs('), 'ContentTab schedules its refresh with the adaptive delay');
  assert.ok(!tab.includes('setInterval(() => void tick(), 30_000)'), 'the fixed 30s interval is gone');
});

test('an open publication refreshes once its cancel/publish job settles, without closing the popup', async () => {
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === '/api/content/jobs/job-cancel') return new Response(JSON.stringify({ job: { id: 'job-cancel', kind: 'cancel', status: 'succeeded', target_id: 'publication-1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/api/content/items/content-1/publications')) return new Response(JSON.stringify({ items: [{ id: 'publication-1', status: 'cancelled' }], next_cursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected request ${url}`);
  };
  useContentStore.setState({
    content: { id: 'content-1' } as any,
    publications: [{ id: 'publication-1', status: 'scheduled' }] as any,
    jobs: [{ id: 'job-cancel', kind: 'cancel', status: 'running', targetId: 'publication-1' }] as any,
  });
  await useContentStore.getState().pollJobs('token');
  assert.equal(useContentStore.getState().jobs[0].status, 'succeeded');
  assert.equal(useContentStore.getState().publications[0].status, 'cancelled', 'the popup shows the settled publication status');

  requested.length = 0;
  useContentStore.setState({ jobs: [{ id: 'job-cancel', kind: 'cancel', status: 'running', targetId: 'publication-other' }] as any });
  await useContentStore.getState().pollJobs('token');
  assert.ok(!requested.some((url) => url.includes('/publications')), 'jobs for publications outside the popup do not refetch it');
});

test('the list view loads every article regardless of date; the calendar view stays scoped to its month', async () => {
  const planItemUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('/api/content/plan-items')) planItemUrls.push(url);
    const body = url.startsWith('/api/content/summary') ? { summary: null } : { items: [], next_cursor: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  useContentStore.setState({ view: 'calendar' });
  await useContentStore.getState().load('token');
  assert.match(planItemUrls[0], /from=.*to=/, 'calendar requests its month range');
  useContentStore.getState().setView('list');
  await useContentStore.getState().load('token');
  assert.doesNotMatch(planItemUrls[1], /[?&](from|to)=/, 'list requests all dates');
  const tab = readFileSync('src/components/content/ContentTab.tsx', 'utf8');
  assert.ok(tab.includes("view === 'calendar' && <div className=\"inline-flex items-center gap-1"), 'the month selector only shows in calendar view');
});

function pagedFetch(planItemUrls: URL[]) {
  const nextByCursor: Record<string, string | null> = { '': 'cursor-2', 'cursor-2': 'cursor-3', 'cursor-3': null };
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/content/summary') return new Response(JSON.stringify({ summary: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname !== '/api/content/plan-items') return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    planItemUrls.push(url);
    const cursor = url.searchParams.get('cursor') ?? '';
    const row = { ...item({ id: `item-${cursor || 'first'}` }), client_id: 'client-a', calendar_id: 'calendar-a', calendar_title: 'Octubre', planned_at: null, created_at: item().createdAt, updated_at: item().updatedAt };
    return new Response(JSON.stringify({ items: [row], next_cursor: nextByCursor[cursor] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('the list view pages 20 articles at a time and «Anterior» returns to the exact previous page', async () => {
  const planItemUrls: URL[] = [];
  globalThis.fetch = pagedFetch(planItemUrls);
  const store = useContentStore.getState();
  await store.load('token');
  assert.equal(planItemUrls[0].searchParams.get('limit'), '20');
  assert.equal(planItemUrls[0].searchParams.get('cursor'), null);
  assert.equal(useContentStore.getState().page, 1);
  await useContentStore.getState().nextPage('token');
  assert.equal(planItemUrls[1].searchParams.get('cursor'), 'cursor-2');
  assert.equal(planItemUrls[1].searchParams.get('limit'), '20');
  assert.equal(useContentStore.getState().page, 2);
  await useContentStore.getState().nextPage('token');
  assert.equal(planItemUrls[2].searchParams.get('cursor'), 'cursor-3');
  assert.equal(useContentStore.getState().page, 3);
  assert.equal(useContentStore.getState().nextCursor, null);
  await useContentStore.getState().nextPage('token');
  assert.equal(planItemUrls.length, 3, 'no request past the last page');
  await useContentStore.getState().previousPage('token');
  assert.equal(planItemUrls[3].searchParams.get('cursor'), 'cursor-2');
  assert.equal(useContentStore.getState().page, 2);
  assert.deepEqual(useContentStore.getState().items.map(({ id }) => id), ['item-cursor-2'], 'the page replaces the rows instead of appending');
  await useContentStore.getState().previousPage('token');
  assert.equal(planItemUrls[4].searchParams.get('cursor'), null);
  assert.equal(useContentStore.getState().page, 1);
  await useContentStore.getState().previousPage('token');
  assert.equal(planItemUrls.length, 5, 'no request before the first page');
});

test('the background refresh reloads the current page instead of jumping back to page 1', async () => {
  const planItemUrls: URL[] = [];
  globalThis.fetch = pagedFetch(planItemUrls);
  await useContentStore.getState().load('token');
  await useContentStore.getState().nextPage('token');
  await useContentStore.getState().refresh('token');
  const refreshed = planItemUrls.at(-1)!;
  assert.equal(refreshed.searchParams.get('cursor'), 'cursor-2');
  assert.equal(refreshed.searchParams.get('limit'), '20');
  assert.equal(useContentStore.getState().page, 2);
  assert.equal(useContentStore.getState().nextCursor, 'cursor-3');
});

test('changing filters, view or client resets the list to page 1', async () => {
  const planItemUrls: URL[] = [];
  globalThis.fetch = pagedFetch(planItemUrls);
  await useContentStore.getState().load('token');
  await useContentStore.getState().nextPage('token');
  useContentStore.getState().setFilters({ status: 'review' });
  assert.equal(useContentStore.getState().page, 1);
  await useContentStore.getState().load('token');
  assert.equal(planItemUrls.at(-1)!.searchParams.get('cursor'), null);
  assert.equal(planItemUrls.at(-1)!.searchParams.get('status'), 'review');
  await useContentStore.getState().nextPage('token');
  useContentStore.getState().setView('calendar');
  assert.equal(useContentStore.getState().page, 1);
  useContentStore.getState().setView('list');
  await useContentStore.getState().nextPage('token');
  useContentStore.getState().reset('client-b');
  assert.equal(useContentStore.getState().page, 1);
});

test('the calendar view keeps loading its month 100 at a time without list pagination', async () => {
  const planItemUrls: URL[] = [];
  globalThis.fetch = pagedFetch(planItemUrls);
  useContentStore.setState({ view: 'calendar' });
  await useContentStore.getState().load('token');
  assert.equal(planItemUrls[0].searchParams.get('limit'), '100');
  assert.equal(planItemUrls[0].searchParams.get('cursor'), null);
  const tab = readFileSync('src/components/content/ContentTab.tsx', 'utf8');
  assert.ok(tab.includes('Cargar más contenidos del calendario'));
  assert.doesNotMatch(tab, /Cargar más contenidos</, 'the list view has no load-more button');
  assert.doesNotMatch(tab, /Cargar más</);
  assert.ok(tab.includes('Anterior') && tab.includes('Siguiente') && tab.includes('Página '), 'the list view has page controls');
});

test('display status reflects published and scheduled publications over the plan item status', () => {
  const pub = (status: string) => ({ status }) as PlanItem['publications'][number];
  assert.equal(displayStatus('ready', []), 'ready');
  assert.equal(displayStatus('review', [pub('scheduled')]), 'scheduled');
  assert.equal(displayStatus('ready', [pub('scheduled'), pub('published')]), 'published');
  assert.equal(displayStatus('ready', [pub('published'), pub('scheduled')]), 'published');
  for (const status of ['cancelled', 'failed', 'pending', 'sending', 'unknown', 'cancel_requested', 'draft']) assert.equal(displayStatus('ready', [pub(status)]), 'ready', `${status} does not override`);
  assert.equal(displayStatus('review', [pub('cancelled'), pub('scheduled')]), 'scheduled');
});

test('the popup header prefers the loaded detail publications for its own item and falls back to the list summary', () => {
  const summary = [{ id: 'publication-1', status: 'scheduled', desiredScheduledAt: null, confirmedScheduledAt: null }] as PlanItem['publications'];
  const listed = item({ contentId: 'content-1', status: 'ready', publications: summary });
  const detail = [{ status: 'cancelled' }];
  assert.equal(displayPublications(listed, { id: 'content-1' }, detail), detail);
  assert.equal(displayPublications(listed, { id: 'content-other' }, detail), summary);
  assert.equal(displayPublications(listed, null, detail), summary);
  assert.equal(displayPublications(item({ contentId: null, publications: summary }), null, detail), summary);
});

test('list, calendar and popup badges show the display status, while filters keep the real plan item status', () => {
  const tab = readFileSync('src/components/content/ContentTab.tsx', 'utf8');
  assert.equal(/<ContentStatusBadge status=\{item\.status\} \/>/.test(tab), false, 'no plan item badge shows the raw status');
  assert.ok((tab.match(/<ContentStatusBadge status=\{displayStatus\(item\.status, item\.publications\)\} \/>/g) ?? []).length >= 2, 'list row and calendar card use the display status');
  assert.match(tab, /<ContentStatusBadge status=\{displayStatus\(item\.status, displayPublications\(item, content, publications\)\)\} \/>/);
  assert.match(tab, /<ContentStatusBadge status=\{publication\.status\} \/>/, 'per-publication badges are unchanged');
});

test('approving content mirrors the server by moving its plan item from review to ready', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ content: { id: 'content-1', client_id: 'client-a', plan_item_id: 'item-1', status: 'approved', approved_revision_id: 'revision-3', version: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  useContentStore.setState({ items: [item({ contentId: 'content-1', status: 'review', version: 7 }), item({ id: 'item-2', contentId: 'content-2', status: 'review', version: 2 }), item({ id: 'item-3', contentId: 'content-1', status: 'generating', version: 4 })] });
  await useContentStore.getState().approveContent('token', 'content-1', 'revision-3', 4);
  const [approved, other, busy] = useContentStore.getState().items;
  assert.deepEqual([approved.status, approved.version], ['ready', 8]);
  assert.deepEqual([other.status, other.version], ['review', 2]);
  assert.deepEqual([busy.status, busy.version], ['generating', 4]);
});
