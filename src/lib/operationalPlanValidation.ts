import type { OperationalPlanDomain } from './database.js';

const fieldsByDomain = {
  web: ['cliente', 'web', 'kpi', 'umbralLeads', 'leadsAbril', 'accionMayo', 'leadsMayo', 'wpoMayo'],
  rrss: ['web', 'rrss', 'objetivo', 'inspoIdea', 'competidores'],
} as const;

export function isOperationalPlanDomain(value: unknown): value is OperationalPlanDomain {
  return value === 'web' || value === 'rrss';
}

export function isPlanPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isHttpUrlOrBlank(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeOperationalPlanRows(domain: OperationalPlanDomain, value: unknown): Array<Record<string, string>> | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const now = new Date().toISOString();
  const ids = new Set<string>();
  const rows: Array<Record<string, string>> = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    if (typeof source.id !== 'string' || !source.id.trim() || source.id.length > 100 || ids.has(source.id)) return null;
    ids.add(source.id);

    const row: Record<string, string> = {
      id: source.id,
      createdAt: typeof source.createdAt === 'string' && !Number.isNaN(Date.parse(source.createdAt)) ? source.createdAt : now,
      updatedAt: now,
    };
    for (const field of fieldsByDomain[domain]) {
      if (typeof source[field] !== 'string' || source[field].length > 5000) return null;
      row[field] = source[field].trim();
    }
    if (!isHttpUrlOrBlank(row.web)) return null;
    rows.push(row);
  }
  return rows;
}
