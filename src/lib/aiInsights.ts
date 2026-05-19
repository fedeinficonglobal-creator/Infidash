import { type Client } from '../store/useClientStore.js';
import { buildClientSignals } from './clientSignals.js';

export interface AiInsightPlan {
  title: string;
  ctaLabel: string;
  summary: string;
  priorityItems: string[];
  contentPillars: string[];
  budgetFocus: string;
  highlight: string;
}

function buildContentPillars(industry: string) {
  const text = industry.toLowerCase();

  if (text.includes('moda') || text.includes('joyer')) {
    return ['Producto estrella', 'Lookbook y combinaciones', 'Prueba social'];
  }

  if (text.includes('b2b') || text.includes('industrial') || text.includes('servicio')) {
    return ['Caso de uso', 'Demostración / demo', 'Pipeline comercial'];
  }

  return ['Producto o servicio top', 'Beneficio clave', 'Prueba social'];
}

export function buildAiInsightPlan(client: Client): AiInsightPlan {
  const signals = buildClientSignals(client);
  const contentPillars = buildContentPillars(client.industry);

  const priorityItems =
    signals.healthBand === 'excellent'
      ? [
          'Escalar presupuesto en las campañas con mejor ROAS y menor CPA.',
          'Duplicar remarketing sobre audiencias calientes antes de ampliar prospecting.',
          'Reforzar creatividades ganadoras con variantes ligeras de copy y formato.',
        ]
      : signals.healthBand === 'stable'
        ? [
            'Mantener inversión estable y validar qué creatividades sostienen el ritmo.',
            'Probar una variante de copy enfocada en el beneficio principal del cliente.',
            'Revisar semanalmente la relación entre CPA y ROAS por canal.',
          ]
        : signals.healthBand === 'risk'
          ? [
              'Reducir fricción en campañas y priorizar pruebas A/B de audiencias.',
              'Reforzar remarketing para recuperar tráfico ya cualificado.',
              'Alinear mensaje creativo con la promesa principal del cliente.',
            ]
          : [
              'Escalar solo las campañas con señal positiva y pausar el resto temporalmente.',
              'Revisar tracking, creatividades y landing antes de subir más presupuesto.',
              'Poner foco en remarketing y en recuperación de conversiones calientes.',
            ];

  const budgetFocus =
    signals.healthBand === 'excellent'
      ? 'Redirige más presupuesto a remarketing y a las campañas de mayor ROAS para capturar demanda ya cualificada.'
      : signals.healthBand === 'stable'
        ? 'Mantén el presupuesto estable y mueve una parte menor a remarketing para proteger eficiencia.'
        : signals.healthBand === 'risk'
          ? 'Ajusta presupuesto hacia audiencias calientes, remarketing y pruebas controladas de copy.'
          : 'Detén la expansión y concentra la inversión en remarketing, tracking y campañas con retorno comprobado.';

  return {
    title: 'Insights prioritarios',
    ctaLabel: 'Abrir Insights IA',
    summary: signals.primaryMessage,
    priorityItems,
    contentPillars,
    budgetFocus,
    highlight: signals.actionMessage,
  };
}
