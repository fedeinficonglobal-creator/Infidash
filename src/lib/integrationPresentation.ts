export interface IntegrationSecretView {
  webhookSecret: string | null;
}

export function redactIntegrationSecrets<T extends IntegrationSecretView>(integrations: T[], role: 'admin' | 'viewer') {
  if (role === 'admin') return integrations;
  return integrations.map((integration) => ({ ...integration, webhookSecret: null }));
}
