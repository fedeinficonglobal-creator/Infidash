export type IntegrationProvider = 'clarity' | 'wordpress' | 'woocommerce';
export type IntegrationCapability = 'analytics' | 'leads' | 'sales';
export type IntegrationStatus = 'connected' | 'pending' | 'error' | 'disabled';
export type IntegrationFieldType = 'text' | 'url' | 'password' | 'textarea';

export interface IntegrationFieldDefinition {
  key: string;
  label: string;
  type: IntegrationFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
}

export interface IntegrationProviderDefinition {
  provider: IntegrationProvider;
  label: string;
  description: string;
  capabilities: IntegrationCapability[];
  configFields: IntegrationFieldDefinition[];
  credentialFields: IntegrationFieldDefinition[];
}

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    provider: 'clarity',
    label: 'Microsoft Clarity',
    description: 'Analítica de comportamiento, mapas de calor y sesiones para detectar fricción y optimizar conversión.',
    capabilities: ['analytics'],
    configFields: [
      {
        key: 'projectId',
        label: 'Project ID',
        type: 'text',
        required: true,
        placeholder: 'clarity-project-id',
        help: 'Identificador del proyecto de Clarity que se quiere conectar.',
      },
      {
        key: 'siteUrl',
        label: 'URL del sitio',
        type: 'url',
        required: true,
        placeholder: 'https://tudominio.com',
        help: 'Dominio donde está instalado el script de Clarity.',
      },
      {
        key: 'segmentName',
        label: 'Segmento / etiqueta interna',
        type: 'text',
        placeholder: 'Tienda principal',
        help: 'Etiqueta interna para reconocer la fuente dentro de Infidash.',
      },
    ],
    credentialFields: [
      {
        key: 'accessToken',
        label: 'Access token',
        type: 'password',
        required: true,
        placeholder: '••••••••',
        help: 'Token privado guardado solo en backend.',
      },
    ],
  },
  {
    provider: 'wordpress',
    label: 'WordPress',
    description: 'Fuente de leads y formularios para capturar contactos, solicitudes y envíos desde la web.',
    capabilities: ['leads'],
    configFields: [
      {
        key: 'siteUrl',
        label: 'URL del sitio',
        type: 'url',
        required: true,
        placeholder: 'https://tudominio.com',
        help: 'Sitio WordPress al que se conecta Infidash.',
      },
      {
        key: 'restNamespace',
        label: 'Namespace REST',
        type: 'text',
        defaultValue: '/wp-json/wp/v2',
        help: 'Ruta REST usada para leer contenido o capturar metadatos.',
      },
      {
        key: 'leadFormPath',
        label: 'Ruta de leads / formulario',
        type: 'text',
        defaultValue: '/contacto',
        help: 'Ruta o endpoint donde se registran los formularios de contacto.',
      },
      {
        key: 'leadSource',
        label: 'Origen interno',
        type: 'text',
        placeholder: 'WordPress Contact Form',
        help: 'Nombre interno para distinguir el origen de leads.',
      },
    ],
    credentialFields: [
      {
        key: 'username',
        label: 'Usuario',
        type: 'text',
        required: true,
        placeholder: 'api-user',
      },
      {
        key: 'applicationPassword',
        label: 'Application Password',
        type: 'password',
        required: true,
        placeholder: '••••••••',
        help: 'Contraseña de aplicación de WordPress para acceso seguro.',
      },
    ],
  },
  {
    provider: 'woocommerce',
    label: 'WooCommerce',
    description: 'Ventas, pedidos, ticket medio y conversión e-commerce para clientes con tienda online.',
    capabilities: ['sales'],
    configFields: [
      {
        key: 'storeUrl',
        label: 'URL de la tienda',
        type: 'url',
        required: true,
        placeholder: 'https://tienda.com',
        help: 'Dominio principal de WooCommerce.',
      },
      {
        key: 'currency',
        label: 'Moneda',
        type: 'text',
        defaultValue: 'EUR',
        help: 'Moneda con la que se mostrarán ventas y pedidos.',
      },
      {
        key: 'orderStatus',
        label: 'Estados de pedido',
        type: 'text',
        defaultValue: 'processing,completed',
        help: 'Estados de pedido que se consideran ventas válidas.',
      },
    ],
    credentialFields: [
      {
        key: 'consumerKey',
        label: 'Consumer Key',
        type: 'password',
        required: true,
        placeholder: 'ck_••••••••',
      },
      {
        key: 'consumerSecret',
        label: 'Consumer Secret',
        type: 'password',
        required: true,
        placeholder: 'cs_••••••••',
      },
    ],
  },
] as const;

const CAPABILITY_LABELS: Record<IntegrationCapability, string> = {
  analytics: 'Analítica',
  leads: 'Leads',
  sales: 'Ventas',
};

export function getIntegrationProviderDefinition(provider: IntegrationProvider) {
  return INTEGRATION_PROVIDERS.find((definition) => definition.provider === provider) ?? null;
}

export function getIntegrationCapabilityLabel(capability: IntegrationCapability) {
  return CAPABILITY_LABELS[capability];
}

export function defaultIntegrationSection<T extends IntegrationFieldDefinition>(fields: readonly T[]) {
  return fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue ?? '';
    return acc;
  }, {});
}

function coerceValue(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

export function normalizeIntegrationSection<T extends IntegrationFieldDefinition>(
  fields: readonly T[],
  input: Record<string, unknown> | null | undefined,
) {
  return fields.reduce<Record<string, string>>((acc, field) => {
    const raw = input?.[field.key];
    const value = coerceValue(raw);
    acc[field.key] = value || field.defaultValue || '';
    return acc;
  }, {});
}

export function listMissingIntegrationFields(
  definition: IntegrationProviderDefinition,
  config: Record<string, string>,
  credentials: Record<string, string>,
) {
  const missing: string[] = [];

  for (const field of definition.configFields) {
    if (field.required && !config[field.key]?.trim()) {
      missing.push(field.label);
    }
  }

  for (const field of definition.credentialFields) {
    if (field.required && !credentials[field.key]?.trim()) {
      missing.push(field.label);
    }
  }

  return missing;
}

function readableLabel(value: string) {
  return value
    .replace(/https?:\/\//i, '')
    .replace(/\/$/, '')
    .replace(/^www\./i, '')
    .trim();
}

export function buildIntegrationDisplayName(
  definition: IntegrationProviderDefinition,
  config: Record<string, string>,
  customName?: string | null,
) {
  const explicitName = customName?.trim();
  if (explicitName) {
    return explicitName;
  }

  if (definition.provider === 'clarity') {
    const segmentName = config.segmentName?.trim();
    const projectId = config.projectId?.trim();
    if (segmentName) {
      return `${definition.label} · ${segmentName}`;
    }
    if (projectId) {
      return `${definition.label} · ${projectId}`;
    }
  }

  if (definition.provider === 'wordpress') {
    const siteUrl = readableLabel(config.siteUrl ?? '');
    if (siteUrl) {
      return `${definition.label} · ${siteUrl}`;
    }
  }

  if (definition.provider === 'woocommerce') {
    const storeUrl = readableLabel(config.storeUrl ?? '');
    if (storeUrl) {
      return `${definition.label} · ${storeUrl}`;
    }
  }

  return definition.label;
}

export function buildIntegrationCapabilitySummary(definition: IntegrationProviderDefinition) {
  return definition.capabilities.map(getIntegrationCapabilityLabel).join(' · ');
}
