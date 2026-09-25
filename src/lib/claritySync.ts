import { nowIso } from './auth.js';

const DEFAULT_CLARITY_EXPORT_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1';

export interface ClarityIntegrationContext {
  clientId: string;
  integrationId: string;
  exportUrl?: string | null;
  accessToken?: string | null;
  projectId?: string | null;
  siteUrl?: string | null;
  segmentName?: string | null;
}

export interface ClaritySnapshotInput {
  clientId: string;
  snapshotDate: string;
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  scrollDepthAvg: number;
  engagedSessions: number;
  conversions: number;
  conversionRate: number;
  notes: string | null;
  source: string;
  payloadJson: string;
}

interface ParsedClaritySnapshot extends Omit<ClaritySnapshotInput, 'clientId'> {
  clientId?: string;
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const normalized = String(value)
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDateKey(value: unknown, fallbackDate: string) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const parsed = value ? new Date(String(value)) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return fallbackDate;
}

function extractCandidateObject(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function pickValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function parseSnapshotItem(item: unknown, fallbackDate: string): ParsedClaritySnapshot {
  const record = extractCandidateObject(item);
  const metrics = extractCandidateObject(pickValue(record, ['metrics', 'summary', 'data', 'values']));
  const legacyFields = ['sessions', 'sessionCount', 'visitors', 'uniqueVisitors', 'pageViews', 'rageClicks', 'deadClicks', 'scrollDepthAvg'];
  if (!legacyFields.some((field) => record[field] !== undefined || metrics[field] !== undefined)) {
    throw new Error('La exportación de Clarity no contiene métricas reconocibles');
  }

  const payload = Object.keys(record).length > 0 ? record : extractCandidateObject(metrics);
  const snapshotDate = toDateKey(pickValue(record, ['snapshotDate', 'date', 'statDate', 'day', 'createdAt', 'updatedAt', 'timestamp']) ?? pickValue(metrics, ['snapshotDate', 'date', 'statDate', 'day', 'createdAt', 'updatedAt', 'timestamp']), fallbackDate);
  const sessions = toNumber(pickValue(record, ['sessions', 'sessionCount', 'visitors', 'uniqueVisitors']) ?? pickValue(metrics, ['sessions', 'sessionCount', 'visitors', 'uniqueVisitors']));
  const pageViews = toNumber(pickValue(record, ['pageViews', 'pageviews', 'views']) ?? pickValue(metrics, ['pageViews', 'pageviews', 'views']), sessions);
  const rageClicks = toNumber(pickValue(record, ['rageClicks', 'rage_clicks']) ?? pickValue(metrics, ['rageClicks', 'rage_clicks']));
  const deadClicks = toNumber(pickValue(record, ['deadClicks', 'dead_clicks']) ?? pickValue(metrics, ['deadClicks', 'dead_clicks']));
  const scrollDepthAvg = toNumber(pickValue(record, ['scrollDepthAvg', 'avgScrollDepth', 'scroll_depth_avg']) ?? pickValue(metrics, ['scrollDepthAvg', 'avgScrollDepth', 'scroll_depth_avg']));
  const engagedSessions = toNumber(pickValue(record, ['engagedSessions', 'engaged', 'activeSessions']) ?? pickValue(metrics, ['engagedSessions', 'engaged', 'activeSessions']));
  const conversions = toNumber(pickValue(record, ['conversions', 'conversionCount', 'goals', 'events']) ?? pickValue(metrics, ['conversions', 'conversionCount', 'goals', 'events']));
  const conversionRate = toNumber(pickValue(record, ['conversionRate', 'convRate', 'conversion_rate']) ?? pickValue(metrics, ['conversionRate', 'convRate', 'conversion_rate']));
  const notesValue = pickValue(record, ['notes', 'summaryText', 'message', 'segmentName']) ?? pickValue(metrics, ['notes', 'summaryText', 'message', 'segmentName']);

  return {
    clientId: String(record.clientId ?? metrics.clientId ?? ''),
    snapshotDate,
    sessions,
    pageViews,
    rageClicks,
    deadClicks,
    scrollDepthAvg,
    engagedSessions,
    conversions,
    conversionRate,
    notes: typeof notesValue === 'string' && notesValue.trim() ? notesValue.trim() : null,
    source: String(record.source ?? metrics.source ?? 'clarity'),
    payloadJson: JSON.stringify(payload),
  };
}

function getPayloadItems(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidate = extractCandidateObject(payload);
  const nested = pickValue(candidate, ['items', 'rows', 'data', 'results', 'snapshots']);
  if (Array.isArray(nested)) {
    return nested;
  }

  if (candidate && Object.keys(candidate).length > 0) {
    return [candidate];
  }

  return [];
}

function buildNotes(input: ParsedClaritySnapshot, sourceCount: number) {
  if (input.notes) {
    return input.notes;
  }

  if (sourceCount === 0) {
    return 'Sin datos devueltos por la exportación de Análisis/UX';
  }

  return null;
}

function clarityMetricNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sumClarityMetric(rows: Record<string, unknown>[], field: string): number | null {
  if (rows.length === 0) return null;
  let total = 0;
  for (const row of rows) {
    const value = clarityMetricNumber(row[field]);
    if (value === null) return null;
    total += value;
  }
  return total;
}

function normalizeClarityExport(items: unknown[], clientId: string, snapshotDate: string): ClaritySnapshotInput {
  const metrics = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const record = extractCandidateObject(item);
    if (typeof record.metricName !== 'string' || !Array.isArray(record.information)) {
      throw new Error('La exportación de Clarity tiene un formato de métricas desconocido');
    }
    const rows = record.information.map((row) => extractCandidateObject(row));
    const name = record.metricName.toLowerCase();
    metrics.set(name, [...(metrics.get(name) ?? []), ...rows]);
  }

  const sessions = sumClarityMetric(metrics.get('traffic') ?? [], 'totalSessionCount');
  if (sessions === null) {
    throw new Error('La exportación de Clarity no contiene sesiones de Traffic válidas');
  }

  const rageClicks = sumClarityMetric(metrics.get('rageclickcount') ?? [], 'subTotal');
  const deadClicks = sumClarityMetric(metrics.get('deadclickcount') ?? [], 'subTotal');
  const scrollRows = metrics.get('scrolldepth') ?? [];
  let scrollDepthAvg: number | null = null;
  if (scrollRows.length === 1) {
    scrollDepthAvg = clarityMetricNumber(scrollRows[0].averageScrollDepth);
  } else if (scrollRows.length > 1) {
    const weights = scrollRows.map((row) => clarityMetricNumber(row.sessionsCount));
    const depths = scrollRows.map((row) => clarityMetricNumber(row.averageScrollDepth));
    if (weights.every((weight) => weight !== null) && depths.every((depth) => depth !== null)) {
      const totalWeight = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
      if (totalWeight > 0) {
        scrollDepthAvg = depths.reduce<number>((sum, depth, index) => sum + (depth ?? 0) * (weights[index] ?? 0), 0) / totalWeight;
      }
    }
  }

  return {
    clientId,
    snapshotDate,
    sessions,
    pageViews: 0,
    rageClicks: rageClicks ?? 0,
    deadClicks: deadClicks ?? 0,
    scrollDepthAvg: scrollDepthAvg ?? 0,
    engagedSessions: 0,
    conversions: 0,
    conversionRate: 0,
    notes: 'Clarity exporta una ventana móvil; las métricas no incluidas en la respuesta se muestran como no disponibles.',
    source: 'clarity',
    payloadJson: JSON.stringify(items),
  };
}

export function normalizeClaritySnapshots(payload: unknown, clientId: string, fallbackDate = nowIso().slice(0, 10)): ClaritySnapshotInput[] {
  const items = getPayloadItems(payload);
  if (items.some((item) => typeof extractCandidateObject(item).metricName === 'string')) {
    return [normalizeClarityExport(items, clientId, fallbackDate)];
  }
  if (items.length === 0) {
    return [
      {
        clientId,
        snapshotDate: fallbackDate,
        sessions: 0,
        pageViews: 0,
        rageClicks: 0,
        deadClicks: 0,
        scrollDepthAvg: 0,
        engagedSessions: 0,
        conversions: 0,
        conversionRate: 0,
        notes: 'Sin datos devueltos por la exportación de Análisis/UX',
        source: 'clarity',
        payloadJson: JSON.stringify(payload ?? null),
      },
    ];
  }

  return items.map((item) => {
    const parsed = parseSnapshotItem(item, fallbackDate);
    return {
      clientId,
      snapshotDate: parsed.snapshotDate,
      sessions: parsed.sessions,
      pageViews: parsed.pageViews,
      rageClicks: parsed.rageClicks,
      deadClicks: parsed.deadClicks,
      scrollDepthAvg: parsed.scrollDepthAvg,
      engagedSessions: parsed.engagedSessions,
      conversions: parsed.conversions,
      conversionRate: parsed.conversionRate,
      notes: buildNotes(parsed, items.length),
      source: parsed.source || 'clarity',
      payloadJson: parsed.payloadJson,
    };
  });
}

export function resolveClarityExportUrl(context: ClarityIntegrationContext) {
  const template = context.exportUrl?.trim() || process.env.CLARITY_EXPORT_URL?.trim() || process.env.CLARITY_EXPORT_URL_TEMPLATE?.trim() || DEFAULT_CLARITY_EXPORT_URL;

  const replacements: Record<string, string> = {
    projectId: context.projectId?.trim() ?? '',
    siteUrl: context.siteUrl?.trim() ?? '',
    segmentName: context.segmentName?.trim() ?? '',
  };

  return template.replace(/\{(projectId|siteUrl|segmentName)\}/g, (_match, key: keyof typeof replacements) => encodeURIComponent(replacements[key] ?? ''));
}

export async function fetchClaritySnapshots(
  context: ClarityIntegrationContext,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  const exportUrl = resolveClarityExportUrl(context);
  const controller = new AbortController();
  const timeoutMs = Number(process.env.CLARITY_SYNC_TIMEOUT_MS ?? 15000);
  const timeoutId = globalThis.setTimeout(() => controller.abort(new DOMException('Análisis/UX sync timeout', 'AbortError')), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000);

  try {
    const headers = new Headers({
      accept: 'application/json',
    });

    if (context.accessToken?.trim()) {
      headers.set('authorization', `Bearer ${context.accessToken.trim()}`);
    }

    const response = await fetchImpl(exportUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Análisis/UX respondió ${response.status}: ${responseText.slice(0, 200) || 'sin cuerpo'}`);
    }

    let payload: unknown = null;
    if (responseText.trim()) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    if (!getPayloadItems(payload).length) {
      throw new Error('Clarity devolvió una exportación vacía; no se ha guardado un snapshot');
    }

    return normalizeClaritySnapshots(payload, context.clientId);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
