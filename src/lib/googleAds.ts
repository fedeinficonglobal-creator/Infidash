import { OAuth2Client } from 'google-auth-library';
import { isValidInclusiveDateRange } from './dateRange.js';

/** Bumped roughly yearly by Google; check https://developers.google.com/google-ads/api/docs/release-notes before raising. */
export const GOOGLE_ADS_API_VERSION = 'v25';

export interface GoogleAdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionsValue: number;
}

export interface GoogleAdsCampaignData {
  campaigns: GoogleAdsCampaign[];
  currencyCode: string;
  accountName: string;
}

/** Wraps google-auth-library's OAuth2Client refresh-token flow behind a plain async function, mirroring ga4.ts. */
export function createGoogleAdsAccessTokenProvider(credentials: GoogleAdsCredentials): () => Promise<string> {
  const client = new OAuth2Client({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
  client.setCredentials({ refresh_token: credentials.refreshToken });
  return async () => {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('No se pudo obtener un token de acceso para Google Ads');
    return token;
  };
}

function googleAdsCustomerId(customerId: string) {
  if (!/^\d+$/.test(customerId)) throw new Error('El Customer ID de Google Ads debe ser numérico, sin guiones');
  return customerId;
}

function googleAdsSearchEndpoint(customerId: string) {
  return `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${googleAdsCustomerId(customerId)}/googleAds:search`;
}

async function googleAdsErrorFromResponse(response: Response): Promise<Error> {
  let message = `Google Ads respondió HTTP ${response.status}`;
  try {
    const body: any = await response.json();
    if (typeof body?.error?.message === 'string') message = body.error.message;
  } catch {
    // ignore — fall back to the generic message above
  }
  if (response.status === 401 || response.status === 403) {
    return new Error('El refresh token no tiene acceso a esta cuenta de Google Ads, o no está enlazada bajo la cuenta de gestor de Infidash.');
  }
  if (response.status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
    return new Error('Se alcanzó el límite de cuota de la API de Google Ads; inténtalo de nuevo más tarde.');
  }
  if (/CUSTOMER_NOT_FOUND|NOT_ADS_USER|INVALID_CUSTOMER_ID/i.test(message)) {
    return new Error('No existe esa cuenta de Google Ads o el Customer ID es incorrecto.');
  }
  return new Error(message);
}

async function runGoogleAdsQuery(
  customerId: string,
  query: string,
  getAccessToken: () => Promise<string>,
  developerToken: string,
  loginCustomerId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(googleAdsSearchEndpoint(customerId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'developer-token': developerToken,
        'login-customer-id': loginCustomerId,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ query }),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    throw new Error('No se pudo conectar con la API de Google Ads');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw await googleAdsErrorFromResponse(response);
  const payload: unknown = await response.json();
  const results = Array.isArray((payload as any)?.results) ? (payload as any).results : [];
  return results as any[];
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchGoogleAdsCampaignReport(
  input: { customerId: string; from: string; to: string },
  getAccessToken: () => Promise<string>,
  developerToken: string,
  loginCustomerId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GoogleAdsCampaignData> {
  if (!isValidInclusiveDateRange(input.from, input.to, 31)) throw new Error('Ventana de fechas de Google Ads inválida: usa hasta 31 días');
  const campaignQuery = `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${input.from}' AND '${input.to}' ORDER BY metrics.cost_micros DESC`;
  const customerQuery = `SELECT customer.currency_code, customer.descriptive_name FROM customer LIMIT 1`;
  const [campaignRows, customerRows] = await Promise.all([
    runGoogleAdsQuery(input.customerId, campaignQuery, getAccessToken, developerToken, loginCustomerId, fetchImpl, 20_000),
    runGoogleAdsQuery(input.customerId, customerQuery, getAccessToken, developerToken, loginCustomerId, fetchImpl, 20_000),
  ]);
  const customer = customerRows[0]?.customer ?? {};
  const campaigns: GoogleAdsCampaign[] = campaignRows.map((row) => {
    const campaign = row?.campaign ?? {};
    const metrics = row?.metrics ?? {};
    const costMicros = toNumber(metrics.costMicros);
    return {
      id: String(campaign.id ?? ''),
      name: String(campaign.name ?? ''),
      status: String(campaign.status ?? ''),
      cost: Math.round((costMicros / 1_000_000) * 100) / 100,
      clicks: toNumber(metrics.clicks),
      impressions: toNumber(metrics.impressions),
      conversions: toNumber(metrics.conversions),
      conversionsValue: toNumber(metrics.conversionsValue),
    };
  });
  return {
    campaigns,
    currencyCode: String(customer.currencyCode ?? ''),
    accountName: String(customer.descriptiveName ?? ''),
  };
}

export async function probeGoogleAdsAccount(
  input: { customerId: string },
  getAccessToken: () => Promise<string>,
  developerToken: string,
  loginCustomerId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    googleAdsCustomerId(input.customerId);
  } catch {
    return { ok: false, error: 'El Customer ID de Google Ads debe ser numérico, sin guiones' };
  }
  try {
    await runGoogleAdsQuery(input.customerId, 'SELECT customer.id FROM customer LIMIT 1', getAccessToken, developerToken, loginCustomerId, fetchImpl, 8_000);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo conectar con Google Ads' };
  }
}
