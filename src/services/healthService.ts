export function calculateHealthScore(metrics: {
  sales_change: number;
  roas: number;
  cpa_trend: 'up' | 'down';
  retention_rate: number;
}) {
  // Variables y pesos:
  // ROAS: 40% (Escala 0-10, meta > 4.0)
  // Sales Change: 30% (Escala 0-10, meta > 10%)
  // Retention: 20% (Escala 0-10, meta > 60%)
  // CPA Trend: 10% (Escala 0-10, down is good)

  const roasScore = Math.min((metrics.roas / 4) * 10, 10) * 4;
  const salesScore = Math.min((Math.max(metrics.sales_change, 0) / 20) * 10, 10) * 3;
  const retentionScore = Math.min((metrics.retention_rate / 80) * 10, 10) * 2;
  const cpaScore = (metrics.cpa_trend === 'down' ? 10 : 3) * 1;

  const total = roasScore + salesScore + retentionScore + cpaScore;

  return {
    total: Math.round(total),
    segments: {
      sales: Math.round(salesScore / 0.3),
      ads: Math.round(roasScore / 0.4),
      ux: Math.round(retentionScore / 0.2)
    }
  };
}
