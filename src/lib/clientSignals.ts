import { type Client } from '../store/useClientStore.js';

export type HealthBand = 'excellent' | 'stable' | 'risk' | 'critical';

export interface ClientSignals {
  revenue: number;
  roas: number;
  conversions: number;
  cpa: number;
  healthBand: HealthBand;
  primaryMessage: string;
  riskMessage: string;
  actionMessage: string;
  channelShare: {
    search: number;
    social: number;
    direct: number;
    referral: number;
  };
}

function parseLocaleNumber(value: string | number) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = value
    .toString()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDecimal(value: number, fractionDigits = 1) {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPlain(value: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value);
}

export function getHealthBand(health: number): HealthBand {
  if (health >= 80) return 'excellent';
  if (health >= 65) return 'stable';
  if (health >= 40) return 'risk';
  return 'critical';
}

export function buildClientSignals(client: Client): ClientSignals {
  const revenue = parseLocaleNumber(client.metrics.revenue.value);
  const roas = parseLocaleNumber(client.metrics.roas.value);
  const conversions = parseLocaleNumber(client.metrics.conversions.value);
  const cpa = parseLocaleNumber(client.metrics.cpa.value);
  const healthBand = getHealthBand(client.health);

  const primaryMessage =
    healthBand === 'excellent'
      ? `${client.name} mantiene un ritmo sólido con ${formatMoney(revenue)} de revenue y un ROAS de ${formatDecimal(roas)}x.`
      : healthBand === 'stable'
        ? `${client.name} avanza con estabilidad. El foco está en consolidar el rendimiento y sostener las conversiones.`
        : healthBand === 'risk'
          ? `${client.name} necesita atención táctica: hay señales de presión en CPA y estabilidad de campañas.`
          : `${client.name} está en zona crítica y requiere priorizar correcciones de tráfico, creatividades y seguimiento.`;

  const riskMessage =
    healthBand === 'excellent'
      ? `La combinación de ${formatDecimal(roas)}x ROAS y ${formatPlain(conversions)} conversiones abre margen para escalar.`
      : healthBand === 'stable'
        ? `Hay una base sana, pero conviene vigilar el CPA medio de ${formatMoney(cpa)}.`
        : healthBand === 'risk'
          ? `El equipo debería revisar audiencias, pujas y mensajes para recuperar eficiencia.`
          : `Conviene actuar sobre el embudo antes de aumentar inversión.`;

  const actionMessage =
    healthBand === 'excellent'
      ? 'Escalar presupuesto en las líneas con mejor retorno y reforzar remarketing.'
      : healthBand === 'stable'
        ? 'Optimizar creatividades y mantener vigilancia semanal sobre el ROAS.'
        : healthBand === 'risk'
          ? 'Reducir fricción en campañas y priorizar pruebas A/B de copy y audiencias.'
          : 'Detener la expansión y resolver primero las causas raíz de la caída de rendimiento.';

  const channelShare =
    healthBand === 'excellent'
      ? { search: 46, social: 28, direct: 18, referral: 8 }
      : healthBand === 'stable'
        ? { search: 40, social: 30, direct: 20, referral: 10 }
        : healthBand === 'risk'
          ? { search: 35, social: 32, direct: 22, referral: 11 }
          : { search: 28, social: 35, direct: 24, referral: 13 };

  return {
    revenue,
    roas,
    conversions,
    cpa,
    healthBand,
    primaryMessage,
    riskMessage,
    actionMessage,
    channelShare,
  };
}
