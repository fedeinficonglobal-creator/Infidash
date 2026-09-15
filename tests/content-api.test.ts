import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
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
    resolveHumanSession: (token: string) => token === 'admin' ? { user: { id: 'user-1', role: 'admin' as const } } : token === 'viewer' ? { user: { id: 'user-2', role: 'viewer' as const } } : null,
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
