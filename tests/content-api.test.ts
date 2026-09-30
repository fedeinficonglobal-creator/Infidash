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

const ALL_BINDINGS = { generate_plan: 'wf-plan', generate_content: 'wf-generate', publish: 'wf-publish', reschedule: 'wf-reschedule', cancel: 'wf-cancel', reconcile: 'wf-reconcile' };

/** Fake pool whose client answers the workflow-binding lookup with every kind bound unless the test overrides it. */
function poolWithClient(handler: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>) {
  const query = async (sql: string, values?: unknown[]) => {
    const result = await handler(sql, values);
    if (sql.includes('SELECT workflow_bindings FROM editorial.client_settings') && !result.rows.length) return { rows: [{ workflow_bindings: ALL_BINDINGS }], rowCount: 1 };
    return result;
  };
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

test('Google Business Profile scheduling does not require a Learn More URL from the app (n8n falls back to editorial_config.site_url)', async () => {
  let inserted = false;
  const pool = poolWithClient(async (sql, values = []) => {
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.contents')) return {rows:[{id:'content-1',client_id:'client-a',version:3,status:'approved',approved_revision_id:'revision-2'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.publishing_accounts')) return {rows:[{id:'account-1',client_id:'client-a',active:true,platform:'blog',instance_key:'inficonglobal-gmb'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.jobs')) return {rows:[],rowCount:0};
    if(sql.includes('SELECT id FROM editorial.publications')) return {rows:[],rowCount:0};
    if(sql.includes('INSERT INTO editorial.publications')) { inserted = true; return {rows:[{id:values[0],client_id:values[1],content_id:values[2],account_id:values[3],content_revision_id:values[5],external_url:values[9],status:'pending'}],rowCount:1}; }
    if(sql.includes('INSERT INTO editorial.jobs')) return {rows:[{id:values[0],client_id:values[1],kind:'publish',target_id:values[2],status:'pending'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  const repository = new EditorialApiRepository(pool);
  await repository.schedulePublication({clientId:'client-a',contentId:'content-1',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',idempotencyKey:'schedule-gmb-no-url'},'user-1');
  assert.equal(inserted, true);
});

function schedulingPoolWithPublications(existing: Array<{ occurrence_key: string; status: string }>, onInsert: (values: unknown[]) => void) {
  return poolWithClient(async (sql, values = []) => {
    if(sql.includes('SELECT enabled FROM editorial.client_settings')) return {rows:[{enabled:true}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.contents')) return {rows:[{id:'content-1',client_id:'client-a',version:3,status:'approved',approved_revision_id:'revision-2'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.publishing_accounts')) return {rows:[{id:'account-1',client_id:'client-a',active:true,platform:'blog',instance_key:'inficonglobal-gmb'}],rowCount:1};
    if(sql.includes('SELECT * FROM editorial.jobs')) return {rows:[],rowCount:0};
    if(sql.includes('FROM editorial.publications WHERE content_id')) return {rows:existing.map((row,index)=>({id:`publication-${index}`,...row})),rowCount:existing.length};
    if(sql.includes('INSERT INTO editorial.publications')) { onInsert(values); return {rows:[{id:values[0],client_id:values[1],content_id:values[2],account_id:values[3],occurrence_key:values[4],status:'pending'}],rowCount:1}; }
    if(sql.includes('INSERT INTO editorial.jobs')) return {rows:[{id:values[0],client_id:values[1],kind:'publish',target_id:values[2],status:'pending'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
}

const scheduleInput = (idempotencyKey: string) => ({clientId:'client-a',contentId:'content-1',expectedVersion:3,accountId:'account-1',desiredScheduledAt:'2026-10-01T09:00:00.000Z',idempotencyKey});

test('a cancelled publication frees its account slot: rescheduling uses the next occurrence key', async () => {
  let occurrenceKey: unknown;
  const repository = new EditorialApiRepository(schedulingPoolWithPublications([{occurrence_key:'primary',status:'cancelled'}],(values)=>{ occurrenceKey=values[4]; }));
  await repository.schedulePublication(scheduleInput('after-cancel-1'),'user-1');
  assert.equal(occurrenceKey,'primary-2');

  const repeated = new EditorialApiRepository(schedulingPoolWithPublications([{occurrence_key:'primary',status:'cancelled'},{occurrence_key:'primary-2',status:'cancelled'}],(values)=>{ occurrenceKey=values[4]; }));
  await repeated.schedulePublication(scheduleInput('after-cancel-2'),'user-1');
  assert.equal(occurrenceKey,'primary-3');
});

test('an active publication on the same account still blocks a duplicate schedule', async () => {
  for (const existing of [
    [{occurrence_key:'primary',status:'scheduled'}],
    [{occurrence_key:'primary',status:'failed'}],
    [{occurrence_key:'primary',status:'cancelled'},{occurrence_key:'primary-2',status:'published'}],
  ]) {
    let inserted = false;
    const repository = new EditorialApiRepository(schedulingPoolWithPublications(existing,()=>{ inserted=true; }));
    await assert.rejects(()=>repository.schedulePublication(scheduleInput(`blocked-${existing.length}`),'user-1'),(error:any)=>error.code==='PUBLICATION_EXISTS'&&error.statusCode===409);
    assert.equal(inserted,false,`${JSON.stringify(existing)} must not insert`);
  }
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

test('publication state machine accepts external cancellation and reconcile discovering a post after a failure', () => {
  for (const from of ['scheduled', 'sending', 'unknown', 'failed'] as const) assert.doesNotThrow(() => assertPublicationTransition(from, 'cancelled'), `${from} -> cancelled`);
  assert.doesNotThrow(() => assertPublicationTransition('failed', 'scheduled'));
  assert.doesNotThrow(() => assertPublicationTransition('failed', 'published'));
  assert.throws(() => assertPublicationTransition('cancelled', 'scheduled'), (error: any) => error.code === 'INVALID_TRANSITION');
  assert.throws(() => assertPublicationTransition('published', 'cancelled'), (error: any) => error.code === 'INVALID_TRANSITION');
});

const PLAN_ROW = { id: 'plan-1', client_id: 'client-a', calendar_id: 'calendar-1', title: 'Guía de bombas', theme: 'Industria', rationale: 'Demanda alta', format: 'blog', keyword_primary: 'bombas', keywords: ['bombas', 'caudal'], entities: ['ISO 9906'], cta: 'Pide presupuesto', priority: 'alta', planned_at: '2026-10-12T08:00:00.000Z', status: 'generating', version: 5 };

test('release-generation is admin-only, client-scoped and passes the expected version', async () => {
  const calls: any[] = [];
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: { ...fakeRepository(), async getPlanItem(id: string) { return id === 'plan-1' ? PLAN_ROW : null; }, async releaseGeneration(id: string, version: number, actorId: string) { calls.push({ id, version, actorId }); return { ...PLAN_ROW, status: 'generation_failed', version: version + 1 }; } } as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } } : null,
  });
  const forbidden = await app.inject({ method: 'POST', url: '/api/content/plan-items/plan-1/release-generation', headers: { authorization: 'Bearer viewer' }, payload: { version: 5 } });
  assert.equal(forbidden.statusCode, 403);
  const missing = await app.inject({ method: 'POST', url: '/api/content/plan-items/plan-x/release-generation', headers: { authorization: 'Bearer admin' }, payload: { version: 5 } });
  assert.equal(missing.statusCode, 404);
  const noVersion = await app.inject({ method: 'POST', url: '/api/content/plan-items/plan-1/release-generation', headers: { authorization: 'Bearer admin' }, payload: {} });
  assert.equal(noVersion.statusCode, 400);
  const released = await app.inject({ method: 'POST', url: '/api/content/plan-items/plan-1/release-generation', headers: { authorization: 'Bearer admin' }, payload: { version: 5 } });
  assert.equal(released.statusCode, 200);
  assert.equal(released.json().planItem.status, 'generation_failed');
  assert.deepEqual(calls, [{ id: 'plan-1', version: 5, actorId: 'user-1' }]);
  await app.close();
});

function releasePool(options: { plan?: any; activeJob?: boolean } = {}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const pool = poolWithClient(async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT client_id FROM editorial.plan_items')) return { rows: options.plan === null ? [] : [{ client_id: (options.plan ?? PLAN_ROW).client_id }], rowCount: options.plan === null ? 0 : 1 };
    if (sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return { rows: options.plan === null ? [] : [options.plan ?? PLAN_ROW], rowCount: 1 };
    if (sql.includes('FROM editorial.jobs') && sql.includes("status='running' AND locked_until>now()")) return { rows: options.activeJob ? [{ id: 'job-live' }] : [], rowCount: options.activeJob ? 1 : 0 };
    if (sql.includes('UPDATE editorial.jobs')) return { rows: [{ id: 'job-old-1' }, { id: 'job-old-2' }], rowCount: 2 };
    if (sql.includes('UPDATE editorial.plan_items')) return { rows: [{ ...PLAN_ROW, status: 'generation_failed', version: 6 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { pool, statements };
}

test('releasing a stuck generation fails the plan item and neutralizes every stale generate_content job', async () => {
  const { pool, statements } = releasePool();
  const planItem = await new EditorialApiRepository(pool).releaseGeneration('plan-1', 5, 'user-1');
  assert.equal((planItem as any).status, 'generation_failed');
  const jobUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.jobs'))!;
  assert.match(jobUpdate.sql, /kind='generate_content'/);
  assert.match(jobUpdate.sql, /attempt_count=GREATEST\(attempt_count,8\)/);
  assert.match(jobUpdate.sql, /lease_token=NULL/);
  assert.match(jobUpdate.sql, /locked_until=NULL/);
  assert.match(jobUpdate.sql, /'pending','failed','unknown'/);
  assert.match(jobUpdate.sql, /status='running' AND \(locked_until IS NULL OR locked_until<=now\(\)\)/);
  assert.ok(jobUpdate.values.includes('Liberado manualmente por un administrador'));
  const planUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.plan_items'))!;
  assert.match(planUpdate.sql, /status='generation_failed'/);
  assert.match(planUpdate.sql, /version=version\+1/);
  const audit = statements.find(({ sql, values }) => sql.includes('INSERT INTO editorial.events') && values.includes('plan_item.generation_released'));
  assert.ok(audit, 'audit event recorded');
  assert.ok(statements.some(({ sql }) => sql === 'BEGIN') && statements.some(({ sql }) => sql === 'COMMIT'));
});

test('releasing a generation refuses stale versions, non-generating items and live executions', async () => {
  await assert.rejects(() => new EditorialApiRepository(releasePool({ plan: null }).pool).releaseGeneration('plan-1', 5, 'user-1'), (error: any) => error.statusCode === 404);
  await assert.rejects(() => new EditorialApiRepository(releasePool().pool).releaseGeneration('plan-1', 4, 'user-1'), (error: any) => error.code === 'STALE_VERSION');
  await assert.rejects(() => new EditorialApiRepository(releasePool({ plan: { ...PLAN_ROW, status: 'review' } }).pool).releaseGeneration('plan-1', 5, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION');
  const live = releasePool({ activeJob: true });
  await assert.rejects(() => new EditorialApiRepository(live.pool).releaseGeneration('plan-1', 5, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'JOB_IN_PROGRESS' && /espera a que termine o caduque/.test(error.message));
  assert.equal(live.statements.some(({ sql }) => sql.includes('UPDATE editorial.jobs')), false);
});

test('releasing a generation locks its jobs before the plan item, in the same order as claimJob, so the two cannot deadlock', async () => {
  const { pool, statements } = releasePool();
  await new EditorialApiRepository(pool).releaseGeneration('plan-1', 5, 'user-1');
  const jobLock = statements.findIndex(({ sql }) => sql.includes('FROM editorial.jobs') && sql.includes('FOR UPDATE') && !sql.includes('locked_until>now()'));
  const planLock = statements.findIndex(({ sql }) => sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE'));
  assert.ok(jobLock >= 0, 'generate_content jobs are locked');
  assert.ok(jobLock < planLock, 'jobs are locked before the plan item');
});

test('a generation still unconfirmed points the operator to the release action instead of a nonexistent WordPress reconcile', async () => {
  const pool = poolWithClient(async (sql) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('SELECT * FROM editorial.plan_items')) return { rows: [PLAN_ROW], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => new EditorialApiRepository(pool).createJob({ clientId: 'client-a', kind: 'generate_content', targetId: 'plan-1', expectedVersion: 5, idempotencyKey: 'gen-1', payload: {} }, 'user-1'), (error: any) => error.code === 'GENERATION_RELEASE_REQUIRED' && /Marcar como fallida/.test(error.message) && !/reconcilia WordPress/.test(error.message));
});

test('generate_content jobs carry a server-built plan item snapshot and ignore browser-supplied payloads', async () => {
  let inserted: any;
  const pool = poolWithClient(async (sql, values = []) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('SELECT * FROM editorial.plan_items')) return { rows: [{ ...PLAN_ROW, status: 'approved' }], rowCount: 1 };
    if (sql.includes('INSERT INTO editorial.jobs')) { inserted = { payload: JSON.parse(String(values[6])), hash: values[5] }; return { rows: [{ id: values[0], payload: inserted.payload }], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
  const input = { clientId: 'client-a', kind: 'generate_content', targetId: 'plan-1', expectedVersion: 5, idempotencyKey: 'gen-2', payload: { planItem: { title: 'Título inyectado', keywords: ['spam'] } } };
  await new EditorialApiRepository(pool).createJob({ ...input }, 'user-1');
  assert.deepEqual(inserted.payload, {
    schemaVersion: 1,
    planItem: { id: 'plan-1', calendarId: 'calendar-1', title: 'Guía de bombas', theme: 'Industria', rationale: 'Demanda alta', format: 'blog', keywordPrimary: 'bombas', keywords: ['bombas', 'caudal'], entities: ['ISO 9906'], cta: 'Pide presupuesto', priority: 'alta', plannedAt: '2026-10-12T08:00:00.000Z', version: 5 },
  });
  assert.equal(inserted.hash, requestHash({ kind: 'generate_content', targetId: 'plan-1', expectedVersion: 5, payload: input.payload }));
});

test('claim rebuilds the generate_content plan item payload on every attempt', async () => {
  const writes: any[] = [];
  const pool = poolWithClient(async (sql, values = []) => {
    if (sql.includes('SELECT j.* FROM editorial.jobs')) return { rows: [{ id: 'job-1', client_id: 'client-a', kind: 'generate_content', target_id: 'plan-1', payload: {} }], rowCount: 1 };
    if (sql.includes('SELECT status FROM editorial.plan_items')) return { rows: [{ status: 'generating' }], rowCount: 1 };
    if (sql.includes('SELECT * FROM editorial.plan_items')) return { rows: [{ ...PLAN_ROW, title: 'Título actualizado' }], rowCount: 1 };
    if (sql.includes('UPDATE editorial.jobs SET payload')) { writes.push(JSON.parse(String(values[1]))); return { rows: [], rowCount: 1 }; }
    if (sql.includes("UPDATE editorial.jobs SET status='running'")) return { rows: [{ id: 'job-1', payload: writes[0] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const claimed: any = await new EditorialApiRepository(pool).claimJob({ leaseSeconds: 60, executionId: 'run-1' }, ['*']);
  assert.equal(writes[0].planItem.title, 'Título actualizado');
  assert.deepEqual(writes[0].planItem.keywords, ['bombas', 'caudal']);
  assert.equal(claimed.payload.planItem.title, 'Título actualizado');
});

function guardPool(activeRows: any[] = []) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const pool = poolWithClient(async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('AS active_job')) return { rows: activeRows, rowCount: activeRows.length };
    if (sql.includes('SELECT * FROM editorial.plan_items')) return { rows: [{ ...PLAN_ROW, status: 'approved' }], rowCount: 1 };
    if (sql.includes('INSERT INTO editorial.jobs')) return { rows: [{ id: values[0] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { pool, statements };
}

test('createJob refuses a duplicate while an equivalent job is still active or auto-retrying', async () => {
  const blocked = guardPool([{ id: 'job-running' }]);
  await assert.rejects(() => new EditorialApiRepository(blocked.pool).createJob({ clientId: 'client-a', kind: 'generate_content', targetId: 'plan-1', expectedVersion: 5, idempotencyKey: 'gen-dup', payload: {} }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'JOB_IN_PROGRESS' && error.message === 'Ya hay un trabajo igual en curso');
  assert.equal(blocked.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.jobs')), false);
  const guard = blocked.statements.find(({ sql }) => sql.includes('AS active_job'))!;
  assert.match(guard.sql, /status='pending'/);
  assert.match(guard.sql, /status='running' AND \(locked_until>now\(\) OR \(\$4::boolean AND attempt_count<8\)\)/);
  assert.match(guard.sql, /status='failed' AND \$4::boolean AND attempt_count<8/);
  assert.deepEqual(guard.values, ['client-a', 'generate_content', 'plan-1', true]);

  const plan = guardPool();
  await new EditorialApiRepository(plan.pool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-new', payload: {} }, 'user-1');
  assert.deepEqual(plan.statements.find(({ sql }) => sql.includes('AS active_job'))!.values, ['client-a', 'generate_plan', null, true]);
});

test('publication retries do not count an old failed publish attempt as active, and replays still win', async () => {
  const publish = guardPool();
  await new EditorialApiRepository(publish.pool).createJob({ clientId: 'client-a', kind: 'publish', targetId: 'publication-1', expectedVersion: 2, idempotencyKey: 'publish-retry', payload: {} }, 'user-1').catch(() => undefined);
  const guard = publish.statements.find(({ sql }) => sql.includes('AS active_job'))!;
  assert.deepEqual(guard.values, ['client-a', 'publish', 'publication-1', false]);

  const hash = requestHash({ kind: 'generate_plan', targetId: null, expectedVersion: null, payload: {} });
  const replayPool = poolWithClient(async (sql) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2')) return { rows: [{ id: 'job-old', request_hash: hash }], rowCount: 1 };
    if (sql.includes('AS active_job')) return { rows: [{ id: 'job-old' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const replay = await new EditorialApiRepository(replayPool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-replay', payload: {} }, 'user-1');
  assert.equal(replay.replayed, true);
});

function planJobPool(options: { editorialConfig?: any; calendarStart?: any } = {}) {
  const inserted: { calendar?: unknown[]; job?: any } = {};
  const pool = poolWithClient(async (sql, values = []) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('SELECT editorial_config FROM editorial.client_settings')) return { rows: options.editorialConfig === undefined ? [] : [{ editorial_config: options.editorialConfig }], rowCount: 1 };
    if (sql.includes('FROM editorial.calendars')) return { rows: [{ id: values[1], start_date: options.calendarStart ?? null }], rowCount: 1 };
    if (sql.includes('INSERT INTO editorial.calendars')) { inserted.calendar = values; return { rows: [], rowCount: 1 }; }
    if (sql.includes('INSERT INTO editorial.jobs')) { inserted.job = JSON.parse(String(values[6])); return { rows: [{ id: values[0] }], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
  return { pool, inserted };
}

test('generate_plan anchors a new calendar on the next Monday and the client weeks horizon', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T15:00:00.000Z') });
  const { pool, inserted } = planJobPool({ editorialConfig: { weeksHorizon: 2 } });
  await new EditorialApiRepository(pool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-dates', payload: {} }, 'user-1');
  assert.equal(inserted.calendar?.[3], '2026-10-05');
  assert.equal(inserted.calendar?.[4], '2026-10-18');
  assert.equal(inserted.job.periodStart, '2026-10-05');

  const monday = planJobPool();
  context.mock.timers.setTime(new Date('2026-10-05T08:00:00.000Z').getTime());
  await new EditorialApiRepository(monday.pool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-monday', payload: {} }, 'user-1');
  assert.equal(monday.inserted.calendar?.[3], '2026-10-12');
  assert.equal(monday.inserted.calendar?.[4], '2026-11-08');
});

test('generate_plan honours a supplied start date and an existing calendar start date', async () => {
  const supplied = planJobPool({ editorialConfig: { weeks_horizon: 3 } });
  await new EditorialApiRepository(supplied.pool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-supplied', payload: { calendar: { startDate: '2026-11-02' } } }, 'user-1');
  assert.equal(supplied.inserted.calendar?.[3], '2026-11-02');
  assert.equal(supplied.inserted.calendar?.[4], '2026-11-22');
  assert.equal(supplied.inserted.job.periodStart, '2026-11-02');

  const existing = planJobPool({ calendarStart: '2026-12-07' });
  await new EditorialApiRepository(existing.pool).createJob({ clientId: 'client-a', kind: 'generate_plan', targetId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'plan-existing', payload: {} }, 'user-1');
  assert.equal(existing.inserted.calendar, undefined);
  assert.equal(existing.inserted.job.periodStart, '2026-12-07');
});

test('a failed reconcile report leaves the publication status untouched so it can be retried', async () => {
  const statements: string[] = [];
  const pool = poolWithClient(async (sql) => {
    statements.push(sql);
    if (sql.includes('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE')) return { rows: [{ id: 'job-1', client_id: 'client-a', kind: 'reconcile', target_id: 'publication-1', status: 'running', lease_token: 'lease-1', locked_until: new Date(Date.now() + 60_000).toISOString() }], rowCount: 1 };
    if (sql.includes('SELECT status FROM editorial.publications')) return { rows: [{ status: 'scheduled' }], rowCount: 1 };
    if (sql.includes('UPDATE editorial.jobs SET status')) return { rows: [{ id: 'job-1', status: 'failed' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const finished = await new EditorialApiRepository(pool).finishJob('job-1', 'lease-1', { schemaVersion: 1, clientId: 'client-a', status: 'failed', error: 'Heartbeat 503', result: { workflowVersion: 1, stage: 'reconcile' } }, 'service-1');
  assert.equal((finished.job as any).status, 'failed');
  assert.equal(statements.some((sql) => sql.includes('UPDATE editorial.publications')), false);
});

function approvalPool(planItem: { status: string } | null, contentPlanItemId: string | null = 'plan-1') {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const pool = poolWithClient(async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT * FROM editorial.contents')) return { rows: [{ id: 'content-1', client_id: 'client-a', plan_item_id: contentPlanItemId, status: 'review', version: 4 }], rowCount: 1 };
    if (sql.includes('FROM editorial.content_revisions')) return { rows: [{ id: 'revision-3', revision_number: 3 }], rowCount: 1 };
    if (sql.includes('UPDATE editorial.contents')) return { rows: [{ id: 'content-1', client_id: 'client-a', plan_item_id: contentPlanItemId, status: 'approved', approved_revision_id: 'revision-3', version: 5 }], rowCount: 1 };
    if (sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return planItem ? { rows: [{ id: 'plan-1', client_id: 'client-a', version: 7, ...planItem }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE editorial.plan_items')) return { rows: [{ id: 'plan-1', client_id: 'client-a', status: 'ready', version: 8 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { pool, statements };
}

test('approving content marks its plan item ready in the same transaction', async () => {
  const { pool, statements } = approvalPool({ status: 'review' });
  const content = await new EditorialApiRepository(pool).approveContent('content-1', 'revision-3', 4, 'user-1');
  assert.equal((content as any).status, 'approved');
  const sqls = statements.map(({ sql }) => sql);
  const planUpdateIndex = sqls.findIndex((sql) => sql.includes('UPDATE editorial.plan_items'));
  assert.ok(planUpdateIndex > sqls.findIndex((sql) => sql.includes('UPDATE editorial.contents')), 'plan item updated after the content');
  assert.ok(planUpdateIndex > sqls.indexOf('BEGIN') && planUpdateIndex < sqls.indexOf('COMMIT'), 'plan item updated inside the transaction');
  const planUpdate = statements[planUpdateIndex];
  assert.match(planUpdate.sql, /status='ready'/);
  assert.match(planUpdate.sql, /version=version\+1/);
  assert.match(planUpdate.sql, /updated_at=now\(\)/);
  assert.ok(planUpdate.values.includes('client-a') && planUpdate.values.includes('plan-1'));
  const lock = statements.find(({ sql }) => sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE'))!;
  assert.ok(lock.values.includes('client-a') && lock.values.includes('plan-1'), 'plan item looked up within the content client');
  assert.ok(statements.some(({ sql, values }) => sql.includes('INSERT INTO editorial.events') && values.includes('plan_item.ready')), 'audit event recorded');
});

test('approving content leaves a plan item that is not in review untouched', async () => {
  for (const status of ['generating', 'ready', 'archived', 'approved']) {
    const { pool, statements } = approvalPool({ status });
    await new EditorialApiRepository(pool).approveContent('content-1', 'revision-3', 4, 'user-1');
    assert.equal(statements.some(({ sql }) => sql.includes('UPDATE editorial.plan_items')), false, `no update from ${status}`);
    assert.equal(statements.some(({ values }) => values.includes('plan_item.ready')), false);
  }
});

test('approving content without a linked plan item skips the plan item update', async () => {
  const { pool, statements } = approvalPool({ status: 'review' }, null);
  await new EditorialApiRepository(pool).approveContent('content-1', 'revision-3', 4, 'user-1');
  assert.equal(statements.some(({ sql }) => sql.includes('editorial.plan_items')), false);
});

async function planInputsApp(repository: unknown) {
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: repository as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } } : null,
  });
  return app;
}

test('editorial plan inputs read topic, keywords and competitors from editorial_config, normalizing legacy strings', async () => {
  const values: unknown[][] = [];
  const pool = poolWithClient(async (sql, params = []) => {
    values.push(params);
    if (sql.includes('FROM editorial.client_settings')) return { rows: [{ editorial_config: { topic: '  Marketing  ', keywords: ' seo local, , marketing digital ', site_url: 'https://example.com' } }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  assert.deepEqual(await new EditorialApiRepository(pool).getPlanInputs('client-a'), { topic: 'Marketing', keywords: ['seo local', 'marketing digital'], competitors: [] });
  assert.ok(values.some((params) => params.includes('client-a')));

  const arrays = poolWithClient(async (sql) => sql.includes('FROM editorial.client_settings') ? { rows: [{ editorial_config: { topic: 42, keywords: ['seo', ' ', 'sem'], competitors: ['foo.com', 7] } }], rowCount: 1 } : { rows: [], rowCount: 0 });
  assert.deepEqual(await new EditorialApiRepository(arrays).getPlanInputs('client-a'), { topic: '', keywords: ['seo', 'sem'], competitors: ['foo.com'] });

  const empty = poolWithClient(async (sql) => sql.includes('FROM editorial.client_settings') ? { rows: [{ editorial_config: null }], rowCount: 1 } : { rows: [], rowCount: 0 });
  assert.deepEqual(await new EditorialApiRepository(empty).getPlanInputs('client-a'), { topic: '', keywords: [], competitors: [] });
});

test('editorial plan inputs refuse a client without editorial settings with 409 EDITORIAL_DISABLED', async () => {
  const pool = poolWithClient(async () => ({ rows: [], rowCount: 0 }));
  const repository = new EditorialApiRepository(pool);
  await assert.rejects(() => repository.getPlanInputs('client-x'), (error: any) => error.statusCode === 409 && error.code === 'EDITORIAL_DISABLED');
  await assert.rejects(() => repository.savePlanInputs('client-x', { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] }), (error: any) => error.statusCode === 409 && error.code === 'EDITORIAL_DISABLED');
});

test('saving plan inputs merges the trimmed topic and normalized arrays into editorial_config and keeps other keys', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const pool = poolWithClient(async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes('UPDATE editorial.client_settings')) return { rows: [{ client_id: 'client-a' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const saved = await new EditorialApiRepository(pool).savePlanInputs('client-a', {
    topic: '  Marketing local  ',
    keywords: ['  SEO local ', 'seo LOCAL', '', 'marketing'],
    competitors: ['https://www.Foo.com/path?x=1', 'http://bar.es/', 'FOO.com', 'www.baz.org#top', '  '],
  });
  assert.deepEqual(saved, { topic: 'Marketing local', keywords: ['SEO local', 'marketing'], competitors: ['foo.com', 'bar.es', 'baz.org'] });
  const update = statements.find(({ sql }) => sql.includes('UPDATE editorial.client_settings'))!;
  assert.match(update.sql, /editorial_config\s*=\s*COALESCE\(editorial_config,\s*'\{\}'::jsonb\)\s*\|\|\s*\$2::jsonb/);
  assert.match(update.sql, /updated_at\s*=\s*now\(\)/);
  assert.match(update.sql, /WHERE client_id\s*=\s*\$1/);
  assert.equal(update.values[0], 'client-a');
  assert.deepEqual(JSON.parse(String(update.values[1])), { topic: 'Marketing local', keywords: ['SEO local', 'marketing'], competitors: ['foo.com', 'bar.es', 'baz.org'] });
});

test('saving plan inputs validates every rule before touching the database', async () => {
  let queried = false;
  const pool = poolWithClient(async () => { queried = true; return { rows: [{ client_id: 'client-a' }], rowCount: 1 }; });
  const repository = new EditorialApiRepository(pool);
  const rejects = (input: any, pattern: RegExp) => assert.rejects(() => repository.savePlanInputs('client-a', input), (error: any) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD' && pattern.test(error.message));
  await rejects({ topic: 'SEO', keywords: 'seo', competitors: ['foo.com'] }, /keywords/);
  await rejects({ topic: 'SEO', keywords: ['seo', 3], competitors: ['foo.com'] }, /keywords/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: 'foo.com' }, /competidores/);
  await rejects({ topic: 'SEO', keywords: [' ', ''], competitors: ['foo.com'] }, /al menos una keyword/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: [] }, /al menos un competidor/);
  await rejects({ topic: 'SEO', keywords: Array.from({ length: 21 }, (_, index) => `kw ${index}`), competitors: ['foo.com'] }, /20 keywords/);
  await rejects({ topic: 'SEO', keywords: ['x'.repeat(101)], competitors: ['foo.com'] }, /100 caracteres/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'] }, /5 competidores/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: ['localhost'] }, /localhost/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: ['foo_bar.com'] }, /foo_bar\.com/);
  await rejects({ topic: 'SEO', keywords: ['seo'], competitors: ['foo.com:8080'] }, /foo\.com:8080/);
  await rejects({ keywords: ['seo'], competitors: ['foo.com'] }, /Indica el tema del plan/);
  await rejects({ topic: '   ', keywords: ['seo'], competitors: ['foo.com'] }, /Indica el tema del plan/);
  await rejects({ topic: 7, keywords: ['seo'], competitors: ['foo.com'] }, /Indica el tema del plan/);
  await rejects({ topic: 'x'.repeat(201), keywords: ['seo'], competitors: ['foo.com'] }, /tema debe tener como máximo 200 caracteres/);
  assert.equal(queried, false);
  assert.equal((await repository.savePlanInputs('client-a', { topic: ` ${'x'.repeat(200)} `, keywords: ['seo'], competitors: ['foo.com'] })).topic, 'x'.repeat(200));
  // Duplicates collapse before the limits are counted.
  const saved = await repository.savePlanInputs('client-a', { topic: 'SEO', keywords: Array.from({ length: 25 }, (_, index) => (index % 2 ? 'SEO' : 'seo')), competitors: ['a.com', 'A.com', 'www.a.com', 'b.com', 'c.com', 'd.com', 'e.com'] });
  assert.deepEqual(saved, { topic: 'SEO', keywords: ['seo'], competitors: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'] });
});

test('plan input routes are admin-only and client-scoped', async () => {
  const calls: unknown[][] = [];
  const app = await planInputsApp({
    ...fakeRepository(),
    async getPlanInputs(clientId: string) { calls.push(['get', clientId]); return { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] }; },
    async savePlanInputs(clientId: string, input: unknown) { calls.push(['save', clientId, input]); return { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] }; },
  });
  const url = '/api/clients/client-a/editorial-plan-inputs';
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer viewer' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url, headers: { authorization: 'Bearer viewer' }, payload: { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] } })).statusCode, 403);
  assert.equal(calls.length, 0);

  const read = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer admin' } });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] });
  const saved = await app.inject({ method: 'PUT', url, headers: { authorization: 'Bearer admin' }, payload: { topic: 'SEO', keywords: ['seo'], competitors: ['https://foo.com'] } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] });
  assert.deepEqual(calls, [['get', 'client-a'], ['save', 'client-a', { topic: 'SEO', keywords: ['seo'], competitors: ['https://foo.com'] }]]);
  await app.close();
});

test('plan input route returns 400 validation errors and normalized competitors from the real repository', async () => {
  const pool = poolWithClient(async (sql) => sql.includes('UPDATE editorial.client_settings') ? { rows: [{ client_id: 'client-a' }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const app = await planInputsApp(new EditorialApiRepository(pool));
  const url = '/api/clients/client-a/editorial-plan-inputs';
  const invalid = await app.inject({ method: 'PUT', url, headers: { authorization: 'Bearer admin' }, payload: { topic: 'SEO', keywords: ['seo'], competitors: [] } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, 'INVALID_PAYLOAD');
  assert.match(invalid.json().error, /competidor/);
  const valid = await app.inject({ method: 'PUT', url, headers: { authorization: 'Bearer admin' }, payload: { topic: 'SEO', keywords: ['seo'], competitors: ['https://www.Foo.com/path?x=1'] } });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.json(), { topic: 'SEO', keywords: ['seo'], competitors: ['foo.com'] });
  await app.close();
});
