import { type DailyStat } from '../services/infidashApi.js';

export interface ComparisonMetric {
  key: 'revenue' | 'roas' | 'conversions' | 'cpa';
  label: string;
  current: number;
  previous: number;
  absoluteDelta: number;
  percentDelta: number | null;
}

export interface ComparisonPeriod {
  currentCount: number;
  previousCount: number;
  metrics: ComparisonMetric[];
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMetric(
  key: ComparisonMetric['key'],
  label: string,
  currentValues: number[],
  previousValues: number[],
  reducer: 'sum' | 'avg',
): ComparisonMetric {
  const current = reducer === 'sum' ? currentValues.reduce((sum, value) => sum + value, 0) : average(currentValues);
  const previous = reducer === 'sum' ? previousValues.reduce((sum, value) => sum + value, 0) : average(previousValues);
  const absoluteDelta = current - previous;
  const percentDelta = previous !== 0 ? (absoluteDelta / previous) * 100 : null;

  return {
    key,
    label,
    current,
    previous,
    absoluteDelta,
    percentDelta,
  };
}

export function buildComparisonPeriod(stats: DailyStat[], windowSize = 7): ComparisonPeriod | null {
  if (stats.length === 0) {
    return null;
  }

  const sortedStats = [...stats].sort((a, b) => a.statDate.localeCompare(b.statDate));
  const currentWindow = sortedStats.slice(-windowSize);
  const previousWindow = sortedStats.slice(-windowSize * 2, -windowSize);

  const currentRevenue = currentWindow.map((stat) => stat.revenue);
  const previousRevenue = previousWindow.map((stat) => stat.revenue);
  const currentRoas = currentWindow.map((stat) => stat.roas);
  const previousRoas = previousWindow.map((stat) => stat.roas);
  const currentConversions = currentWindow.map((stat) => stat.conversions);
  const previousConversions = previousWindow.map((stat) => stat.conversions);
  const currentCpa = currentWindow.map((stat) => stat.cpa);
  const previousCpa = previousWindow.map((stat) => stat.cpa);

  return {
    currentCount: currentWindow.length,
    previousCount: previousWindow.length,
    metrics: [
      buildMetric('revenue', 'Ventas', currentRevenue, previousRevenue, 'sum'),
      buildMetric('roas', 'ROAS', currentRoas, previousRoas, 'avg'),
      buildMetric('conversions', 'Conversiones', currentConversions, previousConversions, 'sum'),
      buildMetric('cpa', 'CPA', currentCpa, previousCpa, 'avg'),
    ],
  };
}
