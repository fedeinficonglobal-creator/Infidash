type ClarityDisplayMetric = 'sessions' | 'pageViews' | 'rageClicks' | 'deadClicks' | 'scrollDepthAvg';

/** Old Clarity rows contain only the last metric item; their normalized zeros are unreliable. */
export function hasClarityMetric(snapshot: { source: string; payloadJson: string }, metric: ClarityDisplayMetric): boolean {
  if (snapshot.source.toLowerCase() !== 'clarity') return true;

  let payload: unknown;
  try {
    payload = JSON.parse(snapshot.payloadJson);
  } catch {
    return false;
  }

  if (!Array.isArray(payload)) {
    return typeof payload === 'object' && payload !== null && !('metricName' in payload);
  }

  if (metric === 'pageViews') return false;
  const name = {
    sessions: 'Traffic',
    rageClicks: 'RageClickCount',
    deadClicks: 'DeadClickCount',
    scrollDepthAvg: 'ScrollDepth',
  }[metric];
  const rows = payload
    .filter((item) => item && typeof item === 'object' && item.metricName === name && Array.isArray(item.information))
    .flatMap((item) => item.information as Array<Record<string, unknown>>);
  if (rows.length === 0) return false;

  const field = metric === 'sessions' ? 'totalSessionCount' : metric === 'scrollDepthAvg' ? 'averageScrollDepth' : 'subTotal';
  if (metric === 'scrollDepthAvg' && rows.length > 1) {
    const weights = rows.map((row: Record<string, unknown>) => Number(row?.sessionsCount));
    if (!weights.every((weight: number) => Number.isFinite(weight) && weight >= 0) ||
      weights.reduce((sum: number, weight: number) => sum + weight, 0) === 0) return false;
  }
  return rows.every((row: Record<string, unknown>) =>
    row?.[field] !== undefined && row[field] !== null && row[field] !== '' && Number.isFinite(Number(row[field])) && Number(row[field]) >= 0);
}
