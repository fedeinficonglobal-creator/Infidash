export interface RrssPlanRowInput {
  web: string;
  rrss: string;
  objetivo: string;
  inspoIdea: string;
  competidores: string;
}

export interface RrssPlanRow extends RrssPlanRowInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_PREFIX = 'infidash.rrss-plan';

export function getRrssPlanStorageKey(clientId: string) {
  return `${STORAGE_PREFIX}:${clientId}`;
}

export function getRrssMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date).toUpperCase();
}

export function normalizeRrssPlanRow(input: Partial<RrssPlanRow> & RrssPlanRowInput, timestamp = new Date().toISOString()): RrssPlanRow {
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id : crypto.randomUUID(),
    web: input.web.trim(),
    rrss: input.rrss.trim(),
    objetivo: input.objetivo.trim(),
    inspoIdea: input.inspoIdea.trim(),
    competidores: input.competidores.trim(),
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : timestamp,
    updatedAt: timestamp,
  };
}

export function upsertRrssPlanRow(rows: RrssPlanRow[], input: Partial<RrssPlanRow> & RrssPlanRowInput, timestamp = new Date().toISOString()) {
  const nextRow = normalizeRrssPlanRow(input, timestamp);
  const index = rows.findIndex((row) => row.id === nextRow.id);

  if (index === -1) {
    return [...rows, nextRow];
  }

  const updated: RrssPlanRow = {
    ...rows[index],
    ...nextRow,
    createdAt: rows[index].createdAt,
    updatedAt: timestamp,
  };

  return rows.map((row, currentIndex) => (currentIndex === index ? updated : row));
}

export function removeRrssPlanRow(rows: RrssPlanRow[], rowId: string) {
  return rows.filter((row) => row.id !== rowId);
}

export function parseRrssPlanRows(raw: string | null) {
  if (!raw) {
    return [] as RrssPlanRow[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as RrssPlanRow[];
    }

    return parsed
      .filter((entry): entry is Partial<RrssPlanRow> & RrssPlanRowInput => Boolean(entry) && typeof entry === 'object')
      .map((entry) => normalizeRrssPlanRow({
        id: typeof entry.id === 'string' ? entry.id : undefined,
        web: typeof entry.web === 'string' ? entry.web : '',
        rrss: typeof entry.rrss === 'string' ? entry.rrss : '',
        objetivo: typeof entry.objetivo === 'string' ? entry.objetivo : '',
        inspoIdea: typeof entry.inspoIdea === 'string' ? entry.inspoIdea : '',
        competidores: typeof entry.competidores === 'string' ? entry.competidores : '',
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
      }, typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()));
  } catch {
    return [] as RrssPlanRow[];
  }
}

export function loadRrssPlanRows(clientId: string) {
  if (typeof window === 'undefined') {
    return [] as RrssPlanRow[];
  }

  return parseRrssPlanRows(window.localStorage.getItem(getRrssPlanStorageKey(clientId)));
}

export function saveRrssPlanRows(clientId: string, rows: RrssPlanRow[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getRrssPlanStorageKey(clientId), JSON.stringify(rows));
}
