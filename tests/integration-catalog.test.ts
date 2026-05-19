import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIntegrationCapabilitySummary,
  buildIntegrationDisplayName,
  defaultIntegrationSection,
  getIntegrationCapabilityLabel,
  getIntegrationProviderDefinition,
  listMissingIntegrationFields,
} from '../src/lib/integrationCatalog.js';

test('integration catalog exposes the first priority providers', () => {
  assert.equal(getIntegrationProviderDefinition('clarity')?.label, 'Microsoft Clarity');
  assert.deepEqual(getIntegrationProviderDefinition('wordpress')?.capabilities, ['leads']);
  assert.deepEqual(getIntegrationProviderDefinition('woocommerce')?.capabilities, ['sales']);
});

test('integration catalog fills defaults and detects required fields', () => {
  const wordpress = getIntegrationProviderDefinition('wordpress');
  assert.ok(wordpress);
  const config = defaultIntegrationSection(wordpress!.configFields);
  const credentials = defaultIntegrationSection(wordpress!.credentialFields);
  assert.equal(config.restNamespace, '/wp-json/wp/v2');
  assert.equal(config.leadFormPath, '/contacto');
  assert.equal(credentials.username, '');
  assert.ok(listMissingIntegrationFields(wordpress!, config, credentials).includes('Usuario'));
});

test('integration catalog builds readable display names', () => {
  const clarity = getIntegrationProviderDefinition('clarity');
  const woocommerce = getIntegrationProviderDefinition('woocommerce');
  assert.ok(clarity);
  assert.ok(woocommerce);
  assert.equal(
    buildIntegrationDisplayName(clarity!, { projectId: 'abc-123', siteUrl: 'https://example.com', segmentName: 'Principal' }),
    'Microsoft Clarity · Principal',
  );
  assert.equal(
    buildIntegrationDisplayName(woocommerce!, { storeUrl: 'https://tienda.ejemplo.com', currency: 'EUR', orderStatus: 'processing,completed' }),
    'WooCommerce · tienda.ejemplo.com',
  );
  assert.equal(buildIntegrationCapabilitySummary(woocommerce!), 'Ventas');
  assert.equal(getIntegrationCapabilityLabel('analytics'), 'Analítica');
});
