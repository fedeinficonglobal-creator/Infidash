import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGa4TrafficReport, parseGa4ServiceAccount, probeGa4Property } from '../src/lib/ga4.js';

const getAccessToken = async () => 'test-token';

function reportOf(rows: Array<{ dims: string[]; metrics: string[] }>, timeZone = 'Europe/Madrid') {
  return {
    dimensionHeaders: [],
    metricHeaders: [],
    rows: rows.map((row) => ({
      dimensionValues: row.dims.map((value) => ({ value })),
      metricValues: row.metrics.map((value) => ({ value })),
    })),
    metadata: { timeZone },
  };
}

test('GA4 report request authenticates with a bearer token and batches all four facets in one call', async () => {
  let seenUrl = '';
  let seenAuthorization = '';
  let seenBody: any;
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    seenAuthorization = new Headers(init?.headers).get('authorization') ?? '';
    seenBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      reports: [
        reportOf([{ dims: ['20260901'], metrics: ['142', '3'] }]),
        reportOf([{ dims: ['Organic Search'], metrics: ['100', '2'] }]),
        reportOf([{ dims: ['/blog/post'], metrics: ['500', '80'] }]),
        reportOf([{ dims: ['/landing'], metrics: ['60', '1'] }]),
      ],
    }), { status: 200 });
  };
  const report = await fetchGa4TrafficReport({ propertyId: '123456789', from: '2026-09-01', to: '2026-09-07' }, getAccessToken, 'sa@example.iam.gserviceaccount.com', fetchMock as typeof fetch);
  assert.equal(seenUrl, 'https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports');
  assert.equal(seenAuthorization, 'Bearer test-token');
  assert.equal(seenBody.requests.length, 4);
  assert.deepEqual(seenBody.requests[0].dimensions, [{ name: 'date' }]);
  assert.deepEqual(seenBody.requests[1].dimensions, [{ name: 'sessionDefaultChannelGroup' }]);
  assert.deepEqual(seenBody.requests[2].dimensions, [{ name: 'pagePath' }]);
  assert.deepEqual(seenBody.requests[3].dimensions, [{ name: 'landingPage' }]);

  assert.deepEqual(report.sessionsSeries, [{ date: '2026-09-01', sessions: 142, conversions: 3 }]);
  assert.deepEqual(report.trafficSources, [{ channelGroup: 'Organic Search', sessions: 100, conversions: 2 }]);
  assert.deepEqual(report.topPages, [{ pagePath: '/blog/post', pageViews: 500, sessions: 80 }]);
  assert.deepEqual(report.landingPages, [{ landingPage: '/landing', sessions: 60, conversions: 1 }]);
  assert.equal(report.timeZone, 'Europe/Madrid');
  assert.equal(report.samplingWarning, false);
});

test('GA4 report rejects a window over 31 days without making a network call', async () => {
  const fetchMock = async () => { throw new Error('should not be called'); };
  await assert.rejects(
    fetchGa4TrafficReport({ propertyId: '123456789', from: '2026-01-01', to: '2026-09-07' }, getAccessToken, undefined, fetchMock as typeof fetch),
    /Ventana de fechas GA4 inválida/,
  );
});

test('GA4 report surfaces a sampling warning when any facet is sampled', async () => {
  const fetchMock = async () => new Response(JSON.stringify({
    reports: [
      reportOf([], 'Europe/Madrid'),
      { ...reportOf([]), metadata: { timeZone: 'Europe/Madrid', samplingMetadatas: [{ samplesReadCount: '1' }] } },
      reportOf([]),
      reportOf([]),
    ],
  }), { status: 200 });
  const report = await fetchGa4TrafficReport({ propertyId: '123456789', from: '2026-09-01', to: '2026-09-07' }, getAccessToken, undefined, fetchMock as typeof fetch);
  assert.equal(report.samplingWarning, true);
});

test('probeGa4Property maps 403/404/429 to specific, non-generic messages', async () => {
  const respond = (status: number, message: string) => async () =>
    new Response(JSON.stringify({ error: { code: status, message, status: 'X' } }), { status });

  const denied = await probeGa4Property({ propertyId: '123456789' }, getAccessToken, 'sa@example.iam.gserviceaccount.com', respond(403, 'Permission denied') as typeof fetch);
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? '', /sa@example\.iam\.gserviceaccount\.com/);
  assert.match(denied.error ?? '', /Lector/);

  const notFound = await probeGa4Property({ propertyId: '123456789' }, getAccessToken, undefined, respond(404, 'Not found') as typeof fetch);
  assert.equal(notFound.ok, false);
  assert.match(notFound.error ?? '', /Property ID es incorrecto/);

  const quota = await probeGa4Property({ propertyId: '123456789' }, getAccessToken, undefined, respond(429, 'Quota exceeded') as typeof fetch);
  assert.equal(quota.ok, false);
  assert.match(quota.error ?? '', /límite de cuota/);
});

test('probeGa4Property rejects a non-numeric property id before making a network call', async () => {
  const fetchMock = async () => { throw new Error('should not be called'); };
  const result = await probeGa4Property({ propertyId: 'not-a-number' }, getAccessToken, undefined, fetchMock as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /numérico/);
});

test('probeGa4Property succeeds on a 200 response', async () => {
  const fetchMock = async () => new Response(JSON.stringify({ reports: [reportOf([])] }), { status: 200 });
  const result = await probeGa4Property({ propertyId: '123456789' }, getAccessToken, undefined, fetchMock as typeof fetch);
  assert.deepEqual(result, { ok: true, error: null });
});

test('parseGa4ServiceAccount requires client_email and private_key, never leaks the raw key in error text', () => {
  const account = parseGa4ServiceAccount(JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' }));
  assert.equal(account.clientEmail, 'sa@example.iam.gserviceaccount.com');
  assert.match(account.privateKey, /BEGIN PRIVATE KEY/);

  assert.throws(() => parseGa4ServiceAccount('not json'), /JSON válido/);
  assert.throws(() => parseGa4ServiceAccount(JSON.stringify({ client_email: 'sa@example.com' })), /client_email y private_key/);
});
