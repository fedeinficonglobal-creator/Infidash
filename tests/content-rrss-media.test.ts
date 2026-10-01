import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { EditorialApiRepository } from '../src/server/content/apiRepository.js';
import { ContentApiError, normalizeSocialMedia } from '../src/server/content/contracts.js';
import { contentRoutes } from '../src/server/content/routes.js';
import { createPostizUploader, postizConfigFromEnv } from '../src/server/content/postizUpload.js';

type Statement = { sql: string; values: unknown[] };

function poolWithClient(handler: (sql: string, values: unknown[]) => { rows: any[]; rowCount?: number }) {
  const statements: Statement[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    const result = handler(sql, values);
    if (sql.includes('SELECT enabled FROM editorial.client_settings') && !result.rows.length) return { rows: [{ enabled: true }], rowCount: 1 };
    if (sql.includes('SELECT workflow_bindings FROM editorial.client_settings') && !result.rows.length) return { rows: [{ workflow_bindings: { publish: 'wf-publish' } }], rowCount: 1 };
    return result;
  };
  const client = { query, release() {} };
  return { pool: { connect: async () => client, query } as unknown as Pool, statements };
}

const none = { rows: [], rowCount: 0 };
const one = (row: any) => ({ rows: [row], rowCount: 1 });

const ACCOUNT_GMB = { id: '11111111-1111-4111-8111-111111111111', client_id: 'client-a', provider: 'postiz', instance_key: 'inficonglobal-gmb', external_account_id: 'cmt-gmb', platform: 'blog', label: 'GMB Inficon', active: true };
const POST = { id: 'post-1', client_id: 'client-a', plan_item_id: 'item-1', account_id: ACCOUNT_GMB.id, network: 'gmb', copy: 'Copy original', media: [{ url: 'https://cdn.example/a.jpg', type: 'image', name: 'a.jpg' }], status: 'approved', publication_id: null, generation_job_id: null, version: 2, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
const RRSS_ITEM = { id: 'item-1', client_id: 'client-a', calendar_id: 'calendar-rrss', title: 'Idea de verano', rationale: 'Temporada alta', status: 'review', version: 3 };

// ---------------------------------------------------------------------------
// Media normalization keeps type and name

test('social media normalization keeps optional type and name and still drops unknown keys', () => {
  assert.deepEqual(normalizeSocialMedia([
    { url: 'https://cdn.example/a.jpg', type: 'image', name: 'Portada.jpg', alt: 'dropped' },
    { url: 'https://cdn.example/b.mp4', type: 'video' },
    { url: 'https://cdn.example/c.png' },
  ]), [
    { url: 'https://cdn.example/a.jpg', type: 'image', name: 'Portada.jpg' },
    { url: 'https://cdn.example/b.mp4', type: 'video' },
    { url: 'https://cdn.example/c.png' },
  ]);
  assert.throws(() => normalizeSocialMedia([{ url: 'https://cdn.example/a.jpg', type: 'gif' }]), (error: any) => error.statusCode === 400 && error.code === 'INVALID_PAYLOAD');
  assert.throws(() => normalizeSocialMedia([{ url: 'https://cdn.example/a.jpg', name: 'x'.repeat(201) }]), (error: any) => error.statusCode === 400);
  assert.throws(() => normalizeSocialMedia([{ url: 'https://cdn.example/a.jpg', name: 42 }]), (error: any) => error.statusCode === 400);
  assert.throws(() => normalizeSocialMedia([{ url: 'https://cdn.example/a.jpg', type: 'gif' }], 'socialPosts[0].media', 'INVALID_RESULT'), (error: any) => error.code === 'INVALID_RESULT');
});

test('a generate_rrss result keeps media type and name on the stored draft', async () => {
  const job = { id: '44444444-4444-4444-8444-444444444444', client_id: 'client-a', kind: 'generate_rrss', target_id: 'item-1', status: 'running', lease_token: 'lease-1', payload: { accountIds: [ACCOUNT_GMB.id] }, locked_until: new Date(Date.now() + 60_000).toISOString() };
  const { pool, statements } = poolWithClient((sql) => {
    if (sql.includes('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE')) return one(job);
    if (sql.includes('SELECT * FROM editorial.plan_items') && sql.includes('FOR UPDATE')) return one({ ...RRSS_ITEM, status: 'generating' });
    if (sql.includes('SELECT status FROM editorial.plan_items')) return one({ status: 'generating' });
    if (sql.includes('FROM editorial.publishing_accounts')) return one(ACCOUNT_GMB);
    if (sql.includes('UPDATE editorial.jobs SET status')) return one({ id: job.id, status: 'succeeded' });
    return none;
  });
  await new EditorialApiRepository(pool).finishJob(job.id, 'lease-1', { schemaVersion: 1, clientId: 'client-a', status: 'succeeded', socialPosts: [{ accountId: ACCOUNT_GMB.id, copy: 'Copy', media: [{ url: 'https://cdn.example/ai.png', type: 'image', name: 'Imagen IA', extra: true }] }] }, 'service-1');
  const upsert = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.social_posts'))!;
  assert.deepEqual(JSON.parse(String(upsert.values[6])), [{ url: 'https://cdn.example/ai.png', type: 'image', name: 'Imagen IA' }]);
});

// ---------------------------------------------------------------------------
// Postiz uploader

test('Postiz config comes from env and defaults the public URL to the API origin', () => {
  assert.equal(postizConfigFromEnv({}), null);
  assert.equal(postizConfigFromEnv({ POSTIZ_API_URL: 'https://postiz.example/api' }), null);
  assert.equal(postizConfigFromEnv({ POSTIZ_API_KEY: 'k' }), null);
  assert.deepEqual(postizConfigFromEnv({ POSTIZ_API_URL: 'https://postiz.example/api/', POSTIZ_API_KEY: ' key ' }), { apiUrl: 'https://postiz.example/api', apiKey: 'key', publicUrl: 'https://postiz.example' });
  assert.deepEqual(postizConfigFromEnv({ POSTIZ_API_URL: 'https://postiz.example/api', POSTIZ_API_KEY: 'key', POSTIZ_PUBLIC_URL: 'https://media.example/' }), { apiUrl: 'https://postiz.example/api', apiKey: 'key', publicUrl: 'https://media.example' });
  assert.equal(postizConfigFromEnv({ POSTIZ_API_URL: 'not a url', POSTIZ_API_KEY: 'key' }), null);
});

const CONFIG = { apiUrl: 'https://postiz.example/api', apiKey: 'secret-postiz-key', publicUrl: 'https://postiz.example' };
const FILE = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), filename: 'foto.jpg', mimetype: 'image/jpeg' };

test('the Postiz uploader posts the file as multipart with the API key and returns an absolute URL', async () => {
  const requests: Array<{ url: string; init: any }> = [];
  const upload = createPostizUploader(CONFIG, (async (url: string, init: any) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: 'u1', path: '/uploads/2026/10/foto.jpg' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any);
  const result = await upload(FILE);
  assert.equal(result.url, 'https://postiz.example/uploads/2026/10/foto.jpg', 'a relative path is absolutized');
  assert.equal(requests[0].url, 'https://postiz.example/api/public/v1/upload');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'secret-postiz-key');
  const body = requests[0].init.body as FormData;
  const file = body.get('file') as File;
  assert.equal(file.name, 'foto.jpg');
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.size, FILE.buffer.length);

  const absolute = createPostizUploader(CONFIG, (async () => new Response(JSON.stringify({ path: 'https://cdn.postiz.example/x.jpg' }), { status: 200 })) as any);
  assert.equal((await absolute(FILE)).url, 'https://cdn.postiz.example/x.jpg');
  const byUrl = createPostizUploader(CONFIG, (async () => new Response(JSON.stringify({ url: 'uploads/y.jpg' }), { status: 201 })) as any);
  assert.equal((await byUrl(FILE)).url, 'https://postiz.example/uploads/y.jpg');
});

test('Postiz failures become 502 POSTIZ_UPLOAD_FAILED without leaking the API key', async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => new Response('secret-postiz-key is invalid', { status: 401 }),
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    async () => new Response('not json', { status: 200 }),
    async () => new Response(JSON.stringify({ path: 'javascript:alert(1)' }), { status: 200 }),
    async () => { throw new Error('connect ECONNREFUSED secret-postiz-key'); },
  ];
  for (const failure of failures) {
    const upload = createPostizUploader(CONFIG, failure as any);
    await assert.rejects(() => upload(FILE), (error: any) => {
      assert.ok(error instanceof ContentApiError);
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, 'POSTIZ_UPLOAD_FAILED');
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details ?? null)}`, /secret-postiz-key/);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// Repository: appending media

function mediaPool(post: any) {
  return poolWithClient((sql, values) => {
    if (sql.includes('SELECT * FROM editorial.social_posts WHERE id=$1 FOR UPDATE')) return post ? one(post) : none;
    if (sql.includes('UPDATE editorial.social_posts')) return one({ ...post, media: JSON.parse(String(values[1])), status: 'review', version: post.version + 1 });
    return none;
  });
}

test('appending media locks the post, adds the item, returns it to review and bumps the version', async () => {
  const { pool, statements } = mediaPool(POST);
  const updated: any = await new EditorialApiRepository(pool).appendSocialPostMedia('post-1', { url: 'https://postiz.example/v.mp4', type: 'video', name: 'clip.mp4' }, 'user-1');
  assert.equal(updated.status, 'review');
  assert.equal(updated.version, 3);
  assert.deepEqual(updated.media, [POST.media[0], { url: 'https://postiz.example/v.mp4', type: 'video', name: 'clip.mp4' }]);
  const update = statements.find(({ sql }) => sql.includes('UPDATE editorial.social_posts'))!;
  assert.match(update.sql, /status='review'/);
  assert.match(update.sql, /version=version\+1/);
  const sqls = statements.map(({ sql }) => sql);
  assert.ok(sqls.indexOf('BEGIN') < sqls.findIndex((sql) => sql.includes('FOR UPDATE')) && sqls.indexOf('COMMIT') > sqls.findIndex((sql) => sql.includes('UPDATE editorial.social_posts')));
  assert.ok(statements.some(({ sql, values }) => sql.includes('INSERT INTO editorial.events') && values.includes('social_post.media_added')));

  for (const status of ['scheduled', 'discarded']) {
    const locked = mediaPool({ ...POST, status });
    await assert.rejects(() => new EditorialApiRepository(locked.pool).appendSocialPostMedia('post-1', { url: 'https://x.example/a.jpg', type: 'image', name: 'a' }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION');
  }
  const full = mediaPool({ ...POST, media: Array.from({ length: 10 }, (_, index) => ({ url: `https://cdn.example/${index}.jpg` })) });
  await assert.rejects(() => new EditorialApiRepository(full.pool).appendSocialPostMedia('post-1', { url: 'https://x.example/a.jpg', type: 'image', name: 'a' }, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'MEDIA_LIMIT');
  assert.equal(full.statements.some(({ sql }) => sql.includes('UPDATE editorial.social_posts')), false);
  await assert.rejects(() => new EditorialApiRepository(mediaPool(null).pool).appendSocialPostMedia('post-1', { url: 'https://x.example/a.jpg', type: 'image', name: 'a' }, 'user-1'), (error: any) => error.statusCode === 404);
});

// ---------------------------------------------------------------------------
// Repository: listing and re-scheduling

test('the social posts listing includes the linked publication status and confirmed date', async () => {
  const { pool, statements } = poolWithClient(() => ({ rows: [{ ...POST, status: 'scheduled', publication_id: 'pub-1', account_label: 'GMB', publication_status: 'cancelled', publication_scheduled_at: '2026-10-10T09:00:00.000Z' }, { ...POST, id: 'post-2', account_label: 'IG', publication_status: null, publication_scheduled_at: null }], rowCount: 2 }));
  const posts: any[] = await new EditorialApiRepository(pool).listSocialPosts('item-1');
  assert.match(statements[0].sql, /LEFT JOIN editorial\.publications pub ON pub\.client_id=sp\.client_id AND pub\.id=sp\.publication_id/);
  assert.match(statements[0].sql, /pub\.confirmed_scheduled_at publication_scheduled_at/);
  assert.equal(posts[0].publicationStatus, 'cancelled');
  assert.equal(posts[0].publicationScheduledAt, '2026-10-10T09:00:00.000Z');
  assert.equal(posts[1].publicationStatus, null);
  assert.equal(posts[1].publicationScheduledAt, null);
});

function reschedulePool(options: { publicationStatus: string }) {
  const post = { ...POST, status: 'scheduled', publication_id: 'publication-old' };
  return poolWithClient((sql, values) => {
    if (sql.includes('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2')) return none;
    if (sql.includes('SELECT plan_item_id FROM editorial.social_posts')) return one({ plan_item_id: 'item-1' });
    if (sql.includes('FROM editorial.plan_items')) return one(RRSS_ITEM);
    if (sql.includes('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND id=$2 FOR UPDATE')) return one(post);
    if (sql.includes('SELECT id,status FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE')) return one({ id: 'publication-old', status: options.publicationStatus });
    if (sql.includes('SELECT * FROM editorial.contents')) return one({ id: 'content-rrss', client_id: 'client-a', plan_item_id: 'item-1', status: 'approved', approved_revision_id: 'revision-rrss' });
    if (sql.includes('SELECT * FROM editorial.publishing_accounts')) return one(ACCOUNT_GMB);
    if (sql.includes('FROM editorial.publications WHERE content_id')) return one({ id: 'publication-old', occurrence_key: 'primary', status: 'cancelled' });
    if (sql.includes('INSERT INTO editorial.publications')) return one({ id: values[0], client_id: values[1], content_id: values[2], account_id: values[3], occurrence_key: values[4], copy: values[6], media: JSON.parse(String(values[7])), status: 'pending', desired_scheduled_at: values[8], external_url: values[9] });
    if (sql.includes('INSERT INTO editorial.jobs')) return one({ id: values[0], kind: 'publish', target_id: values[2] });
    if (sql.includes("UPDATE editorial.social_posts SET status='scheduled'")) return one({ ...post, publication_id: values[2], version: post.version + 1 });
    return none;
  });
}

const scheduleInput = { clientId: 'client-a', desiredScheduledAt: '2026-10-20T09:00:00.000Z', externalUrl: null, expectedVersion: 2, idempotencyKey: 'social-schedule-2' };

test('a scheduled post whose publication was cancelled can be scheduled again in the next occurrence slot', async () => {
  const { pool, statements } = reschedulePool({ publicationStatus: 'cancelled' });
  const result: any = await new EditorialApiRepository(pool).scheduleSocialPost('post-1', scheduleInput, 'user-1');
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO editorial.publications'))!;
  assert.equal(insert.values[4], 'primary-2', 'the cancelled slot keeps its row, the new one takes the next key');
  const postUpdate = statements.find(({ sql }) => sql.includes("UPDATE editorial.social_posts SET status='scheduled'"))!;
  assert.equal(postUpdate.values[2], insert.values[0]);
  assert.equal(result.socialPost.publicationId, insert.values[0]);
  assert.equal(statements.some(({ sql }) => sql.includes("UPDATE editorial.publications SET status='cancelled'")), false, 'a cancelled publication is left untouched');
});

test('a scheduled post whose publication failed is re-queued and the failed publication is closed as cancelled', async () => {
  const { pool, statements } = reschedulePool({ publicationStatus: 'failed' });
  await new EditorialApiRepository(pool).scheduleSocialPost('post-1', scheduleInput, 'user-1');
  const close = statements.find(({ sql }) => sql.includes("UPDATE editorial.publications SET status='cancelled'"))!;
  assert.deepEqual(close.values.slice(0, 2), ['client-a', 'publication-old']);
  const sqls = statements.map(({ sql }) => sql);
  assert.ok(sqls.indexOf(close.sql) < sqls.findIndex((sql) => sql.includes('INSERT INTO editorial.publications')));
});

test('a scheduled post whose publication is still live cannot be scheduled again', async () => {
  for (const status of ['pending', 'sending', 'scheduled', 'published', 'unknown', 'cancel_requested']) {
    const { pool, statements } = reschedulePool({ publicationStatus: status });
    await assert.rejects(() => new EditorialApiRepository(pool).scheduleSocialPost('post-1', scheduleInput, 'user-1'), (error: any) => error.statusCode === 409 && error.code === 'INVALID_TRANSITION', status);
    assert.equal(statements.some(({ sql }) => sql.includes('INSERT INTO editorial.publications')), false);
  }
});

// ---------------------------------------------------------------------------
// Upload route

const ADMIN = { authorization: 'Bearer admin' };
const POSTIZ_ENV = { POSTIZ_API_URL: 'https://postiz.example/api', POSTIZ_API_KEY: 'secret-postiz-key' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64, 2)]);

function multipart(filename: string, contentType: string, data: Buffer, field = 'file') {
  const boundary = '----infidash-test-boundary';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { ...ADMIN, 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function uploadApp(options: { post?: any; env?: Record<string, string | undefined>; fetchImpl?: any } = {}) {
  const calls: unknown[][] = [];
  const uploads: Array<{ url: string; file: File }> = [];
  const post = options.post === undefined ? { id: 'post-1', clientId: 'client-a', status: 'review', media: [] } : options.post;
  const repository = {
    async getSocialPost(id: string) { return id === 'post-1' ? post : id === 'post-b' ? { ...post, id: 'post-b', clientId: 'client-b' } : null; },
    async appendSocialPostMedia(id: string, item: any, actorId: string) { calls.push(['appendSocialPostMedia', id, item, actorId]); return { ...post, media: [...post.media, item], status: 'review', version: 3 }; },
  };
  const fetchImpl = options.fetchImpl ?? (async (url: string, init: any) => {
    uploads.push({ url, file: (init.body as FormData).get('file') as File });
    return new Response(JSON.stringify({ path: '/uploads/creative' }), { status: 200 });
  });
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: repository as any,
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const, clientIds: null } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const, clientIds: ['client-a'] } } : null,
    postiz: { env: options.env ?? POSTIZ_ENV, fetchImpl },
  });
  return { app, calls, uploads };
}

const MEDIA_URL = '/api/social-posts/post-1/media';

test('uploading an image forwards it to Postiz and appends it to the draft', async () => {
  const { app, calls, uploads } = await uploadApp();
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('portada.jpg', 'image/jpeg', JPEG) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(uploads[0].url, 'https://postiz.example/api/public/v1/upload');
  assert.equal(uploads[0].file.name, 'portada.jpg');
  assert.equal(uploads[0].file.type, 'image/jpeg');
  assert.equal(uploads[0].file.size, JPEG.length);
  assert.deepEqual(calls[0], ['appendSocialPostMedia', 'post-1', { url: 'https://postiz.example/uploads/creative', type: 'image', name: 'portada.jpg' }, 'user-1']);
  assert.equal(response.json().socialPost.status, 'review');
  assert.doesNotMatch(response.body, /secret-postiz-key/);
  await app.close();
});

test('uploading a video stores it with type video', async () => {
  const { app, calls } = await uploadApp();
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('clip.mp4', 'video/mp4', MP4) });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual((calls[0][2] as any).type, 'video');
  const mov = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('clip.mov', 'video/quicktime', Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(32)])) });
  assert.equal(mov.statusCode, 200, mov.body);
  await app.close();
});

test('uploads refuse unsupported or spoofed types with 400 INVALID_MEDIA_TYPE', async () => {
  const { app, calls, uploads } = await uploadApp();
  for (const [name, type, data] of [['a.gif', 'image/gif', Buffer.from('GIF89a')], ['a.pdf', 'application/pdf', Buffer.from('%PDF-1.4')], ['fake.jpg', 'image/jpeg', Buffer.from('<html>not an image</html>')], ['fake.mp4', 'video/mp4', JPEG]] as const) {
    const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart(name, type, data) });
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
    assert.equal(response.json().code, 'INVALID_MEDIA_TYPE');
  }
  assert.equal(calls.length, 0);
  assert.equal(uploads.length, 0);
  await app.close();
});

test('an image over 10 MB is refused with 413 MEDIA_TOO_LARGE', async () => {
  const { app, uploads } = await uploadApp();
  const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('big.jpg', 'image/jpeg', big) });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, 'MEDIA_TOO_LARGE');
  assert.equal(uploads.length, 0);
  await app.close();
});

test('uploads to scheduled or discarded posts, or past the media limit, are refused with 409', async () => {
  for (const status of ['scheduled', 'discarded']) {
    const { app, uploads } = await uploadApp({ post: { id: 'post-1', clientId: 'client-a', status, media: [] } });
    const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('a.jpg', 'image/jpeg', JPEG) });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'INVALID_TRANSITION');
    assert.equal(uploads.length, 0);
    await app.close();
  }
  const { app, uploads } = await uploadApp({ post: { id: 'post-1', clientId: 'client-a', status: 'review', media: Array.from({ length: 10 }, (_, index) => ({ url: `https://cdn.example/${index}.jpg` })) } });
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('a.jpg', 'image/jpeg', JPEG) });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'MEDIA_LIMIT');
  assert.equal(uploads.length, 0);
  await app.close();
});

test('uploads answer 503 POSTIZ_NOT_CONFIGURED when the Postiz env is missing', async () => {
  const { app, calls } = await uploadApp({ env: { POSTIZ_API_URL: 'https://postiz.example/api' } });
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('a.jpg', 'image/jpeg', JPEG) });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'POSTIZ_NOT_CONFIGURED');
  assert.match(response.json().error, /Postiz/);
  assert.equal(calls.length, 0);
  await app.close();
});

test('a Postiz failure answers 502 POSTIZ_UPLOAD_FAILED and stores nothing', async () => {
  const { app, calls } = await uploadApp({ fetchImpl: async () => new Response('boom secret-postiz-key', { status: 500 }) });
  const response = await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('a.jpg', 'image/jpeg', JPEG) });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().code, 'POSTIZ_UPLOAD_FAILED');
  assert.doesNotMatch(response.body, /secret-postiz-key/);
  assert.equal(calls.length, 0);
  await app.close();
});

test('the upload route is admin-only, client-scoped and requires a multipart file field', async () => {
  const { app, calls } = await uploadApp();
  const viewer = multipart('a.jpg', 'image/jpeg', JPEG);
  assert.equal((await app.inject({ method: 'POST', url: MEDIA_URL, payload: viewer.payload, headers: { ...viewer.headers, authorization: 'Bearer viewer' } })).statusCode, 403);
  // requireClientAccess runs for the post's client (admins are unscoped by canAccessClient).
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-b/media', ...multipart('a.jpg', 'image/jpeg', JPEG) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-x/media', ...multipart('a.jpg', 'image/jpeg', JPEG) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: MEDIA_URL, ...multipart('a.jpg', 'image/jpeg', JPEG, 'other') })).statusCode, 400);
  const json = await app.inject({ method: 'POST', url: MEDIA_URL, headers: ADMIN, payload: { url: 'https://x.example/a.jpg' } });
  assert.equal(json.statusCode, 400);
  assert.equal(calls.length, 1);
  await app.close();
});

test('JSON routes keep working next to the multipart parser', async () => {
  const calls: unknown[][] = [];
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: {
      async getSocialPost() { return { id: 'post-1', clientId: 'client-a', status: 'review', media: [] }; },
      async patchSocialPost(id: string, input: any) { calls.push(['patchSocialPost', id, input]); return { id, status: 'review' }; },
    } as any,
    resolveHumanSession: () => ({ user: { id: 'user-1', role: 'admin' as const, clientIds: null } }),
    postiz: { env: POSTIZ_ENV },
  });
  const response = await app.inject({ method: 'PATCH', url: '/api/social-posts/post-1', headers: ADMIN, payload: { media: [{ url: 'https://cdn.example/v.mp4', type: 'video', name: 'clip.mp4', extra: 1 }, { url: 'https://cdn.example/a.jpg', type: 'image' }], expectedVersion: 2 } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual((calls[0][2] as any).media, [{ url: 'https://cdn.example/v.mp4', type: 'video', name: 'clip.mp4' }, { url: 'https://cdn.example/a.jpg', type: 'image' }]);
  await app.close();
});
