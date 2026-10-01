import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { EditorialApiRepository } from '../src/server/content/apiRepository.js';
import { contentRoutes } from '../src/server/content/routes.js';

type Statement = { sql: string; values: unknown[] };

function poolWithClient(handler: (sql: string, values: unknown[]) => { rows: any[]; rowCount?: number }) {
  const statements: Statement[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    return handler(sql, values);
  };
  const client = { query, release() {} };
  return { pool: { connect: async () => client, query } as unknown as Pool, statements };
}

const none = { rows: [], rowCount: 0 };
const one = (row: any) => ({ rows: [row], rowCount: 1 });

const ACCOUNT_IG = { id: '22222222-2222-4222-8222-222222222222', client_id: 'client-a', provider: 'postiz', instance_key: 'inficonglobal-instagram', external_account_id: 'cmt-ig', platform: 'blog', label: 'Instagram Inficon', active: true };
const RRSS_ITEM = { id: 'item-1', client_id: 'client-a', calendar_id: 'calendar-rrss', title: 'Idea de verano', status: 'proposed', version: 3, networks: ['instagram'], calendar_kind: 'rrss' };
const INPUT = { clientId: 'client-a', planItemId: 'item-1', accountId: ACCOUNT_IG.id, copy: 'Copy hecho en Canva' };

function manualPool(options: { item?: any; account?: any; duplicate?: boolean } = {}) {
  const item = options.item === undefined ? RRSS_ITEM : options.item;
  const account = options.account === undefined ? ACCOUNT_IG : options.account;
  return poolWithClient((sql, values) => {
    if (sql.includes('FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return item ? one(item) : none;
    if (sql.includes('FROM editorial.publishing_accounts')) return account ? one(account) : none;
    if (sql.includes('INSERT INTO editorial.social_posts')) {
      if (options.duplicate) return none;
      return one({ id: values[0], client_id: values[1], plan_item_id: values[2], account_id: values[3], network: values[4], copy: values[5], media: [], status: 'review', publication_id: null, generation_job_id: null, version: 1, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' });
    }
    return none;
  });
}

// ---------------------------------------------------------------------------
// Repository

test('a manual draft is created in review with empty media and the network from the account instance_key', async () => {
  const { pool, statements } = manualPool();
  const post: any = await new EditorialApiRepository(pool).createManualSocialPost(INPUT, 'user-1');
  assert.equal(post.status, 'review');
  assert.equal(post.network, 'instagram', 'derived from instance_key, not platform');
  assert.deepEqual(post.media, []);
  assert.equal(post.version, 1);
  assert.equal(post.generationJobId, null);
  assert.equal(post.planItemId, 'item-1');
  assert.equal(post.accountLabel, 'Instagram Inficon');
  assert.equal(post.copy, 'Copy hecho en Canva');
  const account = statements.find(({ sql }) => sql.includes('FROM editorial.publishing_accounts'))!;
  assert.match(account.sql, /active=TRUE/);
  assert.match(account.sql, /provider='postiz'/);
  assert.equal(account.values[0], 'client-a', 'the account must belong to the idea client');
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.social_posts'))!;
  assert.match(insert.sql, /'\[\]'::jsonb/);
  assert.match(insert.sql, /'review'/);
  assert.match(insert.sql, /ON CONFLICT \(client_id,plan_item_id,account_id\) DO NOTHING/);
  const sqls = statements.map(({ sql }) => sql);
  assert.ok(sqls.indexOf('BEGIN') >= 0 && sqls.indexOf('COMMIT') > sqls.indexOf(insert.sql));
  assert.ok(statements.some(({ sql, values }) => sql.includes('INSERT INTO editorial.events') && values.includes('social_post.created')));
});

test('a manual draft moves a proposed or approved idea to review with a version bump', async () => {
  for (const status of ['proposed', 'approved']) {
    const { pool, statements } = manualPool({ item: { ...RRSS_ITEM, status } });
    await new EditorialApiRepository(pool).createManualSocialPost(INPUT, 'user-1');
    const update = statements.find(({ sql }) => sql.includes('UPDATE editorial.plan_items'));
    assert.ok(update, status);
    assert.deepEqual(update!.values, ['client-a', 'item-1', 'review']);
    assert.match(update!.sql, /version=version\+1/);
  }
  for (const status of ['review', 'ready', 'generation_failed']) {
    const { pool, statements } = manualPool({ item: { ...RRSS_ITEM, status } });
    await new EditorialApiRepository(pool).createManualSocialPost(INPUT, 'user-1');
    assert.equal(statements.some(({ sql }) => sql.includes('UPDATE editorial.plan_items')), false, `${status} is left unchanged`);
  }
});

test('a manual draft is refused for blog items, generating ideas, unavailable accounts and existing drafts', async () => {
  const cases: Array<[string, any, number, string]> = [
    ['missing idea', { item: null }, 404, 'NOT_FOUND'],
    ['blog item', { item: { ...RRSS_ITEM, calendar_kind: 'blog' } }, 409, 'INVALID_TARGET'],
    ['generating idea', { item: { ...RRSS_ITEM, status: 'generating' } }, 409, 'GENERATION_IN_PROGRESS'],
    ['foreign or inactive account', { account: null }, 409, 'ACCOUNT_NOT_AVAILABLE'],
    ['duplicate draft', { duplicate: true }, 409, 'SOCIAL_POST_EXISTS'],
  ];
  for (const [label, options, statusCode, code] of cases) {
    const { pool, statements } = manualPool(options);
    await assert.rejects(() => new EditorialApiRepository(pool).createManualSocialPost(INPUT, 'user-1'), (error: any) => error.statusCode === statusCode && error.code === code, label);
    assert.equal(statements.some(({ sql }) => sql.includes('UPDATE editorial.plan_items')), false, `${label} leaves the idea unchanged`);
    assert.ok(statements.some(({ sql }) => sql === 'ROLLBACK'), `${label} rolls back`);
  }
  const { pool } = manualPool({ duplicate: true });
  await assert.rejects(() => new EditorialApiRepository(pool).createManualSocialPost(INPUT, 'user-1'), /Ya existe un borrador para esa cuenta; edítalo/);
});

// ---------------------------------------------------------------------------
// Route

async function manualApp() {
  const calls: unknown[][] = [];
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: {
      async getPlanItem(id: string) { return id === 'item-1' ? RRSS_ITEM : id === 'item-b' ? { ...RRSS_ITEM, id: 'item-b', client_id: 'client-b' } : null; },
      async createManualSocialPost(input: any, actorId: string) { calls.push(['createManualSocialPost', input, actorId]); return { id: 'post-new', planItemId: input.planItemId, accountId: input.accountId, network: 'instagram', copy: input.copy, media: [], status: 'review', version: 1 }; },
    } as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } }
      : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } }
      : token === 'viewer-b' ? { user: { id: 'user-3', role: 'viewer' as const, clientIds: ['client-b'] } } : null,
  });
  return { app, calls };
}

const URL_ITEM = '/api/content/plan-items/item-1/social-posts';
const as = (token: string) => ({ authorization: `Bearer ${token}` });

test('POST plan-items/:id/social-posts creates a manual draft for the item client and answers 201', async () => {
  const { app, calls } = await manualApp();
  const response = await app.inject({ method: 'POST', url: URL_ITEM, headers: as('admin'), payload: { accountId: ACCOUNT_IG.id, copy: 'Copy manual', clientId: 'client-x' } });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().socialPost.id, 'post-new');
  assert.equal(response.json().socialPost.status, 'review');
  assert.deepEqual(calls[0], ['createManualSocialPost', { clientId: 'client-a', planItemId: 'item-1', accountId: ACCOUNT_IG.id, copy: 'Copy manual' }, 'user-1'], 'the client comes from the idea, never the body');
  await app.close();
});

test('POST plan-items/:id/social-posts validates the copy and the account and is admin-only and client-scoped', async () => {
  const { app, calls } = await manualApp();
  for (const payload of [{ accountId: ACCOUNT_IG.id, copy: '   ' }, { accountId: ACCOUNT_IG.id }, { accountId: ACCOUNT_IG.id, copy: 'x'.repeat(20_001) }, { copy: 'Copy' }, { accountId: 42, copy: 'Copy' }]) {
    const refused = await app.inject({ method: 'POST', url: URL_ITEM, headers: as('admin'), payload });
    assert.equal(refused.statusCode, 400, JSON.stringify(payload).slice(0, 80));
  }
  assert.equal((await app.inject({ method: 'POST', url: URL_ITEM, payload: { accountId: ACCOUNT_IG.id, copy: 'Copy' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: URL_ITEM, headers: as('viewer'), payload: { accountId: ACCOUNT_IG.id, copy: 'Copy' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/content/plan-items/item-b/social-posts', headers: as('viewer'), payload: { accountId: ACCOUNT_IG.id, copy: 'Copy' } })).statusCode, 403, 'another client');
  assert.equal((await app.inject({ method: 'POST', url: URL_ITEM, headers: as('viewer-b'), payload: { accountId: ACCOUNT_IG.id, copy: 'Copy' } })).statusCode, 403, 'a session scoped to another client');
  assert.equal((await app.inject({ method: 'POST', url: '/api/content/plan-items/item-x/social-posts', headers: as('admin'), payload: { accountId: ACCOUNT_IG.id, copy: 'Copy' } })).statusCode, 404);
  assert.equal(calls.length, 0);
  await app.close();
});
