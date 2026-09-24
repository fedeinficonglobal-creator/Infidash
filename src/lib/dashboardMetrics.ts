export interface RevenuePoint {
  statDate: string;
  revenue: number;
}

export function getHealthLabel(score: number | null) {
  if (score === null || !Number.isFinite(score)) return 'Sin datos';
  if (score >= 80) return 'Excelente';
  if (score >= 65) return 'Estable';
  if (score >= 40) return 'En riesgo';
  return 'Crítico';
}

export function formatDailyStatsSummary(input: { loading: boolean; count: number | null }) {
  if (input.loading) return 'Cargando métricas…';
  if (input.count === null) return 'No se pudo cargar el resumen de métricas.';
  if (input.count === 0) return 'Aún no hay métricas diarias registradas.';
  return `Se registraron ${input.count} métricas diarias en la base.`;
}

export function sumRevenueWindow(points: RevenuePoint[], endDate: string, days = 30) {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(end.getTime()) || !Number.isInteger(days) || days < 1) {
    throw new Error('A valid end date and positive integer window are required.');
  }
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startKey = start.toISOString().slice(0, 10);
  const values = points.filter((point) => point.statDate >= startKey && point.statDate <= endDate);
  return {
    total: values.reduce((total, point) => total + point.revenue, 0),
    count: values.length,
    startDate: startKey,
    endDate,
  };
}
