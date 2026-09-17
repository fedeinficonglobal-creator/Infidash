import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentStatusBadge } from '../src/components/content/ContentStatusBadge.tsx';
import { filterItems, monthDays, plainTextPreview } from '../src/lib/content.ts';
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
  useContentStore.setState({ isLoading: false, isRefreshing: false });
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
  assert.equal(calls, 2);
  useContentStore.setState({ isRefreshing: true });
  await useContentStore.getState().refresh('token');
  assert.equal(calls, 2);
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
  assert.match(listUrl,/limit=100/);
});

test('scheduling uses a stable idempotency key and stores publication plus job', async () => {
  let requestBody:any=null;
  globalThis.fetch=async(_input,init)=>{
    requestBody=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({publication:{id:'publication-1',client_id:'client-a',content_id:'content-1',account_id:'account-1',account_label:'Postiz',provider:'postiz',platform:'gmb',copy:null,status:'pending',desired_scheduled_at:'2026-10-01T09:00:00.000Z',confirmed_scheduled_at:null,external_url:null,published_at:null,last_synced_at:null,error_message:null,version:1,created_at:'2026-09-16T10:00:00.000Z',updated_at:'2026-09-16T10:00:00.000Z'},job:{id:'job-1',client_id:'client-a',kind:'publish',status:'pending',target_id:'publication-1',last_error:null,created_at:'2026-09-16T10:00:00.000Z',updated_at:'2026-09-16T10:00:00.000Z'},replayed:false}),{status:202,headers:{'content-type':'application/json'}});
  };
  const input={contentId:'content-1',clientId:'client-a',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z'};
  await useContentStore.getState().schedulePublication('token',input);
  assert.equal(requestBody.idempotencyKey,'schedule:content-1:3:account-1:2026-10-01T09:00:00.000Z');
  assert.equal(useContentStore.getState().publications[0].id,'publication-1');
  assert.equal(useContentStore.getState().jobs[0].id,'job-1');
});
