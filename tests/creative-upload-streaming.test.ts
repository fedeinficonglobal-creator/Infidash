import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { spoolCreative } from '../src/server/content/creativeUpload.js';
import { contentRoutes } from '../src/server/content/routes.js';
import { createPostizUploader } from '../src/server/content/postizUpload.js';
import { createUploadLimiter, maxConcurrentUploadsFromEnv } from '../src/server/content/uploadLimiter.js';

const CHUNK = 64 * 1024;
const MB = 1024 * 1024;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

type FilePart = { file: Readable & { truncated?: boolean }; mimetype: string; filename?: string };

function part(source: Readable, mimetype = 'image/jpeg', filename = 'foto.jpg', truncated = false): FilePart {
  const file = source as Readable & { truncated?: boolean };
  if (truncated) file.truncated = true;
  return { file, mimetype, filename };
}

/** A stream of 64 KB chunks (the first starts with `head`) that counts how many chunks were pulled. */
function chunked(totalBytes: number, head: Buffer = JPEG_HEAD) {
  const state = { pulled: 0 };
  let sent = 0;
  const file = new Readable({
    highWaterMark: 1,
    read() {
      if (sent >= totalBytes) return this.push(null);
      const size = Math.min(CHUNK, totalBytes - sent);
      const chunk = Buffer.alloc(size, 7);
      if (sent === 0) head.copy(chunk);
      sent += size;
      state.pulled += 1;
      this.push(chunk);
    },
  });
  return { file, state };
}

async function scratchDir() {
  const dir = await mkdtemp(join(tmpdir(), 'infidash-upload-test-'));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

test('a small file is spooled to a temp file and the temp file is removed on cleanup', async () => {
  const scratch = await scratchDir();
  try {
    const body = Buffer.concat([JPEG_HEAD, Buffer.alloc(100, 3)]);
    const spooled = await spoolCreative(part(Readable.from([body])), { tmpDir: scratch.dir });
    assert.equal(spooled.size, body.length);
    assert.equal(spooled.kind, 'image');
    assert.equal(spooled.name, 'foto.jpg');
    assert.ok(spooled.path.startsWith(scratch.dir));
    assert.deepEqual(await readFile(spooled.path), body);
    await spooled.cleanup();
    assert.equal(existsSync(spooled.path), false);
    assert.deepEqual(await readdir(scratch.dir), []);
  } finally { await scratch.remove(); }
});

test('an image over 10 MB aborts early with 413, consuming a bounded number of chunks and leaving no temp file', async () => {
  const scratch = await scratchDir();
  try {
    const { file, state } = chunked(11 * MB);
    await assert.rejects(() => spoolCreative(part(file), { tmpDir: scratch.dir }), (error: any) => error.statusCode === 413 && error.code === 'MEDIA_TOO_LARGE');
    assert.ok(state.pulled < (10 * MB) / CHUNK + 16, `pulled ${state.pulled} chunks`);
    assert.deepEqual(await readdir(scratch.dir), []);
  } finally { await scratch.remove(); }
});

test('refused types, spoofed signatures and empty files fail with INVALID_MEDIA_TYPE and leave no temp file', async () => {
  const scratch = await scratchDir();
  try {
    const cases: Array<[Readable, string]> = [
      [Readable.from([Buffer.from('GIF89a')]), 'image/gif'],
      [Readable.from([Buffer.from('<html>not an image</html>')]), 'image/jpeg'],
      [Readable.from([Buffer.concat([JPEG_HEAD, Buffer.alloc(64)])]), 'video/mp4'],
      [Readable.from([]), 'image/jpeg'],
    ];
    for (const [source, mimetype] of cases) {
      await assert.rejects(() => spoolCreative(part(source, mimetype), { tmpDir: scratch.dir }), (error: any) => error.statusCode === 400 && error.code === 'INVALID_MEDIA_TYPE', mimetype);
    }
    assert.deepEqual(await readdir(scratch.dir), []);
  } finally { await scratch.remove(); }
});

test('a spoofed large file is refused as soon as its first bytes are seen', async () => {
  const scratch = await scratchDir();
  try {
    const { file, state } = chunked(50 * MB, Buffer.from('not-an-image-at-all'));
    await assert.rejects(() => spoolCreative(part(file), { tmpDir: scratch.dir }), (error: any) => error.code === 'INVALID_MEDIA_TYPE');
    assert.ok(state.pulled < 16, `pulled ${state.pulled} chunks`);
  } finally { await scratch.remove(); }
});

test('a truncated multipart file is refused with 413 and its temp file removed', async () => {
  const scratch = await scratchDir();
  try {
    const body = Buffer.concat([JPEG_HEAD, Buffer.alloc(100, 3)]);
    await assert.rejects(() => spoolCreative(part(Readable.from([body]), 'image/jpeg', 'a.jpg', true), { tmpDir: scratch.dir }), (error: any) => error.statusCode === 413 && error.code === 'MEDIA_TOO_LARGE');
    assert.deepEqual(await readdir(scratch.dir), []);
  } finally { await scratch.remove(); }
});

test('a client disconnect mid-upload removes the temp file', async () => {
  const scratch = await scratchDir();
  try {
    const source = new Readable({ read() {} });
    const pending = spoolCreative(part(source), { tmpDir: scratch.dir });
    source.push(Buffer.concat([JPEG_HEAD, Buffer.alloc(1000)]));
    setTimeout(() => source.destroy(new Error('aborted')), 20);
    await assert.rejects(() => pending);
    assert.deepEqual(await readdir(scratch.dir), []);
  } finally { await scratch.remove(); }
});

test('the Postiz uploader sends a file-backed body from a path with the same contract', async () => {
  const scratch = await scratchDir();
  try {
    const body = Buffer.concat([JPEG_HEAD, Buffer.alloc(100, 3)]);
    const spooled = await spoolCreative(part(Readable.from([body])), { tmpDir: scratch.dir });
    const requests: any[] = [];
    const upload = createPostizUploader({ apiUrl: 'https://postiz.example/api', apiKey: 'k', publicUrl: 'https://postiz.example' }, (async (url: string, init: any) => {
      const file = (init.body as FormData).get('file') as File;
      requests.push({ url, file, auth: new Headers(init.headers).get('authorization'), bytes: Buffer.from(await file.arrayBuffer()) });
      return new Response(JSON.stringify({ path: '/u/x.jpg' }), { status: 200 });
    }) as any);
    const result = await upload({ path: spooled.path, filename: 'foto.jpg', mimetype: 'image/jpeg' });
    assert.equal(result.url, 'https://postiz.example/u/x.jpg');
    assert.equal(requests[0].url, 'https://postiz.example/api/public/v1/upload');
    assert.equal(requests[0].auth, 'k');
    assert.equal(requests[0].file.name, 'foto.jpg');
    assert.equal(requests[0].file.type, 'image/jpeg');
    assert.equal(requests[0].file.size, body.length);
    assert.deepEqual(requests[0].bytes, body);
    await spooled.cleanup();
  } finally { await scratch.remove(); }
});

test('the upload limiter rejects the N+1th upload immediately and frees slots on release', () => {
  const limiter = createUploadLimiter(2);
  const a = limiter.acquire();
  const b = limiter.acquire();
  assert.throws(() => limiter.acquire(), (error: any) => error.statusCode === 503 && error.code === 'UPLOAD_BUSY' && /demasiadas subidas/.test(error.message));
  assert.equal(limiter.active, 2);
  a();
  a(); // idempotent
  assert.equal(limiter.active, 1);
  const c = limiter.acquire();
  b(); c();
  assert.equal(limiter.active, 0);
});

test('the concurrency limit comes from env, clamped to 1..10 with a default of 3', () => {
  assert.equal(maxConcurrentUploadsFromEnv({}), 3);
  assert.equal(maxConcurrentUploadsFromEnv({ INFIDASH_MAX_CONCURRENT_UPLOADS: '5' }), 5);
  assert.equal(maxConcurrentUploadsFromEnv({ INFIDASH_MAX_CONCURRENT_UPLOADS: '0' }), 1);
  assert.equal(maxConcurrentUploadsFromEnv({ INFIDASH_MAX_CONCURRENT_UPLOADS: '99' }), 10);
  assert.equal(maxConcurrentUploadsFromEnv({ INFIDASH_MAX_CONCURRENT_UPLOADS: 'abc' }), 3);
  assert.equal(maxConcurrentUploadsFromEnv({ INFIDASH_MAX_CONCURRENT_UPLOADS: '-2' }), 3);
});

// ---------------------------------------------------------------------------
// Route integration

const BOUNDARY = '----infidash-stream-boundary';
function multipartBody(data: Buffer) {
  const head = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]), headers: { authorization: 'Bearer admin', 'content-type': `multipart/form-data; boundary=${BOUNDARY}` } };
}

async function routeApp(scratchDir: string, fetchImpl: any, maxConcurrent?: number) {
  const repository = {
    async getSocialPost() { return { id: 'post-1', clientId: 'client-a', status: 'review', media: [] }; },
    async appendSocialPostMedia(_id: string, item: any) { return { id: 'post-1', media: [item] }; },
  };
  const app = Fastify({ logger: false });
  await app.register(contentRoutes, {
    repository: repository as any,
    resolveHumanSession: () => ({ user: { id: 'user-1', role: 'admin' as const, clientIds: null } }),
    postiz: { env: { POSTIZ_API_URL: 'https://postiz.example/api', POSTIZ_API_KEY: 'k' }, fetchImpl },
    uploads: { tmpDir: scratchDir, maxConcurrent },
  });
  return app;
}

const JPEG = Buffer.concat([JPEG_HEAD, Buffer.alloc(64, 1)]);

test('the route streams the temp file to Postiz and removes it on success and on Postiz failure', async () => {
  const scratch = await scratchDir();
  try {
    let seenPath = false;
    const ok = await routeApp(scratch.dir, async (_url: string, init: any) => {
      seenPath = (await readdir(scratch.dir)).length === 1; // temp file exists while Postiz is called
      assert.equal(((init.body as FormData).get('file') as File).size, JPEG.length);
      return new Response(JSON.stringify({ path: '/u/a.jpg' }), { status: 200 });
    });
    assert.equal((await ok.inject({ method: 'POST', url: '/api/social-posts/post-1/media', ...multipartBody(JPEG) })).statusCode, 200);
    assert.equal(seenPath, true);
    assert.deepEqual(await readdir(scratch.dir), []);
    await ok.close();

    const failing = await routeApp(scratch.dir, async () => new Response('boom', { status: 500 }));
    const response = await failing.inject({ method: 'POST', url: '/api/social-posts/post-1/media', ...multipartBody(JPEG) });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(await readdir(scratch.dir), []);
    await failing.close();
  } finally { await scratch.remove(); }
});

test('the route answers 503 UPLOAD_BUSY while all slots are taken and frees the slot afterwards', async () => {
  const scratch = await scratchDir();
  try {
    let unblock: () => void = () => {};
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const app = await routeApp(scratch.dir, async () => { started(); await gate; return new Response(JSON.stringify({ path: '/u/a.jpg' }), { status: 200 }); }, 1);
    const first = app.inject({ method: 'POST', url: '/api/social-posts/post-1/media', ...multipartBody(JPEG) });
    await inFlight;
    const busy = await app.inject({ method: 'POST', url: '/api/social-posts/post-1/media', ...multipartBody(JPEG) });
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.json().code, 'UPLOAD_BUSY');
    unblock();
    assert.equal((await first).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/social-posts/post-1/media', ...multipartBody(JPEG) })).statusCode, 200);
    assert.deepEqual(await readdir(scratch.dir), []);
    await app.close();
  } finally { await scratch.remove(); }
});
