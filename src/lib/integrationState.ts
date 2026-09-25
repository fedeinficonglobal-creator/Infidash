import type { IntegrationStatus } from './integrationCatalog.js';

export type LiveIntegrationProvider = 'clarity' | 'wordpress';

export function hasLiveIntegrationAdapter(provider: string): provider is LiveIntegrationProvider {
  return provider === 'clarity' || provider === 'wordpress';
}

export function hasManualIntegrationSync(provider: string) {
  return provider === 'clarity';
}

export function statusForIntegrationView(provider: string, status: IntegrationStatus): IntegrationStatus {
  return status === 'connected' && !hasLiveIntegrationAdapter(provider) ? 'pending' : status;
}

export function resolveIntegrationSaveState(input: {
  provider: string;
  existingStatus?: IntegrationStatus | null;
  existingLastError?: string | null;
  configurationUnchanged: boolean;
  missingFields: string[];
}) {
  if (input.missingFields.length > 0) {
    return { status: 'pending' as const, lastError: `Faltan campos obligatorios: ${input.missingFields.join(', ')}` };
  }
  if (input.configurationUnchanged && input.existingStatus === 'disabled') {
    return { status: 'disabled' as const, lastError: input.existingLastError ?? null };
  }
  if (input.configurationUnchanged && hasLiveIntegrationAdapter(input.provider)
    && input.existingStatus === 'connected') {
    return { status: 'connected' as const, lastError: null };
  }
  if (input.configurationUnchanged && input.existingStatus === 'error') {
    return { status: 'error' as const, lastError: input.existingLastError ?? 'La última prueba o sincronización falló.' };
  }
  return {
    status: 'pending' as const,
    lastError: hasLiveIntegrationAdapter(input.provider)
      ? 'Configuración guardada; falta una prueba o sincronización real.'
      : 'No hay un adaptador de conexión/sincronización real para este proveedor todavía.',
  };
}
