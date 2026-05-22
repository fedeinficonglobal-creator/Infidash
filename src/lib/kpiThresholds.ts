export type KpiKey = 'revenue' | 'roas' | 'conversions' | 'cpa';

export interface KpiThresholds {
  revenue: number;
  roas: number;
  conversions: number;
  cpa: number;
}

export type KpiDirection = 'higher-is-better' | 'lower-is-better';
export type KpiStatus = 'success' | 'failure';
export type MonthlyKpiStatus = 'success' | 'warning' | 'fail' | 'unknown';

export interface KpiThresholdState {
  key: KpiKey;
  label: string;
  current: number;
  target: number;
  direction: KpiDirection;
  status: KpiStatus;
}

export interface MonthlyKpiComparison {
  target: number;
  current: number;
  previous: number | null;
  difference: number;
  differencePct: number | null;
  status: MonthlyKpiStatus;
}

export const MONTHLY_CLOSE_DAY = 25;

export const DEFAULT_KPI_THRESHOLDS: KpiThresholds = {
  revenue: 10000,
  roas: 4,
  conversions: 100,
  cpa: 15,
};

function coerceNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function normalizeKpiThresholds(input?: Partial<KpiThresholds> | null): KpiThresholds {
  return {
    revenue: coerceNumber(input?.revenue, DEFAULT_KPI_THRESHOLDS.revenue),
    roas: coerceNumber(input?.roas, DEFAULT_KPI_THRESHOLDS.roas),
    conversions: coerceNumber(input?.conversions, DEFAULT_KPI_THRESHOLDS.conversions),
    cpa: coerceNumber(input?.cpa, DEFAULT_KPI_THRESHOLDS.cpa),
  };
}

export function parseKpiThresholdsJson(raw: string | null | undefined): KpiThresholds {
  if (!raw) {
    return { ...DEFAULT_KPI_THRESHOLDS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KpiThresholds>;
    return normalizeKpiThresholds(parsed);
  } catch {
    return { ...DEFAULT_KPI_THRESHOLDS };
  }
}

export function evaluateKpiThresholds(values: Record<KpiKey, number>, thresholds?: Partial<KpiThresholds> | null): KpiThresholdState[] {
  const normalized = normalizeKpiThresholds(thresholds);

  return [
    {
      key: 'revenue',
      label: 'Revenue',
      current: values.revenue,
      target: normalized.revenue,
      direction: 'higher-is-better',
      status: values.revenue >= normalized.revenue ? 'success' : 'failure',
    },
    {
      key: 'roas',
      label: 'ROAS',
      current: values.roas,
      target: normalized.roas,
      direction: 'higher-is-better',
      status: values.roas >= normalized.roas ? 'success' : 'failure',
    },
    {
      key: 'conversions',
      label: 'Conversiones',
      current: values.conversions,
      target: normalized.conversions,
      direction: 'higher-is-better',
      status: values.conversions >= normalized.conversions ? 'success' : 'failure',
    },
    {
      key: 'cpa',
      label: 'CPA',
      current: values.cpa,
      target: normalized.cpa,
      direction: 'lower-is-better',
      status: values.cpa <= normalized.cpa ? 'success' : 'failure',
    },
  ];
}

export function evaluateMonthlyKpiComparison(current: number, target: number, previous: number | null, warningRatio = 0.2): MonthlyKpiComparison {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrevious = previous !== null && Number.isFinite(previous) ? previous : null;
  const difference = safeCurrent - safeTarget;
  const differencePct = safePrevious && safePrevious !== 0 ? ((safeCurrent - safePrevious) / safePrevious) * 100 : null;

  if (safeTarget <= 0) {
    return {
      target: safeTarget,
      current: safeCurrent,
      previous: safePrevious,
      difference,
      differencePct,
      status: 'unknown',
    };
  }

  if (safeCurrent >= safeTarget) {
    return {
      target: safeTarget,
      current: safeCurrent,
      previous: safePrevious,
      difference,
      differencePct,
      status: 'success',
    };
  }

  const warningFloor = safeTarget * Math.max(0, 1 - warningRatio);
  return {
    target: safeTarget,
    current: safeCurrent,
    previous: safePrevious,
    difference,
    differencePct,
    status: safeCurrent >= warningFloor ? 'warning' : 'fail',
  };
}

export function shouldCloseMonthlyKpis(date = new Date()) {
  return date.getDate() === MONTHLY_CLOSE_DAY;
}
