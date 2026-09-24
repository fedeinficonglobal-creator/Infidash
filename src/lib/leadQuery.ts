export type LeadStatus = 'new' | 'in_progress' | 'closed' | 'lost';

export interface LeadQuery {
  limit: number;
  offset: number;
  status: LeadStatus | null;
  source: string | null;
}

function integerParameter(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Parámetro de paginación inválido');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error('Parámetro de paginación fuera de rango');
  return parsed;
}

export function parseLeadQuery(query: Record<string, unknown>): LeadQuery {
  const limit = integerParameter(query.limit, 50, 1, 100);
  const offset = integerParameter(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const status = query.status === undefined || query.status === '' ? null : query.status;
  if (status !== null && !['new', 'in_progress', 'closed', 'lost'].includes(String(status))) {
    throw new Error('Estado de lead inválido');
  }
  if (status !== null && typeof status !== 'string') throw new Error('Estado de lead inválido');
  const source = query.source === undefined || query.source === '' ? null : query.source;
  if (source !== null && (typeof source !== 'string' || source.trim().length === 0 || source.trim().length > 100)) {
    throw new Error('Fuente de lead inválida');
  }
  return { limit, offset, status: status as LeadStatus | null, source: source === null ? null : (source as string).trim() };
}
