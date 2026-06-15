export interface WebPlanRowInput {
  cliente: string;
  web: string;
  kpi: string;
  umbralLeads: string;
  leadsAbril: string;
  accionMayo: string;
  leadsMayo: string;
  wpoMayo: string;
}

export interface WebPlanRow extends WebPlanRowInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_PREFIX = 'infidash.web-plan';

export function getWebPlanStorageKey(clientId: string) {
  return `${STORAGE_PREFIX}:${clientId}`;
}

export function getWebMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date).toUpperCase();
}

export function normalizeWebPlanRow(input: Partial<WebPlanRow> & WebPlanRowInput, timestamp = new Date().toISOString()): WebPlanRow {
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id : crypto.randomUUID(),
    cliente: input.cliente.trim(),
    web: input.web.trim(),
    kpi: input.kpi.trim(),
    umbralLeads: input.umbralLeads.trim(),
    leadsAbril: input.leadsAbril.trim(),
    accionMayo: input.accionMayo.trim(),
    leadsMayo: input.leadsMayo.trim(),
    wpoMayo: input.wpoMayo.trim(),
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : timestamp,
    updatedAt: timestamp,
  };
}

export function upsertWebPlanRow(rows: WebPlanRow[], input: Partial<WebPlanRow> & WebPlanRowInput, timestamp = new Date().toISOString()) {
  const nextRow = normalizeWebPlanRow(input, timestamp);
  const index = rows.findIndex((row) => row.id === nextRow.id);

  if (index === -1) {
    return [...rows, nextRow];
  }

  const updated: WebPlanRow = {
    ...rows[index],
    ...nextRow,
    createdAt: rows[index].createdAt,
    updatedAt: timestamp,
  };

  return rows.map((row, currentIndex) => (currentIndex === index ? updated : row));
}

export function removeWebPlanRow(rows: WebPlanRow[], rowId: string) {
  return rows.filter((row) => row.id !== rowId);
}

export function parseWebPlanRows(raw: string | null) {
  if (!raw) return [] as WebPlanRow[];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [] as WebPlanRow[];

    return parsed
      .filter((entry): entry is Partial<WebPlanRow> & WebPlanRowInput => Boolean(entry) && typeof entry === 'object')
      .map((entry) => normalizeWebPlanRow({
        id: typeof entry.id === 'string' ? entry.id : undefined,
        cliente: typeof entry.cliente === 'string' ? entry.cliente : '',
        web: typeof entry.web === 'string' ? entry.web : '',
        kpi: typeof entry.kpi === 'string' ? entry.kpi : '',
        umbralLeads: typeof entry.umbralLeads === 'string' ? entry.umbralLeads : '',
        leadsAbril: typeof entry.leadsAbril === 'string' ? entry.leadsAbril : '',
        accionMayo: typeof entry.accionMayo === 'string' ? entry.accionMayo : '',
        leadsMayo: typeof entry.leadsMayo === 'string' ? entry.leadsMayo : '',
        wpoMayo: typeof entry.wpoMayo === 'string' ? entry.wpoMayo : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
      }, typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()));
  } catch {
    return [] as WebPlanRow[];
  }
}

export function loadWebPlanRows(clientId: string) {
  if (typeof window === 'undefined') return [] as WebPlanRow[];
  return parseWebPlanRows(window.localStorage.getItem(getWebPlanStorageKey(clientId)));
}

export function saveWebPlanRows(clientId: string, rows: WebPlanRow[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getWebPlanStorageKey(clientId), JSON.stringify(rows));
}
