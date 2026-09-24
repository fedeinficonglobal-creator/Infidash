import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { EditorialApiRepository } from '../src/server/content/apiRepository.js';
import { ContentApiError, decodeCursor, encodeCursor, redactSecrets, requestHash } from '../src/server/content/contracts.js';
import { contentRoutes } from '../src/server/content/routes.js';
import { authenticateServiceToken, hashServiceToken, serviceCan } from '../src/server/content/serviceAuth.js';
import { assertPlanTransition, assertPublicationTransition } from '../src/server/content/transitions.js';
import type { Queryable } from '../src/server/content/repository.js';

test('contract helpers make stable hashes, bounded cursors and redact nested secrets', () => {
  assert.equal(requestHash({ b: 2, a: { d: 4, c: 3 } }), requestHash({ a: { c: 3, d: 4 }, b: 2 }));
  const cursor = encodeCursor({ at: '2026-09-15T10:00:00.000Z', id: 'row-1' });
  assert.deepEqual(decodeCursor(cursor), { at: '2026-09-15T10:00:00.000Z', id: 'row-1' });
  assert.throws(() => decodeCursor('not-a-cursor'), (error: any) => error.code === 'INVALID_CURSOR');
  assert.deepEqual(redactSecrets({ token: 'abc', nested: { password: 'secret', safe: 'ok' } }), { token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'ok' } });
});

test('state machines reject regressions and incompatible operations with 409', () => {
  assert.doesNotThrow(() => assertPlanTransition('approved', 'generating'));
  assert.throws(() => assertPlanTransition('proposed', 'ready'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION');
  assert.throws(() => assertPublicationTransition('published', 'scheduled'), (error: any) => error.statusCode === 409);
});

test('service tokens are hashed, scoped and restricted to their client allowlist', async () => {
  const plain = 'n8n-token-value';
  const tokenHash = hashServiceToken(plain);
  const fake: Queryable = {
    async query<T extends QueryResultRow>(sql: string) {
      const rows = sql.startsWith('SELECT') ? [{ id: 'service-1', name: 'dispatcher', token_hash: tokenHash, scopes: ['jobs:claim'], allowed_client_ids: ['client-a'] }] : [];
      return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows: rows as T[] } satisfies QueryResult<T>;
    },
  };
  const principal = await authenticateServiceToken(fake, plain);
  assert.ok(principal);
  assert.equal(serviceCan(principal!, 'jobs:claim', 'client-a'), true);
  assert.equal(serviceCan(principal!, 'jobs:result', 'client-a'), false);
  assert.equal(serviceCan(principal!, 'jobs:claim', 'client-b'), false);
});

function fakeRepository() {
  return {
    async summary() { return { planItems: { proposed: 2 }, contents: {}, publications: {}, incidents: 0 }; },
    async calendar() { return { items: [], nextCursor: null }; },
    async listCalendars() { return { items: [], nextCursor: null }; },
    async createCalendar(input: any) { return { id: 'calendar-1', ...input }; },
    async listPlanItems() { return { items: [], nextCursor: null }; },
    async getPlanItem() { return null; },
    async createPlanItem(input: any) { return { id: 'plan-1', version: 1, ...input }; },
    async patchPlanItem(_id: string, input: any) { if (input.version === 7) throw new ContentApiError(409, 'STALE_VERSION', 'conflict'); return input; },
    async getContent() { return null; },
    async patchContent() { return {}; },
    async approveContent() { return {}; },
    async createJob(input: any) { return { job: { id: 'job-1', ...input }, replayed: false }; },
    async getJob() { return null; },
    async listPublications() { return { items: [], nextCursor: null }; },
    async listPublishingAccounts() { return [{ id: 'account-1', client_id: 'client-a', label: 'Postiz', provider: 'postiz', active: true }]; },
    async schedulePublication(input: any) { return { publication: { id: 'publication-1', content_id: input.contentId, account_id: input.accountId, status: 'pending' }, job: { id: 'job-publish', status: 'pending' }, replayed: false }; },
    async claimJob(input: any) { return { id: 'job-1', client_id: input.clientId, leaseToken: 'lease-1' }; },
    async heartbeatJob() { return {}; },
    async finishJob() { return { job: { status: 'succeeded' }, replayed: false }; },
    async context() { return { settings: null, accounts: [], recentContents: [], planItems: [] }; },
    async recordEvent() { return { event: { id: 'event-1' }, replayed: false }; },
    async saveResearch() { return { id: 'research-1' }; },
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: fakeRepository() as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } } : null,
    authenticateService: (token: string) => token === 'service' ? { id: 'service-1', name: 'dispatcher', scopes: ['jobs:claim', 'jobs:result'], allowedClientIds: ['client-a'] } : null,
  });
  return app;
}

test('human content routes enforce read/write roles and return homogeneous conflicts', async () => {
  const app = await buildApp();
  const summary = await app.inject({ method: 'GET', url: '/api/content/summary', headers: { authorization: 'Bearer viewer' } });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().summary.planItems.proposed, 2);

  const forbidden = await app.inject({ method: 'POST', url: '/api/content/plan-items', headers: { authorization: 'Bearer viewer' }, payload: { clientId: 'client-a', calendarId: 'calendar-1', title: 'Tema' } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().code, 'FORBIDDEN');

  const conflict = await app.inject({ method: 'PATCH', url: '/api/content/plan-items/plan-1', headers: { authorization: 'Bearer admin' }, payload: { version: 7, title: 'Cambio' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'STALE_VERSION');
  await app.close();
});

test('internal routes enforce service scopes, client allowlists and schema version', async () => {
  const app = await buildApp();
  const denied = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/claim', headers: { authorization: 'Bearer service' }, payload: { clientId: 'client-b', executionId: 'run-1' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, 'SERVICE_FORBIDDEN');

  const claimed = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/claim', headers: { authorization: 'Bearer service' }, payload: { clientId: 'client-a', executionId: 'run-1', leaseSeconds: 90 } });
  assert.equal(claimed.statusCode, 200);
  assert.equal(claimed.json().job.leaseToken, 'lease-1');

  const invalidResult = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/job-1/result', headers: { authorization: 'Bearer service' }, payload: { clientId: 'client-a', schemaVersion: 2, leaseToken: 'lease-1', status: 'succeeded' } });
  assert.equal(invalidResult.statusCode, 400);
  assert.equal(invalidResult.json().code, 'UNSUPPORTED_SCHEMA_VERSION');
  await app.close();
});

test('authenticated viewers can list durable jobs without worker credentials or payloads', async () => {
  const app = Fastify({ logger: false });
  const repository = {
    ...fakeRepository(),
    async listJobs(filters: any) {
      assert.equal(filters.clientId, 'client-a');
      assert.equal(filters.limit, 25);
      return { items: [{ id: 'job-1', client_id: 'client-a', kind: 'generate_plan', status: 'running', attempt_count: 2 }], nextCursor: null };
    },
  };
  await app.register(contentRoutes, {
    repository: repository as any,
    resolveHumanSession: (token: string) => token === 'viewer' ? { user: { id: 'user-2', role: 'viewer', clientIds: ['client-a'] } } : null,
  });
  const unauthorized = await app.inject({ method: 'GET', url: '/api/content/jobs?clientId=client-a&limit=25' });
  const listed = await app.inject({ method: 'GET', url: '/api/content/jobs?clientId=client-a&limit=25', headers: { authorization: 'Bearer viewer' } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items[0].attempt_count, 2);
  await app.close();
});

test('job detail query excludes lease tokens and worker payloads', async () => {
  const statements: string[] = [];
  const pool = { query: async (sql: string) => { statements.push(sql); return { rows: [{ id: 'job-1', status: 'running' }] }; } } as unknown as Pool;
  const job = await new EditorialApiRepository(pool).getJob('job-1');
  assert.equal(job?.status, 'running');
  assert.doesNotMatch(statements[0], /SELECT\s+\*/i);
  assert.doesNotMatch(statements[0], /lease_token|payload|result|request_hash/i);
});

test('editorial lease routes preserve the 2700-second plan workflow heartbeat', async () => {
  const seen: number[] = [];
  const repository = {
    ...fakeRepository(),
    async claimJob(input: any) { seen.push(input.leaseSeconds); return { id: 'job-1', leaseToken: 'lease-1' }; },
    async heartbeatJob(_id: string, _clientId: string, _token: string, seconds: number) { seen.push(seconds); return { id: 'job-1' }; },
  };
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: repository as any,
    resolveHumanSession: () => null,
    authenticateService: () => ({ id: 'service-1', name: 'worker', scopes: ['jobs:claim', 'jobs:heartbeat'], allowedClientIds: ['client-a'] }),
  });
  const claim = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/claim', headers: { authorization: 'Bearer service' }, payload: { clientId: 'client-a', executionId: 'run-1', leaseSeconds: 2700 } });
  const heartbeat = await app.inject({ method: 'POST', url: '/api/internal/content/jobs/job-1/heartbeat', headers: { authorization: 'Bearer service' }, payload: { clientId: 'client-a', leaseToken: 'lease-1', leaseSeconds: 2700 } });
  assert.equal(claim.statusCode, 200);
  assert.equal(heartbeat.statusCode, 200);
  assert.deepEqual(seen, [2700, 2700]);
  await app.close();
});

test('admin can list accounts and atomically request a publication while viewer cannot', async () => {
  const app=await buildApp();
  const accounts=await app.inject({method:'GET',url:'/api/clients/client-a/publishing-accounts',headers:{authorization:'Bearer viewer'}});
  assert.equal(accounts.statusCode,200);
  assert.equal(accounts.json().accounts[0].id,'account-1');
  const payload={clientId:'client-a',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',idempotencyKey:'schedule:content-1:3:account-1:2026-10-01'};
  const forbidden=await app.inject({method:'POST',url:'/api/content/items/content-1/publications',headers:{authorization:'Bearer viewer'},payload});
  assert.equal(forbidden.statusCode,403);
  const scheduled=await app.inject({method:'POST',url:'/api/content/items/content-1/publications',headers:{authorization:'Bearer admin'},payload});
  assert.equal(scheduled.statusCode,202);
  assert.equal(scheduled.json().publication.status,'pending');
  assert.equal(scheduled.json().job.id,'job-publish');
  await app.close();
});

function poolWithClient(query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>) {
  const client={query,release(){}};
  return {connect:async()=>client,query} as unknown as Pool;
}

test('disabled clients cannot create or claim editorial jobs', async () => {
  const statements:string[]=[];
  const pool=poolWithClient(async(sql)=>{
    statements.push(sql);
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:false}],rowCount:1};
    if(sql.includes('SELECT j.* FROM editorial.jobs')) return {rows:[],rowCount:0};
    return {rows:[],rowCount:0};
  });
  const repository=new EditorialApiRepository(pool);
  await assert.rejects(()=>repository.createJob({clientId:'client-disabled',kind:'generate_plan',idempotencyKey:'disabled-1',payload:{}},'user-1'),(error:any)=>error.code==='EDITORIAL_DISABLED'&&error.statusCode===409);
  assert.equal(await repository.claimJob({leaseSeconds:60,executionId:'run-1'},['*']),null);
  assert.ok(statements.some((sql)=>sql.includes('JOIN editorial.client_settings settings')&&sql.includes('settings.enabled=TRUE')));
});

test('scheduling pins the approved revision and creates publication and job in one transaction', async () => {
  const statements:string[]=[];
  let publicationInsertValues:unknown[]=[];
  const pool=poolWithClient(async(sql,values=[])=>{
    statements.push(sql);
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.contents')) return {rows:[{id:'content-1',client_id:'client-a',version:3,status:'approved',approved_revision_id:'revision-2'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.publishing_accounts')) return {rows:[{id:'account-1',client_id:'client-a',active:true,platform:'blog',instance_key:'inficonglobal-gmb'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.jobs')) return {rows:[],rowCount:0};
    if(sql.includes('SELECT id FROM editorial.publications')) return {rows:[],rowCount:0};
    if(sql.includes('INSERT INTO editorial.publications')) { publicationInsertValues=values; return {rows:[{id:values[0],client_id:values[1],content_id:values[2],account_id:values[3],content_revision_id:values[5],external_url:values[9],status:'pending'}],rowCount:1}; }
    if(sql.includes('INSERT INTO editorial.jobs')) return {rows:[{id:values[0],client_id:values[1],kind:'publish',target_id:values[2],status:'pending'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  const repository=new EditorialApiRepository(pool);
  const result=await repository.schedulePublication({clientId:'client-a',contentId:'content-1',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',externalUrl:'https://example.com/article',idempotencyKey:'schedule-1'},'user-1');
  assert.equal((result.publication as any).content_revision_id,'revision-2');
  assert.equal((result.job as any).target_id,(result.publication as any).id);
  assert.equal(publicationInsertValues[9],'https://example.com/article');
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('COMMIT'));
});

test('Google Business Profile scheduling refuses to enqueue without its required Learn More URL', async () => {
  let inserted = false;
  const pool = poolWithClient(async (sql) => {
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.contents')) return {rows:[{id:'content-1',client_id:'client-a',version:3,status:'approved',approved_revision_id:'revision-2'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.publishing_accounts')) return {rows:[{id:'account-1',client_id:'client-a',active:true,platform:'blog',instance_key:'inficonglobal-gmb'}],rowCount:1};
    if(sql.includes('INSERT INTO editorial.publications')) inserted = true;
    return {rows:[],rowCount:0};
  });
  const repository = new EditorialApiRepository(pool);
  await assert.rejects(() => repository.schedulePublication({clientId:'client-a',contentId:'content-1',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',idempotencyKey:'schedule-gmb-missing-url'},'user-1'), (error:any) => error.code === 'CTA_URL_REQUIRED' && error.statusCode === 400);
  assert.equal(inserted, false);
});

test('generate_plan creates a durable calendar and passes it as both job target and payload contract', async () => {
  let insertedJob: any;
  const pool=poolWithClient(async(sql,values=[])=>{
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.jobs')) return {rows:[],rowCount:0};
    if(sql.includes('INSERT INTO editorial.jobs')) { insertedJob={targetId:values[3],payload:JSON.parse(String(values[6]))}; return {rows:[{id:values[0],target_id:values[3],payload:insertedJob.payload}],rowCount:1}; }
    return {rows:[],rowCount:0};
  });
  const repository=new EditorialApiRepository(pool);
  const created=await repository.createJob({clientId:'client-a',kind:'generate_plan',idempotencyKey:'plan:october',payload:{calendar:{title:'Octubre'}}},'user-1');
  assert.ok(insertedJob.targetId);
  assert.equal(insertedJob.payload.calendarId,insertedJob.targetId);
  assert.equal(insertedJob.payload.calendar_id,insertedJob.targetId);
  assert.equal(insertedJob.payload.calendar.id,insertedJob.targetId);
  assert.equal((created.job as any).target_id,insertedJob.targetId);
});

test('publication jobs persist a database-derived n8n payload in camelCase and snake_case', async () => {
  let insertedPayload: any;
  const publication={id:'publication-1',client_id:'client-a',content_id:'content-1',content_revision_id:'revision-1',account_id:'account-1',copy:'Texto final',media:[{url:'https://cdn.example/image.jpg'}],desired_scheduled_at:'2026-10-01T09:00:00.000Z',confirmed_scheduled_at:null,postiz_post_id:'postiz-8',provider_post_id:null,external_url:null,status:'scheduled',version:4,content_status:'approved',approved_revision_id:'revision-1',provider:'postiz',platform:'gmb',instance_key:'postiz-main',external_account_id:'channel-1'};
  const pool=poolWithClient(async(sql,values=[])=>{
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.jobs')) return {rows:[],rowCount:0};
    if(sql.includes('SELECT p.*,c.status')) return {rows:[publication],rowCount:1};
    if(sql.includes('SELECT p.*,a.provider,a.platform,a.instance_key')) return {rows:[publication],rowCount:1};
    if(sql.includes('INSERT INTO editorial.jobs')) { insertedPayload=JSON.parse(String(values[6])); return {rows:[{id:values[0],target_id:values[3],payload:insertedPayload}],rowCount:1}; }
    return {rows:[],rowCount:0};
  });
  const repository=new EditorialApiRepository(pool);
  await repository.createJob({clientId:'client-a',kind:'reconcile',targetId:'publication-1',idempotencyKey:'reconcile:publication-1',payload:{}},'user-1');
  const p=insertedPayload.publication;
  assert.deepEqual({accountId:p.accountId,account_id:p.account_id,desiredScheduledAt:p.desiredScheduledAt,desired_scheduled_at:p.desired_scheduled_at,postizPostId:p.postizPostId,postiz_post_id:p.postiz_post_id},{accountId:'account-1',account_id:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',desired_scheduled_at:'2026-10-01T09:00:00.000Z',postizPostId:'postiz-8',postiz_post_id:'postiz-8'});
  assert.equal(p.copy,'Texto final');
  assert.deepEqual(p.media,[{url:'https://cdn.example/image.jpg'}]);
});

test('claim self-heals legacy publication payloads before dispatching a retry', async () => {
  const writes:any[]=[];
  const publication={id:'publication-1',client_id:'client-a',content_id:'content-1',content_revision_id:'revision-1',account_id:'account-1',copy:'Texto final',media:[],desired_scheduled_at:'2026-10-01T09:00:00.000Z',postiz_post_id:'postiz-8',status:'sending',provider:'postiz',platform:'gmb',instance_key:'postiz-main',external_account_id:'channel-1'};
  const pool=poolWithClient(async(sql,values=[])=>{
    if(sql.includes('SELECT j.* FROM editorial.jobs')) return {rows:[{id:'job-1',client_id:'client-a',kind:'publish',target_id:'publication-1',payload:{publicationId:'publication-1'}}],rowCount:1};
    if(sql.includes('SELECT status FROM editorial.publications')) return {rows:[{status:'sending'}],rowCount:1};
    if(sql.includes('SELECT p.*,a.provider,a.platform,a.instance_key')) return {rows:[publication],rowCount:1};
    if(sql.includes('UPDATE editorial.jobs SET payload')) { writes.push(JSON.parse(String(values[1]))); return {rows:[],rowCount:1}; }
    if(sql.includes("UPDATE editorial.jobs SET status='running'")) return {rows:[{id:'job-1',payload:writes[0]}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  const repository=new EditorialApiRepository(pool);
  await repository.claimJob({leaseSeconds:60,executionId:'run-1'},['*']);
  assert.equal(writes[0].publication.accountId,'account-1');
  assert.equal(writes[0].publication.postizPostId,'postiz-8');
});

test('versioned workflow contracts require the generated calendar and consume the persisted publication snapshot', async () => {
  const root=new URL('..',import.meta.url);
  const plan=await import('node:fs/promises').then(({readFile})=>readFile(new URL('./workflows/content/inficon-global/plan.v1.json',root),'utf8'));
  const publish=await import('node:fs/promises').then(({readFile})=>readFile(new URL('./workflows/content/inficon-global/publish.v1.json',root),'utf8'));
  const generate=await import('node:fs/promises').then(({readFile})=>readFile(new URL('./workflows/content/inficon-global/generate.v1.json',root),'utf8'));
  assert.match(plan,/calendarId es obligatorio/);
  assert.match(plan,/calendarId debe coincidir con target_id/);
  assert.match(plan,/calendarId distinto al reservado/);
  assert.match(publish,/job\.payload\.publication/);
  assert.match(generate,/reconcileRequired:ambiguous/);
});

test('summary and paginated search use editorial dates and SQL filters before LIMIT', async () => {
  const statements:Array<{sql:string;values:unknown[]}>=[];
  const pool={query:async(sql:string,values:unknown[]=[])=>{statements.push({sql,values});return {rows:[],rowCount:0};}} as unknown as Pool;
  const repository=new EditorialApiRepository(pool);
  await repository.summary({clientId:'client-a',from:'2026-09-01T00:00:00.000Z',to:'2026-10-01T00:00:00.000Z'});
  assert.ok(statements.some(({sql})=>sql.includes('p.planned_at >= $2')));
  assert.ok(statements.some(({sql})=>sql.includes('pub.desired_scheduled_at >= $2')));
  statements.length=0;
  await repository.calendar({clientId:'client-a',status:'ready',format:'blog',search:'seguridad',limit:25});
  const query=statements[0];
  assert.match(query.sql,/p\.status = \$2/);
  assert.match(query.sql,/p\.format = \$3/);
  assert.match(query.sql,/p\.title ILIKE \$4/);
  assert.ok(query.sql.indexOf('ILIKE')<query.sql.lastIndexOf('LIMIT'));
  assert.equal(query.values.at(-1),26);
});
