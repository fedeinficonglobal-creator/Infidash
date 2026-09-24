export type LeadExportRow = {
  name: string;
  source: string;
  status: string;
  date: string;
};

const CSV_HEADERS = ['Contacto', 'Fuente', 'Estado', 'Fecha'];

function escapeCsvValue(value: string) {
  const normalized = value.replace(/"/g, '""');
  return /[",\n\r]/.test(normalized) ? `"${normalized}"` : normalized;
}

export function buildLeadsCsv(rows: LeadExportRow[]) {
  const lines = [CSV_HEADERS.join(',')];

  for (const row of rows) {
    lines.push(
      [row.name, row.source, row.status, row.date]
        .map((value) => escapeCsvValue(value))
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}
