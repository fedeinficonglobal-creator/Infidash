import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGoogleAdsCampaignReport, probeGoogleAdsAccount } from '../src/lib/googleAds.js';

const getAccessToken = async () => 'test-token';
const developerToken = 'dev-token';
const loginCustomerId = '1112223333';

function fetchMockFor(input: {
  campaignResults?: any[];
  customerResults?: any[];
  status?: number;
  errorBody?: any;
}) {
  const seenRequests: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seenRequests.push({ url: String(url), headers: new Headers(init?.headers), body });
    if (input.status && input.status !== 200) {
      return new Response(JSON.stringify(input.errorBody ?? {}), { status: input.status });
    }
    const isCustomerQuery = /FROM customer/.test(body.query) && !/campaign/.test(body.query);
    return new Response(JSON.stringify({
      results: isCustomerQuery ? (input.customerResults ?? []) : (input.campaignResults ?? []),
    }), { status: 200 });
  };
  return { fetchMock, seenRequests };
}

test('fetchGoogleAdsCampaignReport sends two GAQL search calls with the right headers and endpoint', async () => {
  const { fetchMock, seenRequests } = fetchMockFor({
    campaignResults: [
      { campaign: { id: '111', name: 'Campaña Verano', status: 'ENABLED' }, metrics: { costMicros: '25500000', clicks: '120', impressions: '4000', conversions: '8', conversionsValue: '640' } },
    ],
    customerResults: [
      { customer: { currencyCode: 'EUR', descriptiveName: 'Cliente Demo' } },
    ],
  });

  const report = await fetchGoogleAdsCampaignReport(
    { customerId: '1234567890', from: '2026-09-01', to: '2026-09-07' },
    getAccessToken, developerToken, loginCustomerId, fetchMock as typeof fetch,
  );

  assert.equal(seenRequests.length, 2);
  for (const request of seenRequests) {
    assert.equal(request.url, 'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search');
    assert.equal(request.headers.get('authorization'), 'Bearer test-token');
    assert.equal(request.headers.get('developer-token'), developerToken);
    assert.equal(request.headers.get('login-customer-id'), loginCustomerId);
  }

  assert.deepEqual(report.campaigns, [{
    id: '111', name: 'Campaña Verano', status: 'ENABLED',
    cost: 25.5, clicks: 120, impressions: 4000, conversions: 8, conversionsValue: 640,
  }]);
  assert.equal(report.currencyCode, 'EUR');
  assert.equal(report.accountName, 'Cliente Demo');
});

test('fetchGoogleAdsCampaignReport rejects a window over 31 days without making a network call', async () => {
  const fetchMock = async () => { throw new Error('should not be called'); };
  await assert.rejects(
    fetchGoogleAdsCampaignReport({ customerId: '1234567890', from: '2026-01-01', to: '2026-09-07' }, getAccessToken, developerToken, loginCustomerId, fetchMock as typeof fetch),
    /Ventana de fechas de Google Ads inválida/,
  );
});

test('probeGoogleAdsAccount rejects a non-numeric customer id before making a network call', async () => {
  const fetchMock = async () => { throw new Error('should not be called'); };
  const result = await probeGoogleAdsAccount({ customerId: '123-456-7890' }, getAccessToken, developerToken, loginCustomerId, fetchMock as typeof fetch);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /numérico/);
});

test('probeGoogleAdsAccount succeeds on a 200 response', async () => {
  const { fetchMock } = fetchMockFor({ customerResults: [{ customer: { id: '1234567890' } }] });
  const result = await probeGoogleAdsAccount({ customerId: '1234567890' }, getAccessToken, developerToken, loginCustomerId, fetchMock as typeof fetch);
  assert.deepEqual(result, { ok: true, error: null });
});

test('probeGoogleAdsAccount maps 401/403 and quota errors to specific, non-generic messages', async () => {
  const denied = await probeGoogleAdsAccount(
    { customerId: '1234567890' }, getAccessToken, developerToken, loginCustomerId,
    (async () => new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 })) as typeof fetch,
  );
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? '', /no tiene acceso/);

  const quota = await probeGoogleAdsAccount(
    { customerId: '1234567890' }, getAccessToken, developerToken, loginCustomerId,
    (async () => new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED' } }), { status: 429 })) as typeof fetch,
  );
  assert.equal(quota.ok, false);
  assert.match(quota.error ?? '', /límite de cuota/);

  const notFound = await probeGoogleAdsAccount(
    { customerId: '1234567890' }, getAccessToken, developerToken, loginCustomerId,
    (async () => new Response(JSON.stringify({ error: { message: 'CUSTOMER_NOT_FOUND' } }), { status: 400 })) as typeof fetch,
  );
  assert.equal(notFound.ok, false);
  assert.match(notFound.error ?? '', /Customer ID es incorrecto/);
});
