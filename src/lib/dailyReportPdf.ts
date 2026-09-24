import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const regularFont = fileURLToPath(new URL('../../assets/fonts/DejaVuSans.ttf', import.meta.url));
const boldFont = fileURLToPath(new URL('../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url));

export interface ReportDailyStat {
  statDate: string;
  revenue: number;
  conversions: number;
  source: string;
}

function daysInclusive(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * 86_400_000) {
    throw new Error('Selecciona un periodo válido de hasta 367 días');
  }
  if (new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to) {
    throw new Error('Selecciona fechas de calendario válidas');
  }
  return Math.round((end - start) / 86_400_000) + 1;
}

export function summarizeDailyStats(stats: ReportDailyStat[], from: string, to: string) {
  const expectedDays = daysInclusive(from, to);
  const byDate = new Map(stats.filter((stat) => stat.statDate >= from && stat.statDate <= to).map((stat) => [stat.statDate, stat]));
  const rows = [...byDate.values()].sort((a, b) => a.statDate.localeCompare(b.statDate));
  return {
    rows,
    expectedDays,
    reportedDays: rows.length,
    revenue: rows.reduce((sum, stat) => sum + (Number.isFinite(stat.revenue) ? stat.revenue : 0), 0),
    conversions: rows.reduce((sum, stat) => sum + (Number.isFinite(stat.conversions) ? stat.conversions : 0), 0),
    sources: [...new Set(rows.map((stat) => stat.source || 'sin identificar'))].sort(),
  };
}

export async function buildDailyStatsPdf(input: { clientName: string; from: string; to: string; generatedAt: string; stats: ReportDailyStat[] }) {
  const summary = summarizeDailyStats(input.stats, input.from, input.to);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 48, left: 48, right: 48 }, bufferPages: true });
  doc.registerFont('ReportRegular', regularFont);
  doc.registerFont('ReportBold', boldFont);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const money = (value: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  const drawHeader = () => {
    doc.fillColor('#0f172a').font('ReportBold').fontSize(22).text('Informe de métricas diarias');
    doc.moveDown(0.4).fillColor('#475569').font('ReportRegular').fontSize(11).text(input.clientName);
    doc.text(`Periodo: ${input.from} a ${input.to}  |  Generado: ${input.generatedAt.slice(0, 10)}`);
    doc.moveDown(1.2);
  };
  drawHeader();
  doc.fillColor('#0f172a').font('ReportBold').fontSize(13).text('Resumen del periodo');
  doc.moveDown(0.5).fillColor('#334155').font('ReportRegular').fontSize(10)
    .text(`Días con datos: ${summary.reportedDays} de ${summary.expectedDays}`)
    .text(`Ingresos declarados: ${summary.reportedDays ? money(summary.revenue) : 'No disponible'}`)
    .text(`Conversiones declaradas: ${summary.reportedDays ? summary.conversions : 'No disponible'}`)
    .text(`Fuentes: ${summary.sources.length ? summary.sources.join(', ') : 'Ninguna'}`);
  doc.moveDown(0.8).fillColor('#92400e').fontSize(9)
    .text('Estos importes son métricas diarias registradas en Infidash, no ventas conciliadas de WooCommerce. ROAS, CPA y otras fuentes no se calculan sin datos comparables. Los días sin registro no se interpretan como cero.', { width: 490 });
  doc.moveDown(1.3).fillColor('#0f172a').font('ReportBold').fontSize(13).text('Histórico diario');
  doc.moveDown(0.6);
  const drawTableHeader = () => {
    const y = doc.y;
    doc.rect(48, y, 499, 24).fill('#e2e8f0');
    doc.fillColor('#334155').font('ReportBold').fontSize(9);
    doc.text('Fecha', 56, y + 7, { width: 100 });
    doc.text('Ingresos', 170, y + 7, { width: 110 });
    doc.text('Conv.', 305, y + 7, { width: 65 });
    doc.text('Fuente', 390, y + 7, { width: 150 });
    doc.y = y + 28;
  };
  drawTableHeader();
  if (!summary.rows.length) doc.font('ReportRegular').fillColor('#64748b').fontSize(10).text('Sin datos diarios para este periodo.', 56, doc.y + 8);
  for (const [index, stat] of summary.rows.entries()) {
    if (doc.y > 750) { doc.addPage(); drawTableHeader(); }
    const y = doc.y;
    if (index % 2 === 1) doc.rect(48, y, 499, 22).fill('#f8fafc');
    doc.fillColor('#334155').font('ReportRegular').fontSize(9);
    doc.text(stat.statDate, 56, y + 6, { width: 100 });
    doc.text(money(stat.revenue), 170, y + 6, { width: 110 });
    doc.text(String(stat.conversions), 305, y + 6, { width: 65 });
    doc.text(stat.source || 'sin identificar', 390, y + 6, { width: 150, ellipsis: true });
    doc.y = y + 22;
  }
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    doc.switchToPage(page);
    doc.fillColor('#94a3b8').font('ReportRegular').fontSize(8).text(`Infidash  |  Página ${page + 1} de ${pages.count}`, 48, 780, { width: 499, align: 'right' });
  }
  doc.end();
  return finished;
}
