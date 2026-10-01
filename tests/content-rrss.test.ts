import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { EditorialApiRepository, normalizeRrssPlanInputs } from '../src/server/content/apiRepository.js';
import { JOB_KINDS, networkFromInstanceKey, requestHash } from '../src/server/content/contracts.js';
import { contentRoutes } from '../src/server/content/routes.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

const ALL_BINDINGS = { generate_plan: 'wf-plan', generate_content: 'wf-generate', publish: 'wf-publish', reschedule: 'wf-reschedule', cancel: 'wf-cancel', reconcile: 'wf-reconcile', generate_rrss_plan: 'wf-rrss-plan', generate_rrss: 'wf-rrss' };

type Statement = { sql: string; values: unknown[] };

/** Fake pool (same shape as tests/content-api.test.ts) that records every statement and binds every workflow kind. */
function poolWithClient(handler: (sql: string, values: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> | { rows: any[]; rowCount?: number }) {
  const statements: Statement[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    const result = await handler(sql, values);
    if (sql.includes('SELECT workflow_bindings FROM editorial.client_settings') && !result.rows.length) return { rows: [{ workflow_bindings: ALL_BINDINGS }], rowCount: 1 };
    return result;
  };
  const client = { query, release() {} };
  return { pool: { connect: async () => client, query } as unknown as Pool, statements };
}

const none = { rows: [], rowCount: 0 };
const one = (row: any) => ({ rows: [row], rowCount: 1 });

const ACCOUNT_GMB = { id: '11111111-1111-4111-8111-111111111111', client_id: 'client-a', provider: 'postiz', instance_key: 'inficonglobal-gmb', external_account_id: 'cmt-gmb', platform: 'blog', label: 'GMB Inficon', active: true };
const ACCOUNT_IG = { id: '22222222-2222-4222-8222-222222222222', client_id: 'client-a', provider: 'postiz', instance_key: 'inficonglobal-instagram', external_account_id: 'cmt-ig', platform: 'blog', label: 'Instagram Inficon', active: true };
const RRSS_ITEM = { id: 'item-1', client_id: 'client-a', calendar_id: 'calendar-rrss', title: 'Idea de verano', theme: 'Verano', rationale: 'Temporada alta', format: 'post', keyword_primary: null, keywords: ['verano'], entities: [], cta: 'Reserva', priority: null, planned_at: '2026-10-12T08:00:00.000Z', status: 'approved', version: 3, networks: ['gmb', 'instagram'], calendar_kind: 'rrss' };

// ---------------------------------------------------------------------------
// Migration

test('migration 0003 adds calendar kinds, plan item networks, the new job kinds and the social_posts table', async () => {
  const sql = await readFile(path.join(repositoryRoot, 'db', 'migrations', '0003_rrss_social_posts.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE editorial\.calendars\s+ADD COLUMN kind TEXT NOT NULL DEFAULT 'blog' CHECK \(kind IN \('blog', 'rrss'\)\)/);
  assert.match(sql, /ALTER TABLE editorial\.plan_items\s+ADD COLUMN networks JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS jobs_kind_check/);
  const kindCheck = sql.match(/ADD CONSTRAINT jobs_kind_check CHECK \(kind IN \(([^)]*)\)\)/);
  assert.ok(kindCheck, 'jobs_kind_check is re-added');
  for (const kind of JOB_KINDS) assert.match(kindCheck![1], new RegExp(`'${kind}'`), `${kind} allowed by the CHECK`);
  assert.match(sql, /CREATE TABLE editorial\.social_posts/);
  assert.match(sql, /FOREIGN KEY \(client_id, plan_item_id\) REFERENCES editorial\.plan_items\(client_id, id\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(client_id, account_id\) REFERENCES editorial\.publishing_accounts\(client_id, id\) ON DELETE RESTRICT/);
  assert.match(sql, /publication_id UUID REFERENCES editorial\.publications\(id\) ON DELETE SET NULL/);
  assert.match(sql, /network TEXT NOT NULL CHECK \(network IN \('gmb', 'facebook', 'instagram', 'other'\)\)/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'review' CHECK \(status IN \('review', 'approved', 'scheduled', 'discarded'\)\)/);
  assert.match(sql, /UNIQUE \(client_id, plan_item_id, account_id\)/);
  assert.match(sql, /generation_job_id UUID/);
  assert.match(sql, /ON editorial\.social_posts \(client_id, plan_item_id\)/);
  assert.match(sql, /ON editorial\.social_posts \(client_id, status\)/);
});

// ---------------------------------------------------------------------------
// Network detection

test('networkFromInstanceKey mirrors the publish workflow detection and never needs platform', () => {
  assert.equal(networkFromInstanceKey('inficonglobal-gmb'), 'gmb');
  assert.equal(networkFromInstanceKey('Cliente-Google-Business'), 'gmb');
  assert.equal(networkFromInstanceKey('inficonglobal-facebook'), 'facebook');
  assert.equal(networkFromInstanceKey('INFICON-INSTAGRAM'), 'instagram');
  // Facebook wins over the GMB markers, then Instagram, exactly like "Preparar publicacion".
  assert.equal(networkFromInstanceKey('facebook-google'), 'facebook');
  assert.equal(networkFromInstanceKey('instagram-gmb'), 'instagram');
  assert.equal(networkFromInstanceKey('blog'), 'other');
  assert.equal(networkFromInstanceKey(''), 'other');
  assert.equal(networkFromInstanceKey(null), 'other');
  assert.equal(networkFromInstanceKey(undefined), 'other');
});

// ---------------------------------------------------------------------------
// Blog listings stay blog-only

test('blog plan item listings, calendar lists and the summary only include blog calendars', async () => {
  const { pool, statements } = poolWithClient(() => none);
  const repository = new EditorialApiRepository(pool);
  await repository.calendar({ clientId: 'client-a', status: 'ready', limit: 25 });
  assert.match(statements[0].sql, /c\.kind = 'blog'/);
  assert.match(statements[0].sql, /p\.status = \$2/);
  statements.length = 0;
  await repository.listPlanItems({ clientId: 'client-a', limit: 10 });
  assert.match(statements[0].sql, /c\.kind = 'blog'/);
  statements.length = 0;
  await repository.listCalendars('client-a', 10);
  assert.match(statements[0].sql, /kind = 'blog'/);
  statements.length = 0;
  await repository.summary({ clientId: 'client-a' });
  const plans = statements.find(({ sql }) => sql.includes('FROM editorial.plan_items p'))!;
  assert.match(plans.sql, /JOIN editorial\.calendars cal ON cal\.client_id=p\.client_id AND cal\.id=p\.calendar_id/);
  assert.match(plans.sql, /cal\.kind='blog'/);
  const contents = statements.find(({ sql }) => sql.includes('FROM editorial.contents ci'))!;
  assert.match(contents.sql, /\(cal\.kind IS NULL OR cal\.kind='blog'\)/);
  const publications = statements.find(({ sql }) => sql.includes('FROM editorial.publications pub'))!;
  assert.match(publications.sql, /NOT EXISTS/);
  assert.match(publications.sql, /kind='rrss'/);
});

test('the workflow context separates blog plan items from RRSS ideas', async () => {
  const blogItem = { id: 'blog-1', title: 'Guía', status: 'approved', planned_at: '2026-10-05T08:00:00.000Z' };
  const rrssItem = { id: 'rrss-1', title: 'Reel de verano', status: 'proposed', planned_at: '2026-10-06T08:00:00.000Z', format: 'reel', networks: ['instagram'] };
  const { pool, statements } = poolWithClient((sql) => {
    if (sql.includes("kind='rrss'") && sql.includes('FROM editorial.plan_items')) return one(rrssItem);
    if (sql.includes("kind='blog'") && sql.includes('FROM editorial.plan_items')) return one(blogItem);
    return none;
  });
  const context = await new EditorialApiRepository(pool).context('client-a');
  assert.deepEqual(context.planItems, [blogItem]);
  assert.deepEqual(context.rrssPlanItems, [rrssItem]);
  const plans = statements.filter(({ sql }) => sql.includes('FROM editorial.plan_items'));
  assert.equal(plans.length, 2);
  for (const { sql, values } of plans) {
    assert.match(sql, /JOIN editorial\.calendars c ON c\.client_id=p\.client_id AND c\.id=p\.calendar_id/);
    assert.match(sql, /ORDER BY p\.planned_at DESC NULLS LAST LIMIT 200/);
    assert.deepEqual(values, ['client-a']);
  }
  const blog = plans.find(({ sql }) => sql.includes("c.kind='blog'"))!;
  assert.match(blog.sql, /SELECT p\.id,p\.title,p\.status,p\.planned_at FROM/);
  const rrss = plans.find(({ sql }) => sql.includes("c.kind='rrss'"))!;
  assert.match(rrss.sql, /SELECT p\.id,p\.title,p\.status,p\.planned_at,p\.format,p\.networks FROM/);
});

test('creating a blog plan item refuses an RRSS calendar', async () => {
  const rrss = poolWithClient((sql) => sql.includes('SELECT kind FROM editorial.calendars') ? one({ kind: 'rrss' }) : none);
  await assert.rejects(() => new EditorialApiRepository(rrss.pool).createPlanItem({ clientId: 'client-a', calendarId: 'calendar-rrss', title: 'Tema' }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TARGET');
  assert.equal(rrss.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.plan_items')), false);

  const missing = poolWithClient(() => none);
  await assert.rejects(() => new EditorialApiRepository(missing.pool).createPlanItem({ clientId: 'client-a', calendarId: 'calendar-x', title: 'Tema' }, 'user-1'), (error: any) => error.statusCode === 404);

  const blog = poolWithClient((sql, values) => {
    if (sql.includes('SELECT kind FROM editorial.calendars')) return one({ kind: 'blog' });
    if (sql.includes('INSERT INTO editorial.plan_items')) return one({ id: values[0], title: values[3] });
    return none;
  });
  const created = await new EditorialApiRepository(blog.pool).createPlanItem({ clientId: 'client-a', calendarId: 'calendar-blog', title: 'Tema' }, 'user-1');
  assert.equal((created as any).title, 'Tema');
});

test('RRSS item listing filters by rrss calendars and summarizes their social posts', async () => {
  const { pool, statements } = poolWithClient(() => ({ rows: [{ id: 'item-1', created_at: '2026-10-01T00:00:00.000Z', social_posts: [] }], rowCount: 1 }));
  const result = await new EditorialApiRepository(pool).listRrssItems({ clientId: 'client-a', status: 'approved', search: 'verano', limit: 20 });
  assert.equal(result.items.length, 1);
  const query = statements[0];
  assert.match(query.sql, /c\.kind = 'rrss'/);
  assert.doesNotMatch(query.sql, /c\.kind = 'blog'/);
  assert.match(query.sql, /FROM editorial\.social_posts sp/);
  assert.match(query.sql, /'accountId', sp\.account_id/);
  assert.match(query.sql, /'network', sp\.network/);
  assert.match(query.sql, /p\.status = \$2/);
  assert.equal(query.values[0], 'client-a');
  assert.equal(query.values.at(-1), 21);
});

// ---------------------------------------------------------------------------
// generate_rrss_plan

function rrssPlanPool(editorialConfig: any) {
  const inserted: { calendar?: unknown[]; job?: any; guard?: unknown[] } = {};
  const fake = poolWithClient((sql, values) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return one({ enabled: true });
    if (sql.includes('AS active_job')) { inserted.guard = values; return none; }
    if (sql.includes('SELECT editorial_config FROM editorial.client_settings')) return one({ editorial_config: editorialConfig });
    if (sql.includes('INSERT INTO editorial.calendars')) { inserted.calendar = values; return { rows: [], rowCount: 1 }; }
    if (sql.includes('INSERT INTO editorial.jobs')) { inserted.job = JSON.parse(String(values[6])); return one({ id: values[0], target_id: values[3] }); }
    return none;
  });
  return { ...fake, inserted };
}

test('generate_rrss_plan creates an rrss calendar from editorial_config.rrss and a server-built payload', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T15:00:00.000Z') });
  const rrss = { topic: 'Turismo rural', keywords: ['casas rurales'], networks: ['gmb', 'instagram'], postsPerWeek: 3, weeksHorizon: 2, extra: 'kept' };
  const { pool, inserted } = rrssPlanPool({ topic: 'Blog topic', weeksHorizon: 8, rrss });
  await new EditorialApiRepository(pool).createJob({ clientId: 'client-a', kind: 'generate_rrss_plan', idempotencyKey: 'rrss-plan-1', payload: { rrss: { topic: 'inyectado' }, injected: true, calendar: { title: 'Hack' } } }, 'user-1');
  assert.deepEqual(inserted.guard, ['client-a', 'generate_rrss_plan', null, true]);
  assert.equal(inserted.calendar?.[9], 'rrss');
  assert.match(String(inserted.calendar?.[2]), /^Plan de redes/);
  assert.equal(inserted.calendar?.[3], '2026-10-05');
  assert.equal(inserted.calendar?.[4], '2026-10-18');
  assert.equal(inserted.job.periodStart, '2026-10-05');
  assert.equal(inserted.job.calendarId, inserted.calendar?.[0]);
  assert.equal(inserted.job.injected, undefined);
  assert.deepEqual(inserted.job.rrss, { topic: 'Turismo rural', keywords: ['casas rurales'], networks: ['gmb', 'instagram'], postsPerWeek: 3, weeksHorizon: 2 });
});

test('generate_rrss_plan defaults to a four-week horizon and generate_plan keeps creating blog calendars', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T15:00:00.000Z') });
  const rrss = rrssPlanPool({});
  await new EditorialApiRepository(rrss.pool).createJob({ clientId: 'client-a', kind: 'generate_rrss_plan', idempotencyKey: 'rrss-plan-2', payload: {} }, 'user-1');
  assert.equal(rrss.inserted.calendar?.[4], '2026-11-01');
  assert.deepEqual(rrss.inserted.job.rrss, { topic: '', keywords: [], networks: [], postsPerWeek: null, weeksHorizon: 4 });

  const blog = rrssPlanPool({ rrss: { weeksHorizon: 1 } });
  await new EditorialApiRepository(blog.pool).createJob({ clientId: 'client-a', kind: 'generate_plan', idempotencyKey: 'plan-blog', payload: {} }, 'user-1');
  assert.equal(blog.inserted.calendar?.[9], 'blog');
  assert.equal(blog.inserted.calendar?.[4], '2026-11-01', 'blog horizon ignores editorial_config.rrss');
  assert.equal(blog.inserted.job.rrss, undefined);
});

test('generate_plan and generate_rrss_plan refuse an existing calendar of the other kind', async () => {
  for (const [kind, calendarKind] of [['generate_plan', 'rrss'], ['generate_rrss_plan', 'blog']] as const) {
    const { pool, statements } = poolWithClient((sql, values) => {
      if (sql.includes('SELECT enabled FROM editorial.client_settings')) return one({ enabled: true });
      if (sql.includes('FROM editorial.calendars')) return one({ id: values[1], start_date: null, kind: calendarKind });
      return none;
    });
    await assert.rejects(() => new EditorialApiRepository(pool).createJob({ clientId: 'client-a', kind, targetId: '33333333-3333-4333-8333-333333333333', idempotencyKey: `wrong-${kind}`, payload: {} }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TARGET');
    assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.jobs')), false);
  }
});

test('a generate_rrss_plan result stores validated networks and RRSS formats in its calendar', async () => {
  const job = { id: 'job-plan', client_id: 'client-a', kind: 'generate_rrss_plan', target_id: 'calendar-rrss', status: 'running', lease_token: 'lease-1', locked_until: new Date(Date.now() + 60_000).toISOString() };
  const finish = (planItems: any[]) => {
    const fake = poolWithClient((sql) => {
      if (sql.includes('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE')) return one(job);
      if (sql.includes('UPDATE editorial.jobs SET status')) return one({ ...job, status: 'succeeded' });
      return none;
    });
    return { ...fake, run: () => new EditorialApiRepository(fake.pool).finishJob('job-plan', 'lease-1', { schemaVersion: 1, clientId: 'client-a', status: 'succeeded', planItems }, 'service-1') };
  };
  const ok = finish([{ title: 'Post 1', format: 'reel', networks: ['instagram', 'gmb'], sourceKey: 'k1', plannedAt: '2026-10-06T09:00:00.000Z' }]);
  await ok.run();
  const insert = ok.statements.find(({ sql }) => sql.includes('INSERT INTO editorial.plan_items'))!;
  assert.match(insert.sql, /networks=EXCLUDED\.networks/);
  assert.equal(insert.values[2], 'calendar-rrss');
  assert.equal(insert.values[6], 'reel');
  assert.deepEqual(JSON.parse(String(insert.values[15])), ['instagram', 'gmb']);

  const badNetwork = finish([{ title: 'Post', networks: ['tiktok'], sourceKey: 'k2' }]);
  await assert.rejects(() => badNetwork.run(), (error: any) => error.statusCode === 400 && error.code === 'INVALID_RESULT');
  assert.equal(badNetwork.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.plan_items')), false);
  const badFormat = finish([{ title: 'Post', format: 'blog', sourceKey: 'k3' }]);
  await assert.rejects(() => badFormat.run(), (error: any) => error.statusCode === 400 && error.code === 'INVALID_RESULT');
  const missing = poolWithClient((sql) => sql.includes('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE') ? one(job) : none);
  await assert.rejects(() => new EditorialApiRepository(missing.pool).finishJob('job-plan', 'lease-1', { schemaVersion: 1, clientId: 'client-a', status: 'succeeded' }, 'service-1'), (error: any) => error.code === 'INVALID_RESULT');
});

// ---------------------------------------------------------------------------
// generate_rrss: create

function rrssJobPool(options: { item?: any; accounts?: any[]; activeJob?: boolean } = {}) {
  const captured: { job?: any; hash?: unknown } = {};
  const fake = poolWithClient((sql, values) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return one({ enabled: true });
    if (sql.includes('AS active_job')) return options.activeJob ? one({ id: 'job-live' }) : none;
    if (sql.includes('FROM editorial.plan_items p JOIN editorial.calendars c')) return options.item === null ? none : one(options.item ?? RRSS_ITEM);
    if (sql.includes('FROM editorial.publishing_accounts')) return { rows: options.accounts ?? [ACCOUNT_GMB, ACCOUNT_IG], rowCount: (options.accounts ?? [ACCOUNT_GMB, ACCOUNT_IG]).length };
    if (sql.includes('INSERT INTO editorial.jobs')) { captured.job = JSON.parse(String(values[6])); captured.hash = values[5]; return one({ id: values[0], payload: captured.job }); }
    return none;
  });
  return { ...fake, captured };
}

const rrssJobInput = (payload: any = { accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id] }, extra: any = {}) => ({ clientId: 'client-a', kind: 'generate_rrss', targetId: 'item-1', expectedVersion: 3, idempotencyKey: 'rrss-gen-1', payload, ...extra });

test('generate_rrss moves an approved RRSS idea to generating with a server-built payload for the selected accounts', async () => {
  const { pool, statements, captured } = rrssJobPool();
  const input = rrssJobInput({ accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id], planItem: { title: 'Inyectado' }, accounts: [{ id: 'evil' }] });
  await new EditorialApiRepository(pool).createJob({ ...input }, 'user-1');
  const accountLookup = statements.find(({ sql }) => sql.includes('FROM editorial.publishing_accounts'))!;
  assert.match(accountLookup.sql, /active=TRUE/);
  assert.match(accountLookup.sql, /provider='postiz'/);
  assert.deepEqual(accountLookup.values, ['client-a', [ACCOUNT_GMB.id, ACCOUNT_IG.id]]);
  const planUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.plan_items'))!;
  assert.match(planUpdate.sql, /status='generating'/);
  assert.deepEqual(captured.job, {
    schemaVersion: 1,
    planItem: { id: 'item-1', calendarId: 'calendar-rrss', title: 'Idea de verano', theme: 'Verano', rationale: 'Temporada alta', format: 'post', keywordPrimary: null, keywords: ['verano'], entities: [], cta: 'Reserva', priority: null, plannedAt: '2026-10-12T08:00:00.000Z', version: 3, networks: ['gmb', 'instagram'] },
    accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id],
    accounts: [
      { id: ACCOUNT_GMB.id, instanceKey: 'inficonglobal-gmb', network: 'gmb', label: 'GMB Inficon', externalAccountId: 'cmt-gmb' },
      { id: ACCOUNT_IG.id, instanceKey: 'inficonglobal-instagram', network: 'instagram', label: 'Instagram Inficon', externalAccountId: 'cmt-ig' },
    ],
    generateImage: true,
  });
  assert.equal(captured.hash, requestHash({ kind: 'generate_rrss', targetId: 'item-1', expectedVersion: 3, payload: input.payload }));
});

test('generate_rrss keeps an explicit generateImage choice and rejects a non-boolean one', async () => {
  const off = rrssJobPool();
  await new EditorialApiRepository(off.pool).createJob(rrssJobInput({ accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id], generateImage: false }), 'user-1');
  assert.equal(off.captured.job.generateImage, false);
  const on = rrssJobPool();
  await new EditorialApiRepository(on.pool).createJob(rrssJobInput({ accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id], generateImage: true }), 'user-1');
  assert.equal(on.captured.job.generateImage, true);
  for (const generateImage of ['false', 0, 1, {}, []]) {
    const { pool, statements } = rrssJobPool();
    await assert.rejects(
      () => new EditorialApiRepository(pool).createJob(rrssJobInput({ accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id], generateImage }), 'user-1'),
      (error: any) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD' && /generateImage/.test(error.message),
      JSON.stringify(generateImage),
    );
    assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.jobs')), false);
    assert.equal(statements.some(({ sql }) => sql.includes('UPDATE editorial.plan_items')), false);
  }
});

test('generate_rrss refuses blog items, missing or foreign accounts and invalid plan item states', async () => {
  const rejects = async (options: Parameters<typeof rrssJobPool>[0], input: any, check: (error: any) => boolean) => {
    const { pool, statements } = rrssJobPool(options);
    await assert.rejects(() => new EditorialApiRepository(pool).createJob(input, 'user-1'), check);
    assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.jobs')), false);
    assert.equal(statements.some(({ sql }) => sql.includes('UPDATE editorial.plan_items')), false);
  };
  await rejects({ item: { ...RRSS_ITEM, calendar_kind: 'blog' } }, rrssJobInput(), (error) => error.statusCode === 409 && error.code === 'INVALID_TARGET');
  await rejects({ item: null }, rrssJobInput(), (error) => error.statusCode === 404);
  await rejects({}, rrssJobInput({}), (error) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD' && /accountIds/.test(error.message));
  await rejects({}, rrssJobInput({ accountIds: [] }), (error) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD');
  await rejects({}, rrssJobInput({ accountIds: [7] }), (error) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD');
  await rejects({ accounts: [ACCOUNT_GMB] }, rrssJobInput(), (error) => error.statusCode === 409 && error.code === 'ACCOUNT_NOT_AVAILABLE');
  await rejects({ item: { ...RRSS_ITEM, status: 'proposed' } }, rrssJobInput(), (error) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION');
  await rejects({ item: { ...RRSS_ITEM, status: 'generating' } }, rrssJobInput(), (error) => error.statusCode === 409 && error.code === 'GENERATION_RELEASE_REQUIRED');
  await rejects({}, rrssJobInput(undefined, { expectedVersion: 2 }), (error) => error.statusCode === 409 && error.code === 'STALE_VERSION');
  await rejects({}, rrssJobInput(undefined, { expectedVersion: undefined }), (error) => error.statusCode === 400 && error.code === 'TARGET_VERSION_REQUIRED');
  await rejects({ activeJob: true }, rrssJobInput(), (error) => error.statusCode === 409 && error.code === 'JOB_IN_PROGRESS');
});

test('generate_rrss accepts review, ready and generation_failed items', async () => {
  for (const status of ['review', 'ready', 'generation_failed']) {
    const { pool, captured } = rrssJobPool({ item: { ...RRSS_ITEM, status } });
    await new EditorialApiRepository(pool).createJob(rrssJobInput(), 'user-1');
    assert.equal(captured.job.planItem.id, 'item-1', status);
  }
});

// ---------------------------------------------------------------------------
// generate_rrss: claim

test('claim rebuilds the generate_rrss payload from the database on every attempt', async () => {
  const writes: any[] = [];
  const { pool, statements } = poolWithClient((sql, values) => {
    if (sql.includes('SELECT j.* FROM editorial.jobs')) return one({ id: 'job-rrss', client_id: 'client-a', kind: 'generate_rrss', target_id: 'item-1', payload: { accountIds: [ACCOUNT_GMB.id], planItem: { title: 'Viejo' } } });
    if (sql.includes('SELECT status FROM editorial.plan_items')) return one({ status: 'generation_failed' });
    if (sql.includes('SELECT * FROM editorial.plan_items')) return one({ ...RRSS_ITEM, title: 'Título actualizado', networks: ['facebook'] });
    if (sql.includes('FROM editorial.publishing_accounts')) return one({ ...ACCOUNT_GMB, label: 'GMB renombrada' });
    if (sql.includes('UPDATE editorial.jobs SET payload')) { writes.push(JSON.parse(String(values[1]))); return { rows: [], rowCount: 1 }; }
    if (sql.includes("UPDATE editorial.jobs SET status='running'")) return one({ id: 'job-rrss', payload: writes[0] });
    return none;
  });
  const claimed: any = await new EditorialApiRepository(pool).claimJob({ leaseSeconds: 60, executionId: 'run-1' }, ['*']);
  assert.ok(statements.some(({ sql }) => sql.includes("UPDATE editorial.plan_items SET status='generating'")), 'the item is moved back to generating');
  assert.equal(writes[0].planItem.title, 'Título actualizado');
  assert.deepEqual(writes[0].planItem.networks, ['facebook']);
  assert.deepEqual(writes[0].accountIds, [ACCOUNT_GMB.id]);
  assert.deepEqual(writes[0].accounts, [{ id: ACCOUNT_GMB.id, instanceKey: 'inficonglobal-gmb', network: 'gmb', label: 'GMB renombrada', externalAccountId: 'cmt-gmb' }]);
  assert.equal(claimed.payload.planItem.title, 'Título actualizado');
  assert.equal(writes[0].generateImage, true, 'older payloads without the flag default to generating an image');
});

test('claim keeps generateImage false across the payload rebuild', async () => {
  const writes: any[] = [];
  const { pool } = poolWithClient((sql, values) => {
    if (sql.includes('SELECT j.* FROM editorial.jobs')) return one({ id: 'job-rrss', client_id: 'client-a', kind: 'generate_rrss', target_id: 'item-1', payload: { accountIds: [ACCOUNT_GMB.id], generateImage: false } });
    if (sql.includes('SELECT status FROM editorial.plan_items')) return one({ status: 'generating' });
    if (sql.includes('SELECT * FROM editorial.plan_items')) return one(RRSS_ITEM);
    if (sql.includes('FROM editorial.publishing_accounts')) return one(ACCOUNT_GMB);
    if (sql.includes('UPDATE editorial.jobs SET payload')) { writes.push(JSON.parse(String(values[1]))); return { rows: [], rowCount: 1 }; }
    if (sql.includes("UPDATE editorial.jobs SET status='running'")) return one({ id: 'job-rrss', payload: writes[0] });
    return none;
  });
  const claimed: any = await new EditorialApiRepository(pool).claimJob({ leaseSeconds: 60, executionId: 'run-1' }, ['*']);
  assert.equal(writes[0].generateImage, false);
  assert.equal(claimed.payload.generateImage, false);
});

// ---------------------------------------------------------------------------
// generate_rrss: result

const RRSS_JOB = { id: '44444444-4444-4444-8444-444444444444', client_id: 'client-a', kind: 'generate_rrss', target_id: 'item-1', status: 'running', lease_token: 'lease-1', payload: { accountIds: [ACCOUNT_GMB.id, ACCOUNT_IG.id] } };

function rrssFinishPool(options: { existing?: any[]; planStatus?: string } = {}) {
  const fake = poolWithClient((sql) => {
    if (sql.includes('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE')) return one({ ...RRSS_JOB, locked_until: new Date(Date.now() + 60_000).toISOString() });
    if (sql.includes('SELECT * FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return one({ ...RRSS_ITEM, status: options.planStatus ?? 'generating' });
    if (sql.includes('SELECT status FROM editorial.plan_items')) return one({ status: options.planStatus ?? 'generating' });
    if (sql.includes('FROM editorial.publishing_accounts')) return { rows: [ACCOUNT_GMB, ACCOUNT_IG], rowCount: 2 };
    if (sql.includes('FROM editorial.social_posts') && sql.includes('FOR UPDATE')) return { rows: options.existing ?? [], rowCount: (options.existing ?? []).length };
    if (sql.includes('UPDATE editorial.jobs SET status')) return one({ id: RRSS_JOB.id, status: 'done' });
    return none;
  });
  return { ...fake, finish: (input: any) => new EditorialApiRepository(fake.pool).finishJob(RRSS_JOB.id, 'lease-1', { schemaVersion: 1, clientId: 'client-a', ...input }, 'service-1') };
}

test('a generate_rrss result upserts one draft per account, derives the network and moves the idea to review', async () => {
  const { statements, finish } = rrssFinishPool({ existing: [{ id: 'post-ig', account_id: ACCOUNT_IG.id, status: 'scheduled' }] });
  await finish({ status: 'succeeded', socialPosts: [
    { accountId: ACCOUNT_GMB.id, copy: 'Copy para GMB', media: [{ url: 'https://cdn.example/gmb.jpg' }] },
    { accountId: ACCOUNT_IG.id, copy: 'Copy para Instagram' },
  ], result: { workflowVersion: 1 } });
  const upserts = statements.filter(({ sql }) => sql.includes('INSERT INTO editorial.social_posts'));
  assert.equal(upserts.length, 1, 'the scheduled Instagram post is not overwritten');
  const upsert = upserts[0];
  assert.match(upsert.sql, /ON CONFLICT \(client_id,plan_item_id,account_id\) DO UPDATE/);
  assert.match(upsert.sql, /status='review'/);
  assert.match(upsert.sql, /version=editorial\.social_posts\.version\+1/);
  assert.match(upsert.sql, /WHERE editorial\.social_posts\.status<>'scheduled'/);
  assert.deepEqual(upsert.values.slice(1, 5), ['client-a', 'item-1', ACCOUNT_GMB.id, 'gmb']);
  assert.equal(upsert.values[5], 'Copy para GMB');
  assert.deepEqual(JSON.parse(String(upsert.values[6])), [{ url: 'https://cdn.example/gmb.jpg' }]);
  assert.equal(upsert.values[7], RRSS_JOB.id);
  const planUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.plan_items'))!;
  assert.match(planUpdate.sql, /status='review'/);
  const jobUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.jobs SET status'))!;
  assert.equal(jobUpdate.values[1], 'succeeded');
  const stored = JSON.parse(String(jobUpdate.values[2]));
  assert.equal(stored.workflowVersion, 1);
  assert.deepEqual(stored.socialPosts, { upsertedAccountIds: [ACCOUNT_GMB.id], skippedScheduledAccountIds: [ACCOUNT_IG.id] });
  const sqls = statements.map(({ sql }) => sql);
  assert.ok(sqls.indexOf('BEGIN') < sqls.findIndex((sql) => sql.includes('INSERT INTO editorial.social_posts')) && sqls.indexOf('COMMIT') > sqls.findIndex((sql) => sql.includes('UPDATE editorial.plan_items')), 'applied in one transaction');
});

test('a generate_rrss result is validated before anything is written', async () => {
  const invalid = [
    [{ status: 'succeeded' }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [] }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [{ accountId: ACCOUNT_GMB.id, copy: '   ' }] }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [{ accountId: ACCOUNT_GMB.id, copy: 'x'.repeat(20_001) }] }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [{ accountId: ACCOUNT_GMB.id, copy: 'ok', media: [{ url: 'ftp://nope' }] }] }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [{ accountId: ACCOUNT_GMB.id, copy: 'a' }, { accountId: ACCOUNT_GMB.id, copy: 'b' }] }, 'INVALID_RESULT'],
    [{ status: 'succeeded', socialPosts: [{ accountId: '99999999-9999-4999-8999-999999999999', copy: 'Cuenta ajena' }] }, 'ACCOUNT_MISMATCH'],
  ] as const;
  for (const [input, code] of invalid) {
    const { statements, finish } = rrssFinishPool();
    await assert.rejects(() => finish(input), (error: any) => error.code === code, JSON.stringify(input).slice(0, 80));
    assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.social_posts') || sql.includes('UPDATE editorial.plan_items')), false);
  }
});

test('a failed generate_rrss job marks the idea generation_failed', async () => {
  const { statements, finish } = rrssFinishPool();
  await finish({ status: 'failed', error: 'OpenAI 500' });
  const planUpdate = statements.find(({ sql }) => sql.includes('UPDATE editorial.plan_items'))!;
  assert.match(planUpdate.sql, /status='generation_failed'/);
  assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.social_posts')), false);
});

// ---------------------------------------------------------------------------
// releaseGeneration covers generate_rrss

test('releasing a stuck RRSS generation also freezes its generate_rrss jobs', async () => {
  const { pool, statements } = poolWithClient((sql) => {
    if (sql.includes('SELECT client_id FROM editorial.plan_items')) return one({ client_id: 'client-a' });
    if (sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return one({ ...RRSS_ITEM, status: 'generating' });
    if (sql.includes('UPDATE editorial.jobs')) return one({ id: 'job-rrss' });
    if (sql.includes('UPDATE editorial.plan_items')) return one({ ...RRSS_ITEM, status: 'generation_failed', version: 4 });
    return none;
  });
  const released = await new EditorialApiRepository(pool).releaseGeneration('item-1', 3, 'user-1');
  assert.equal((released as any).status, 'generation_failed');
  const jobQueries = statements.filter(({ sql }) => sql.includes('FROM editorial.jobs') || sql.includes('UPDATE editorial.jobs'));
  assert.equal(jobQueries.length, 3);
  for (const { sql } of jobQueries) assert.match(sql, /\(kind='generate_content' OR kind='generate_rrss'\)/);
});

// ---------------------------------------------------------------------------
// Social post drafts

const POST = { id: 'post-1', client_id: 'client-a', plan_item_id: 'item-1', account_id: ACCOUNT_GMB.id, network: 'gmb', copy: 'Copy original', media: [{ url: 'https://cdn.example/a.jpg' }], status: 'review', publication_id: null, generation_job_id: RRSS_JOB.id, version: 2, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };

function postPool(post: any) {
  return poolWithClient((sql, values) => {
    if (sql.includes('SELECT * FROM editorial.social_posts WHERE id=$1 FOR UPDATE')) return post ? one(post) : none;
    if (sql.includes('UPDATE editorial.social_posts')) {
      if (sql.includes('copy=COALESCE')) return one({ ...post, copy: values[1] ?? post.copy, media: values[2] ? JSON.parse(String(values[2])) : post.media, status: 'review', version: post.version + 1 });
      return one({ ...post, status: values[1], version: post.version + 1 });
    }
    return none;
  });
}

test('editing a draft bumps its version, returns approved posts to review and refuses scheduled or discarded posts', async () => {
  const approved = postPool({ ...POST, status: 'approved' });
  const edited: any = await new EditorialApiRepository(approved.pool).patchSocialPost('post-1', { copy: 'Copy editado', expectedVersion: 2 }, 'user-1');
  assert.equal(edited.status, 'review');
  assert.equal(edited.copy, 'Copy editado');
  assert.equal(edited.version, 3);
  assert.equal(edited.planItemId, 'item-1');
  const update = approved.statements.find(({ sql }) => sql.includes('UPDATE editorial.social_posts'))!;
  assert.match(update.sql, /status='review'/);
  assert.match(update.sql, /version=version\+1/);

  const media = postPool(POST);
  await new EditorialApiRepository(media.pool).patchSocialPost('post-1', { media: [{ url: 'https://cdn.example/b.jpg' }], expectedVersion: 2 }, 'user-1');
  const mediaUpdate = media.statements.find(({ sql }) => sql.includes('UPDATE editorial.social_posts'))!;
  assert.deepEqual(JSON.parse(String(mediaUpdate.values[2])), [{ url: 'https://cdn.example/b.jpg' }]);

  for (const status of ['scheduled', 'discarded']) {
    const locked = postPool({ ...POST, status });
    await assert.rejects(() => new EditorialApiRepository(locked.pool).patchSocialPost('post-1', { copy: 'x', expectedVersion: 2 }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION', status);
    assert.equal(locked.statements.some(({ sql }) => sql.includes('UPDATE editorial.social_posts')), false);
  }
  await assert.rejects(() => new EditorialApiRepository(postPool(POST).pool).patchSocialPost('post-1', { copy: 'x', expectedVersion: 1 }, 'user-1'), (error: any) => error.code === 'STALE_VERSION');
  await assert.rejects(() => new EditorialApiRepository(postPool(null).pool).patchSocialPost('post-1', { copy: 'x', expectedVersion: 2 }, 'user-1'), (error: any) => error.statusCode === 404);
});

test('approving and discarding drafts follow review -> approved and review|approved -> discarded', async () => {
  const approved: any = await new EditorialApiRepository(postPool(POST).pool).approveSocialPost('post-1', 2, 'user-1');
  assert.equal(approved.status, 'approved');
  for (const status of ['approved', 'scheduled', 'discarded']) {
    await assert.rejects(() => new EditorialApiRepository(postPool({ ...POST, status }).pool).approveSocialPost('post-1', undefined, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION', `approve from ${status}`);
  }
  for (const status of ['review', 'approved']) {
    const discarded: any = await new EditorialApiRepository(postPool({ ...POST, status }).pool).discardSocialPost('post-1', undefined, 'user-1');
    assert.equal(discarded.status, 'discarded');
  }
  for (const status of ['scheduled', 'discarded']) {
    await assert.rejects(() => new EditorialApiRepository(postPool({ ...POST, status }).pool).discardSocialPost('post-1', undefined, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION', `discard from ${status}`);
  }
  await assert.rejects(() => new EditorialApiRepository(postPool(POST).pool).approveSocialPost('post-1', 9, 'user-1'), (error: any) => error.code === 'STALE_VERSION');
});

function schedulePool(options: { post?: any; content?: any; existingJob?: any } = {}) {
  const post = options.post ?? { ...POST, status: 'approved' };
  const fake = poolWithClient((sql, values) => {
    if (sql.includes('SELECT enabled FROM editorial.client_settings')) return one({ enabled: true });
    if (sql.includes('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2')) return options.existingJob ? one(options.existingJob) : none;
    if (sql.includes('SELECT plan_item_id FROM editorial.social_posts')) return one({ plan_item_id: post.plan_item_id });
    if (sql.includes('FROM editorial.plan_items')) return one({ ...RRSS_ITEM, status: 'review' });
    if (sql.includes('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND id=$2 FOR UPDATE')) return one(post);
    if (sql.includes('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND publication_id=$2')) return one({ ...post, status: 'scheduled', publication_id: 'publication-old' });
    if (sql.includes('SELECT * FROM editorial.contents')) return options.content ? one(options.content) : none;
    if (sql.includes('INSERT INTO editorial.contents')) return one({ id: values[0], client_id: values[1], plan_item_id: values[2], status: 'approved' });
    if (sql.includes('INSERT INTO editorial.content_revisions')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE editorial.contents SET approved_revision_id')) return one({ id: values[1], approved_revision_id: values[2], status: 'approved' });
    if (sql.includes('SELECT * FROM editorial.publishing_accounts')) return one(ACCOUNT_GMB);
    if (sql.includes('FROM editorial.publications WHERE content_id')) return none;
    if (sql.includes('INSERT INTO editorial.publications')) return one({ id: values[0], client_id: values[1], content_id: values[2], account_id: values[3], occurrence_key: values[4], content_revision_id: values[5], copy: values[6], media: JSON.parse(String(values[7])), status: 'pending', desired_scheduled_at: values[8], external_url: values[9] });
    if (sql.includes('INSERT INTO editorial.jobs')) return one({ id: values[0], client_id: values[1], kind: 'publish', target_id: values[2], request_hash: values[4], payload: JSON.parse(String(values[5])), status: 'pending' });
    if (sql.includes('SELECT p.*,a.provider')) return one({ id: 'publication-old', status: 'pending' });
    if (sql.includes("UPDATE editorial.social_posts SET status='scheduled'")) return one({ ...post, status: 'scheduled', publication_id: values[2], version: post.version + 1 });
    return none;
  });
  return fake;
}

const scheduleSocialInput = { clientId: 'client-a', desiredScheduledAt: '2026-10-10T09:00:00.000Z', externalUrl: 'https://example.com/oferta', expectedVersion: 2, idempotencyKey: 'social-schedule-1' };

test('scheduling an approved draft creates the RRSS content, a publication with its copy and media, and a publish job', async () => {
  const { pool, statements } = schedulePool();
  const scheduled: any = await new EditorialApiRepository(pool).scheduleSocialPost('post-1', scheduleSocialInput, 'user-1');
  assert.equal(scheduled.replayed, false);
  const contentInsert = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.contents'))!;
  assert.match(contentInsert.sql, /'approved'/);
  assert.equal(contentInsert.values[2], 'item-1');
  assert.equal(contentInsert.values[3], 'Idea de verano');
  assert.equal(contentInsert.values[4], 'Temporada alta');
  const revision = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.content_revisions'))!;
  assert.match(revision.sql, /'system'/);
  const approval = statements.find(({ sql }) => sql.includes('UPDATE editorial.contents SET approved_revision_id'))!;
  assert.equal(approval.values[2], revision.values[0]);
  const publication = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.publications'))!;
  assert.equal(publication.values[3], ACCOUNT_GMB.id);
  assert.equal(publication.values[4], 'primary');
  assert.equal(publication.values[5], revision.values[0], 'publication pins the approved revision');
  assert.equal(publication.values[6], 'Copy original');
  assert.deepEqual(JSON.parse(String(publication.values[7])), [{ url: 'https://cdn.example/a.jpg' }]);
  assert.equal(publication.values[8], '2026-10-10T09:00:00.000Z');
  assert.equal(publication.values[9], 'https://example.com/oferta');
  const job = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.jobs'))!;
  assert.match(job.sql, /'publish'/);
  const jobPayload = JSON.parse(String(job.values[5]));
  assert.equal(jobPayload.publication.copy, 'Copy original');
  assert.deepEqual(jobPayload.publication.media, [{ url: 'https://cdn.example/a.jpg' }]);
  assert.equal(jobPayload.publication.instanceKey, 'inficonglobal-gmb');
  const postUpdate = statements.find(({ sql }) => sql.includes("UPDATE editorial.social_posts SET status='scheduled'"))!;
  assert.equal(postUpdate.values[2], publication.values[0]);
  assert.equal(scheduled.socialPost.status, 'scheduled');
  assert.equal(scheduled.socialPost.publicationId, publication.values[0]);
  assert.equal(scheduled.job.kind, 'publish');
  const sqls = statements.map(({ sql }) => sql);
  assert.ok(sqls.indexOf('BEGIN') >= 0 && sqls.indexOf('COMMIT') > sqls.findIndex((sql) => sql.includes("UPDATE editorial.social_posts SET status='scheduled'")));
  assert.ok(statements.some(({ sql, values }) => sql.includes('pg_advisory_xact_lock') && values.includes('job:client-a:social-schedule-1')));
  const planLock = sqls.findIndex((sql) => sql.includes('FROM editorial.plan_items'));
  const postLock = sqls.findIndex((sql) => sql.includes('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND id=$2 FOR UPDATE'));
  assert.ok(planLock >= 0 && planLock < postLock, 'plan item locked before the post, in the same order as the generate_rrss result');
});

test('scheduling reuses the RRSS content of the idea and refuses drafts that are not approved', async () => {
  const reuse = schedulePool({ content: { id: 'content-rrss', client_id: 'client-a', plan_item_id: 'item-1', status: 'approved', approved_revision_id: 'revision-rrss' } });
  await new EditorialApiRepository(reuse.pool).scheduleSocialPost('post-1', scheduleSocialInput, 'user-1');
  assert.equal(reuse.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.contents')), false);
  const publication = reuse.statements.find(({ sql }) => sql.includes('INSERT INTO editorial.publications'))!;
  assert.equal(publication.values[2], 'content-rrss');
  assert.equal(publication.values[5], 'revision-rrss');

  for (const status of ['review', 'scheduled', 'discarded']) {
    const refused = schedulePool({ post: { ...POST, status } });
    await assert.rejects(() => new EditorialApiRepository(refused.pool).scheduleSocialPost('post-1', scheduleSocialInput, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION', status);
    assert.equal(refused.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.publications')), false);
  }
  await assert.rejects(() => new EditorialApiRepository(schedulePool().pool).scheduleSocialPost('post-1', { ...scheduleSocialInput, expectedVersion: 1 }, 'user-1'), (error: any) => error.code === 'STALE_VERSION');
});

test('replaying a social schedule returns the original publication and refuses a different request under the same key', async () => {
  const hash = requestHash({ kind: 'publish', socialPostId: 'post-1', desiredScheduledAt: scheduleSocialInput.desiredScheduledAt, externalUrl: scheduleSocialInput.externalUrl, expectedVersion: 2 });
  const replay = schedulePool({ existingJob: { id: 'job-old', target_id: 'publication-old', request_hash: hash } });
  const result: any = await new EditorialApiRepository(replay.pool).scheduleSocialPost('post-1', scheduleSocialInput, 'user-1');
  assert.equal(result.replayed, true);
  assert.equal(result.job.id, 'job-old');
  assert.equal(result.socialPost.publicationId, 'publication-old');
  assert.equal(replay.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.publications')), false);

  const conflict = schedulePool({ existingJob: { id: 'job-old', target_id: 'publication-old', request_hash: 'other' } });
  await assert.rejects(() => new EditorialApiRepository(conflict.pool).scheduleSocialPost('post-1', scheduleSocialInput, 'user-1'), (error: any) => error.code === 'IDEMPOTENCY_CONFLICT');
});

// ---------------------------------------------------------------------------
// Manual ideas

test('a manual RRSS idea goes into the per-client "Ideas sueltas" calendar, created on first use', async () => {
  const created = poolWithClient((sql, values) => {
    if (sql.includes('INSERT INTO editorial.plan_items')) return one({ id: values[0], calendar_id: values[2], status: 'proposed' });
    return none;
  });
  const item: any = await new EditorialApiRepository(created.pool).createRrssIdea({ clientId: 'client-a', title: 'Idea manual', networks: ['instagram'], format: 'reel', keywords: ['verano'], plannedAt: '2026-10-20T09:00:00.000Z' }, 'user-1');
  const lookup = created.statements.find(({ sql }) => sql.includes('FROM editorial.calendars'))!;
  assert.match(lookup.sql, /kind='rrss'/);
  assert.deepEqual(lookup.values, ['client-a', 'Ideas sueltas']);
  const calendarInsert = created.statements.find(({ sql }) => sql.includes('INSERT INTO editorial.calendars'))!;
  assert.match(calendarInsert.sql, /'rrss'/);
  assert.equal(calendarInsert.values[2], 'Ideas sueltas');
  const itemInsert = created.statements.find(({ sql }) => sql.includes('INSERT INTO editorial.plan_items'))!;
  assert.match(itemInsert.sql, /'proposed'/);
  assert.equal(itemInsert.values[2], calendarInsert.values[0]);
  assert.equal(itemInsert.values[3], 'Idea manual');
  assert.equal(itemInsert.values[6], 'reel');
  assert.deepEqual(JSON.parse(String(itemInsert.values[11])), ['instagram']);
  assert.equal(item.status, 'proposed');
  assert.ok(created.statements.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));

  const reused = poolWithClient((sql, values) => {
    if (sql.includes('FROM editorial.calendars')) return one({ id: 'calendar-ideas' });
    if (sql.includes('INSERT INTO editorial.plan_items')) return one({ id: values[0], calendar_id: values[2], status: 'proposed' });
    return none;
  });
  await new EditorialApiRepository(reused.pool).createRrssIdea({ clientId: 'client-a', title: 'Otra idea' }, 'user-1');
  assert.equal(reused.statements.some(({ sql }) => sql.includes('INSERT INTO editorial.calendars')), false);
  assert.equal(reused.statements.find(({ sql }) => sql.includes('INSERT INTO editorial.plan_items'))!.values[2], 'calendar-ideas');
});

// ---------------------------------------------------------------------------
// RRSS plan inputs

test('RRSS plan inputs are validated and normalized', () => {
  assert.deepEqual(normalizeRrssPlanInputs({ topic: '  Turismo  ', keywords: [' rural ', 'RURAL', 'casas'], networks: ['gmb', 'instagram', 'gmb'], postsPerWeek: 3 }), { topic: 'Turismo', keywords: ['rural', 'casas'], networks: ['gmb', 'instagram'], postsPerWeek: 3, weeksHorizon: 4 });
  assert.deepEqual(normalizeRrssPlanInputs({ topic: 'T', networks: ['facebook'], postsPerWeek: 14, weeksHorizon: 12 }), { topic: 'T', keywords: [], networks: ['facebook'], postsPerWeek: 14, weeksHorizon: 12 });
  const invalid: any[] = [
    { networks: ['gmb'], postsPerWeek: 1 },
    { topic: '  ', networks: ['gmb'], postsPerWeek: 1 },
    { topic: 'x'.repeat(201), networks: ['gmb'], postsPerWeek: 1 },
    { topic: 'T', keywords: 'seo', networks: ['gmb'], postsPerWeek: 1 },
    { topic: 'T', keywords: Array.from({ length: 21 }, (_, index) => `kw ${index}`), networks: ['gmb'], postsPerWeek: 1 },
    { topic: 'T', keywords: ['x'.repeat(101)], networks: ['gmb'], postsPerWeek: 1 },
    { topic: 'T', networks: [], postsPerWeek: 1 },
    { topic: 'T', networks: ['tiktok'], postsPerWeek: 1 },
    { topic: 'T', networks: ['other'], postsPerWeek: 1 },
    { topic: 'T', networks: ['gmb'] },
    { topic: 'T', networks: ['gmb'], postsPerWeek: 0 },
    { topic: 'T', networks: ['gmb'], postsPerWeek: 15 },
    { topic: 'T', networks: ['gmb'], postsPerWeek: 2.5 },
    { topic: 'T', networks: ['gmb'], postsPerWeek: 2, weeksHorizon: 0 },
    { topic: 'T', networks: ['gmb'], postsPerWeek: 2, weeksHorizon: 13 },
  ];
  for (const input of invalid) assert.throws(() => normalizeRrssPlanInputs(input), (error: any) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD', JSON.stringify(input).slice(0, 80));
});

test('RRSS plan inputs are read leniently and merged into editorial_config.rrss preserving other keys', async () => {
  const read = poolWithClient(() => one({ editorial_config: { topic: 'Blog', rrss: { topic: ' Redes ', keywords: ['a', 5], networks: ['gmb', 'tiktok'], postsPerWeek: 4 } } }));
  assert.deepEqual(await new EditorialApiRepository(read.pool).getRrssPlanInputs('client-a'), { topic: 'Redes', keywords: ['a'], networks: ['gmb'], postsPerWeek: 4, weeksHorizon: 4 });
  const empty = poolWithClient(() => one({ editorial_config: {} }));
  assert.deepEqual(await new EditorialApiRepository(empty.pool).getRrssPlanInputs('client-a'), { topic: '', keywords: [], networks: [], postsPerWeek: null, weeksHorizon: 4 });
  await assert.rejects(() => new EditorialApiRepository(poolWithClient(() => none).pool).getRrssPlanInputs('client-x'), (error: any) => error.code === 'EDITORIAL_DISABLED');

  const save = poolWithClient((sql) => sql.includes('UPDATE editorial.client_settings') ? one({ client_id: 'client-a' }) : none);
  const saved = await new EditorialApiRepository(save.pool).saveRrssPlanInputs('client-a', { topic: 'Redes', networks: ['instagram'], postsPerWeek: 2 });
  assert.deepEqual(saved, { topic: 'Redes', keywords: [], networks: ['instagram'], postsPerWeek: 2, weeksHorizon: 4 });
  const update = save.statements.find(({ sql }) => sql.includes('UPDATE editorial.client_settings'))!;
  // Merged into the existing rrss object (a non-object value is replaced), never over the whole editorial_config.
  assert.match(update.sql, /jsonb_set\(COALESCE\(editorial_config,'\{\}'::jsonb\),'\{rrss\}',CASE WHEN jsonb_typeof\(editorial_config->'rrss'\)='object' THEN editorial_config->'rrss' ELSE '\{\}'::jsonb END\s*\|\|\s*\$2::jsonb,true\)/);
  assert.deepEqual(JSON.parse(String(update.values[1])), saved);
});

// ---------------------------------------------------------------------------
// Routes

function rrssRepository(calls: unknown[][]) {
  return {
    async getPlanItem(id: string) { return id === 'item-1' ? RRSS_ITEM : id === 'item-b' ? { ...RRSS_ITEM, id: 'item-b', client_id: 'client-b' } : null; },
    async patchPlanItem(id: string, input: any) { calls.push(['patchPlanItem', id, input]); return { ...RRSS_ITEM, ...input }; },
    async listRrssItems(filters: any) { calls.push(['listRrssItems', filters]); return { items: [], nextCursor: null }; },
    async createRrssIdea(input: any, actorId: string) { calls.push(['createRrssIdea', input, actorId]); return { id: 'item-new', status: 'proposed' }; },
    async listSocialPosts(planItemId: string) { calls.push(['listSocialPosts', planItemId]); return [{ id: 'post-1' }]; },
    async getSocialPost(id: string) { return id === 'post-1' ? { id: 'post-1', clientId: 'client-a' } : id === 'post-b' ? { id: 'post-b', clientId: 'client-b' } : null; },
    async patchSocialPost(id: string, input: any) { calls.push(['patchSocialPost', id, input]); return { id, status: 'review' }; },
    async approveSocialPost(id: string, version: unknown) { calls.push(['approveSocialPost', id, version]); return { id, status: 'approved' }; },
    async discardSocialPost(id: string, version: unknown) { calls.push(['discardSocialPost', id, version]); return { id, status: 'discarded' }; },
    async scheduleSocialPost(id: string, input: any) { calls.push(['scheduleSocialPost', id, input]); return { socialPost: { id, status: 'scheduled' }, publication: { id: 'publication-1' }, job: { id: 'job-1' }, replayed: false }; },
    async getRrssPlanInputs(clientId: string) { calls.push(['getRrssPlanInputs', clientId]); return { topic: 'T', keywords: [], networks: ['gmb'], postsPerWeek: 2, weeksHorizon: 4 }; },
    async saveRrssPlanInputs(clientId: string, input: unknown) { calls.push(['saveRrssPlanInputs', clientId, input]); return input; },
  };
}

async function rrssApp(calls: unknown[][]) {
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: rrssRepository(calls) as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } } : null,
  });
  return app;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

test('RRSS item routes: viewers list, admins create manual ideas with validated networks and formats', async () => {
  const calls: unknown[][] = [];
  const app = await rrssApp(calls);
  const listed = await app.inject({ method: 'GET', url: '/api/clients/client-a/rrss/items?status=approved&limit=10&includeUndated=true', headers: as('viewer') });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(calls[0][0], 'listRrssItems');
  assert.equal((calls[0][1] as any).clientId, 'client-a');
  assert.equal((calls[0][1] as any).status, 'approved');
  assert.equal((calls[0][1] as any).limit, 10);
  assert.equal((calls[0][1] as any).includeUndated, true);
  assert.equal((await app.inject({ method: 'GET', url: '/api/clients/client-b/rrss/items', headers: as('viewer') })).statusCode, 403);

  const body = { title: 'Idea', networks: ['instagram'], format: 'carousel', keywords: ['k'], plannedAt: '2026-10-20T09:00:00.000Z' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/clients/client-a/rrss/items', headers: as('viewer'), payload: body })).statusCode, 403);
  const created = await app.inject({ method: 'POST', url: '/api/clients/client-a/rrss/items', headers: as('admin'), payload: body });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().planItem.id, 'item-new');
  const createCall = calls.find(([name]) => name === 'createRrssIdea')!;
  assert.deepEqual((createCall[1] as any).networks, ['instagram']);
  assert.equal((createCall[1] as any).clientId, 'client-a');
  for (const invalid of [{ ...body, title: '' }, { ...body, networks: ['tiktok'] }, { ...body, format: 'blog' }, { ...body, networks: 'gmb' }]) {
    const refused = await app.inject({ method: 'POST', url: '/api/clients/client-a/rrss/items', headers: as('admin'), payload: invalid });
    assert.equal(refused.statusCode, 400, JSON.stringify(invalid));
  }
  await app.close();
});

test('plan item PATCH validates networks', async () => {
  const calls: unknown[][] = [];
  const app = await rrssApp(calls);
  const ok = await app.inject({ method: 'PATCH', url: '/api/content/plan-items/item-1', headers: as('admin'), payload: { version: 3, networks: ['gmb', 'facebook'] } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual((calls[0][2] as any).networks, ['gmb', 'facebook']);
  const bad = await app.inject({ method: 'PATCH', url: '/api/content/plan-items/item-1', headers: as('admin'), payload: { version: 3, networks: ['myspace'] } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('social post routes: viewers read drafts, admins edit, approve, discard and schedule', async () => {
  const calls: unknown[][] = [];
  const app = await rrssApp(calls);
  const drafts = await app.inject({ method: 'GET', url: '/api/content/plan-items/item-1/social-posts', headers: as('viewer') });
  assert.equal(drafts.statusCode, 200);
  assert.deepEqual(drafts.json(), { socialPosts: [{ id: 'post-1' }] });
  assert.equal((await app.inject({ method: 'GET', url: '/api/content/plan-items/item-x/social-posts', headers: as('viewer') })).statusCode, 404);

  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('viewer'), payload: { copy: 'x', expectedVersion: 2 } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-x', headers: as('admin'), payload: { copy: 'x', expectedVersion: 2 } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('admin'), payload: { copy: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('admin'), payload: { expectedVersion: 2 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('admin'), payload: { copy: '  ', expectedVersion: 2 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('admin'), payload: { media: [{ url: 'javascript:alert(1)' }], expectedVersion: 2 } })).statusCode, 400);
  const patched = await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: as('admin'), payload: { copy: 'Nuevo', media: [{ url: 'https://cdn.example/x.jpg', alt: 'ignored' }], expectedVersion: 2 } });
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(calls.find(([name]) => name === 'patchSocialPost')![2], { copy: 'Nuevo', media: [{ url: 'https://cdn.example/x.jpg' }], expectedVersion: 2 });

  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/approve', headers: as('admin'), payload: { expectedVersion: 3 } })).json().socialPost.status, 'approved');
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/discard', headers: as('admin') })).json().socialPost.status, 'discarded');
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/approve', headers: as('viewer'), payload: {} })).statusCode, 403);

  const scheduleBody = { desiredScheduledAt: '2026-10-10T09:00:00.000Z', externalUrl: 'https://example.com', expectedVersion: 4, idempotencyKey: 'k-1' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/schedule', headers: as('admin'), payload: { ...scheduleBody, idempotencyKey: undefined } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/schedule', headers: as('admin'), payload: { ...scheduleBody, desiredScheduledAt: 'mañana' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/schedule', headers: as('admin'), payload: { ...scheduleBody, externalUrl: 'ftp://x' } })).statusCode, 400);
  const scheduled = await app.inject({ method: 'POST', url: '/api/social-posts/post-1/schedule', headers: as('admin'), payload: scheduleBody });
  assert.equal(scheduled.statusCode, 202);
  assert.equal(scheduled.json().socialPost.status, 'scheduled');
  assert.deepEqual(calls.find(([name]) => name === 'scheduleSocialPost')![2], { clientId: 'client-a', desiredScheduledAt: '2026-10-10T09:00:00.000Z', externalUrl: 'https://example.com/', expectedVersion: 4, idempotencyKey: 'k-1' });
  await app.close();
});

test('social post drafts of another client are refused to a scoped viewer', async () => {
  const calls: unknown[][] = [];
  const app = await rrssApp(calls);
  const refused = await app.inject({ method: 'GET', url: '/api/content/plan-items/item-b/social-posts', headers: as('viewer') });
  assert.equal(refused.statusCode, 403);
  assert.equal(calls.some(([name]) => name === 'listSocialPosts'), false);
  await app.close();
});

test('RRSS plan input routes are admin-only and client-scoped', async () => {
  const calls: unknown[][] = [];
  const app = await rrssApp(calls);
  const url = '/api/clients/client-a/rrss-plan-inputs';
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url, headers: as('viewer') })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url, headers: as('viewer'), payload: { topic: 'T' } })).statusCode, 403);
  assert.equal(calls.length, 0);
  assert.equal((await app.inject({ method: 'GET', url, headers: as('admin') })).json().weeksHorizon, 4);
  const payload = { topic: 'T', keywords: ['k'], networks: ['gmb'], postsPerWeek: 2, weeksHorizon: 3 };
  const saved = await app.inject({ method: 'PUT', url, headers: as('admin'), payload });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['saveRrssPlanInputs', 'client-a', payload]);
  await app.close();
});
