import { JWT } from 'google-auth-library';
import { isValidInclusiveDateRange } from './dateRange.js';

export interface Ga4ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export interface Ga4SessionsPoint { date: string; sessions: number; conversions: number }
export interface Ga4TrafficSource { channelGroup: string; sessions: number; conversions: number }
export interface Ga4TopPage { pagePath: string; pageViews: number; sessions: number }
export interface Ga4LandingPage { landingPage: string; sessions: number; conversions: number }

export interface Ga4TrafficData {
  sessionsSeries: Ga4SessionsPoint[];
  trafficSources: Ga4TrafficSource[];
  topPages: Ga4TopPage[];
  landingPages: Ga4LandingPage[];
  samplingWarning: boolean;
  timeZone: string | null;
}

const GA4_DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export function parseGa4ServiceAccount(json: string): Ga4ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('GA4_SERVICE_ACCOUNT_JSON no es un JSON válido');
  }
  const record = parsed as Record<string, unknown>;
  const clientEmail = record?.client_email;
  const privateKey = record?.private_key;
  if (typeof clientEmail !== 'string' || !clientEmail.trim() || typeof privateKey !== 'string' || !privateKey.trim()) {
    throw new Error('GA4_SERVICE_ACCOUNT_JSON debe incluir client_email y private_key');
  }
  return { clientEmail, privateKey };
}

/** Wraps google-auth-library's JWT client behind a plain async function so callers/tests never touch it directly. */
export function createGa4AccessTokenProvider(account: Ga4ServiceAccount): () => Promise<string> {
  const client = new JWT({ email: account.clientEmail, key: account.privateKey, scopes: [GA4_READONLY_SCOPE] });
  return async () => {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('No se pudo obtener un token de acceso para GA4');
    return token;
  };
}

function ga4PropertyId(propertyId: string) {
  if (!/^\d+$/.test(propertyId)) throw new Error('El Property ID de GA4 debe ser numérico');
  return propertyId;
}

function ga4BatchEndpoint(propertyId: string) {
  return `${GA4_DATA_API_BASE}/properties/${ga4PropertyId(propertyId)}:batchRunReports`;
}

function toNumber(value: string | undefined) {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGa4Date(value: string) {
  if (!/^\d{8}$/.test(value)) throw new Error('GA4 devolvió una fecha inválida');
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

interface ParsedGa4Report {
  rows: Array<{ dims: string[]; metrics: string[] }>;
  sampled: boolean;
  timeZone: string | null;
}

function parseGa4Report(report: unknown): ParsedGa4Report {
  const value = report as Record<string, unknown>;
  const rawRows = Array.isArray(value?.rows) ? value.rows : [];
  const rows = rawRows.map((row: any) => ({
    dims: Array.isArray(row?.dimensionValues) ? row.dimensionValues.map((entry: any) => String(entry?.value ?? '')) : [],
    metrics: Array.isArray(row?.metricValues) ? row.metricValues.map((entry: any) => String(entry?.value ?? '0')) : [],
  }));
  const metadata = value?.metadata as Record<string, unknown> | undefined;
  const sampled = Array.isArray(metadata?.samplingMetadatas) && (metadata!.samplingMetadatas as unknown[]).length > 0;
  const timeZone = typeof metadata?.timeZone === 'string' ? (metadata!.timeZone as string) : null;
  return { rows, sampled, timeZone };
}

async function ga4ErrorFromResponse(response: Response, clientEmail?: string): Promise<Error> {
  let message = `GA4 respondió HTTP ${response.status}`;
  try {
    const body: any = await response.json();
    if (typeof body?.error?.message === 'string') message = body.error.message;
  } catch {
    // ignore — fall back to the generic message above
  }
  if (response.status === 403) {
    return new Error(`La cuenta de servicio${clientEmail ? ` (${clientEmail})` : ''} no tiene acceso de Lector a esta propiedad GA4. Añádela en GA4 → Administración → Acceso a la propiedad.`);
  }
  if (response.status === 404) return new Error('No existe esa propiedad GA4 o el Property ID es incorrecto.');
  if (response.status === 429) return new Error('Se alcanzó el límite de cuota de la API de GA4; inténtalo de nuevo más tarde.');
  return new Error(message);
}

function dateRange(from: string, to: string) {
  return { startDate: from, endDate: to };
}

export async function fetchGa4TrafficReport(
  input: { propertyId: string; from: string; to: string },
  getAccessToken: () => Promise<string>,
  clientEmail?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Ga4TrafficData> {
  if (!isValidInclusiveDateRange(input.from, input.to, 31)) throw new Error('Ventana de fechas GA4 inválida: usa hasta 31 días');
  const url = ga4BatchEndpoint(input.propertyId);
  const range = dateRange(input.from, input.to);
  const body = {
    requests: [
      { dateRanges: [range], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'conversions' }], orderBys: [{ dimension: { dimensionName: 'date' } }] },
      { dateRanges: [range], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'conversions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '50' },
      { dateRanges: [range], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: '25' },
      { dateRanges: [range], dimensions: [{ name: 'landingPage' }], metrics: [{ name: 'sessions' }, { name: 'conversions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '25' },
    ],
  };
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    throw new Error('No se pudo conectar con la API de Google Analytics');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw await ga4ErrorFromResponse(response, clientEmail);
  const payload: unknown = await response.json();
  const reports = Array.isArray((payload as any)?.reports) ? (payload as any).reports : [];
  if (reports.length !== 4) throw new Error('GA4 no devolvió los cuatro informes esperados');
  const [sessionsReport, sourcesReport, pagesReport, landingReport] = reports.map(parseGa4Report);
  const samplingWarning = [sessionsReport, sourcesReport, pagesReport, landingReport].some((report) => report.sampled);
  const timeZone = sessionsReport.timeZone ?? sourcesReport.timeZone ?? pagesReport.timeZone ?? landingReport.timeZone;
  return {
    sessionsSeries: sessionsReport.rows.map((row) => ({ date: formatGa4Date(row.dims[0]), sessions: toNumber(row.metrics[0]), conversions: toNumber(row.metrics[1]) })),
    trafficSources: sourcesReport.rows.map((row) => ({ channelGroup: row.dims[0] || '(sin definir)', sessions: toNumber(row.metrics[0]), conversions: toNumber(row.metrics[1]) })),
    topPages: pagesReport.rows.map((row) => ({ pagePath: row.dims[0] || '/', pageViews: toNumber(row.metrics[0]), sessions: toNumber(row.metrics[1]) })),
    landingPages: landingReport.rows.map((row) => ({ landingPage: row.dims[0] || '/', sessions: toNumber(row.metrics[0]), conversions: toNumber(row.metrics[1]) })),
    samplingWarning,
    timeZone,
  };
}

export async function probeGa4Property(
  input: { propertyId: string },
  getAccessToken: () => Promise<string>,
  clientEmail?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; error: string | null }> {
  let url: string;
  try {
    url = ga4BatchEndpoint(input.propertyId);
  } catch {
    return { ok: false, error: 'El Property ID de GA4 debe ser numérico' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const token = await getAccessToken();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ requests: [{ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }], limit: '1' }] }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await ga4ErrorFromResponse(response, clientEmail);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'No se pudo conectar con la API de Google Analytics' };
  } finally {
    clearTimeout(timeout);
  }
}
