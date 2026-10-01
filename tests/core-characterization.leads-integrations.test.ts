import './helpers/isolated-harness-required.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { UserFacingError } from '../src/lib/userFacingError.js';

// Characterization tests for integrations and leads in src/lib/database.ts.
// They pin CURRENT behavior ahead of the psql-shim -> pg pool migration.

const loadDatabase = () => import('../src/lib/database.js');
const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const MISSING_ID = '00000000-0000-0000-0000-000000000000';
const SAVED_MESSAGE = 'Configuración guardada; falta una prueba o sincronización real.';
const WEBHOOK_SECRET = /^[0-9a-f]{48}$/;

async function makeClient(label = 'Integrations') {
  const { createClient } = await loadDatabase();
  return await createClient({ name: `${label} ${unique()}` });
}

async function makeWordpress(clientId: string, overrides: { config?: Record<string, unknown>; credentials?: Record<string, unknown> } = {}) {
  const { saveClientIntegration } = await loadDatabase();
  const integration = saveClientIntegration({
    clientId,
    provider: 'wordpress',
    config: { siteUrl: `https://wp-${unique()}.example.test`, ...overrides.config },
    credentials: { username: 'api-user', applicationPassword: `app-pw-${unique()}`, ...overrides.credentials },
  });
  assert.ok(integration);
  return integration;
}

function leadInput(clientId: string, integrationId: string | null, extra: Record<string, unknown> = {}) {
  return {
    clientId,
    integrationId,
    source: 'WordPress',
    name: 'Ana',
    email: 'ana@example.test',
    phone: null,
    message: null,
    rawPayload: { name: 'Ana' } as Record<string, unknown>,
    ...extra,
  };
}

// ---------------------------------------------------------------- integrations: save

test('saveClientIntegration creates a pending WordPress integration with defaults, a webhook secret and redacted credentials', async () => {
  const { saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const secret = `secret-pw-${unique()}`;
  const integration = saveClientIntegration({
    clientId: client.id,
    provider: 'wordpress',
    config: { siteUrl: 'https://www.Example.test/' },
    credentials: { username: 'api-user', applicationPassword: secret },
  });

  assert.ok(integration);
  assert.equal(integration.clientId, client.id);
  assert.equal(integration.provider, 'wordpress');
  assert.equal(integration.label, 'WordPress · Example.test');
  assert.equal(integration.status, 'pending');
  assert.equal(integration.isActive, true);
  assert.deepEqual(integration.capabilities, ['leads']);
  assert.deepEqual(integration.config, {
    siteUrl: 'https://www.Example.test/',
    restNamespace: '/wp-json/wp/v2',
    leadFormPath: '/contacto',
    leadSource: '',
  });
  // Every credential field with a value is listed by key only (including the non-password "username").
  assert.deepEqual(integration.secretKeys, ['username', 'applicationPassword']);
  assert.match(integration.webhookSecret ?? '', WEBHOOK_SECRET);
  assert.equal(integration.lastSync, null);
  assert.equal(integration.lastError, SAVED_MESSAGE);
  assert.equal(integration.createdAt, integration.updatedAt);
  assert.deepEqual(Object.keys(integration).sort(), [
    'capabilities', 'clientId', 'config', 'createdAt', 'id', 'isActive', 'label', 'lastError', 'lastSync', 'provider', 'secretKeys', 'status', 'updatedAt', 'webhookSecret',
  ]);
  assert.ok(!JSON.stringify(integration).includes(secret));
  assert.ok(!JSON.stringify(integration).includes('api-user'));
});

test('integrations without the leads capability get no webhook secret', async () => {
  const { saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const ga4 = saveClientIntegration({ clientId: client.id, provider: 'ga4', config: { propertyId: ' 123456 ' } });
  assert.ok(ga4);
  assert.equal(ga4.webhookSecret, null);
  assert.equal(ga4.label, 'Google Analytics 4 · 123456');
  assert.equal(ga4.config.propertyId, '123456');
  assert.deepEqual(ga4.secretKeys, []);
  assert.equal(ga4.status, 'pending');
  assert.equal(ga4.lastError, SAVED_MESSAGE);

  const ads = saveClientIntegration({ clientId: client.id, provider: 'google_ads', config: { customerId: '1234567890' } });
  assert.equal(ads?.label, 'Google Ads · 1234567890');
  assert.equal(ads?.webhookSecret, null);
});

test('saveClientIntegration reports missing required fields in catalog order and keeps the generic label', async () => {
  const { saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const empty = saveClientIntegration({ clientId: client.id, provider: 'wordpress' });
  assert.ok(empty);
  assert.equal(empty.label, 'WordPress');
  assert.equal(empty.status, 'pending');
  assert.equal(empty.lastError, 'Faltan campos obligatorios: URL del sitio, Usuario, Application Password');
  assert.deepEqual(empty.secretKeys, []);

  const partial = saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { siteUrl: 'https://partial.example.test' } });
  assert.equal(partial?.id, empty.id);
  assert.equal(partial?.lastError, 'Faltan campos obligatorios: Usuario, Application Password');
});

test('saveClientIntegration upserts per (client, provider), merging config and credentials and keeping the webhook secret', async () => {
  const { getIntegrationCredentialsById, listClientIntegrations, saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const first = await makeWordpress(client.id, { credentials: { applicationPassword: 'pw-one' } });

  const second = saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { leadSource: 'Contact Form' } });
  assert.ok(second);
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(second.updatedAt >= first.updatedAt);
  assert.equal(second.webhookSecret, first.webhookSecret);
  assert.equal(second.config.leadSource, 'Contact Form');
  assert.equal(second.config.siteUrl, first.config.siteUrl);
  assert.deepEqual(second.secretKeys, ['username', 'applicationPassword']);
  assert.equal(listClientIntegrations(client.id).length, 1);
  assert.deepEqual(getIntegrationCredentialsById(first.id), { username: 'api-user', applicationPassword: 'pw-one' });

  // Providing a new credential replaces only that field.
  saveClientIntegration({ clientId: client.id, provider: 'wordpress', credentials: { applicationPassword: 'pw-two' } });
  assert.deepEqual(getIntegrationCredentialsById(first.id), { username: 'api-user', applicationPassword: 'pw-two' });

  // KNOWN BUG: an explicit empty string or undefined for a credential clears it (only an omitted key preserves it).
  const cleared = saveClientIntegration({ clientId: client.id, provider: 'wordpress', credentials: { applicationPassword: '' } });
  assert.deepEqual(cleared?.secretKeys, ['username']);
  assert.equal(cleared?.lastError, 'Faltan campos obligatorios: Application Password');
  saveClientIntegration({ clientId: client.id, provider: 'wordpress', credentials: { applicationPassword: 'pw-three' } });
  const clearedByUndefined = saveClientIntegration({ clientId: client.id, provider: 'wordpress', credentials: { applicationPassword: undefined } });
  assert.deepEqual(clearedByUndefined?.secretKeys, ['username']);
});

test('saveClientIntegration with an id updates that row and ignores the clientId/provider of the input', async () => {
  const { saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const other = await makeClient('Other');
  const wp = await makeWordpress(client.id);

  const updated = saveClientIntegration({ id: wp.id, clientId: other.id, provider: 'ga4', config: { leadSource: 'Via id' } });
  assert.ok(updated);
  assert.equal(updated.id, wp.id);
  assert.equal(updated.clientId, client.id);
  assert.equal(updated.provider, 'wordpress');
  assert.equal(updated.config.leadSource, 'Via id');
});

test('integration labels: explicit label wins, null keeps the stored one, empty string regenerates it', async () => {
  const { saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id, { config: { siteUrl: 'https://label.example.test' } });
  assert.equal(wp.label, 'WordPress · label.example.test');

  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress', label: '  Mi WP  ' })?.label, 'Mi WP');
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress' })?.label, 'Mi WP');
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress', label: null })?.label, 'Mi WP');
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress', label: '' })?.label, 'WordPress · label.example.test');
});

test('saveClientIntegration returns null for unknown clients and throws UserFacingError for invalid providers and values', async () => {
  const { listClientIntegrations, saveClientIntegration } = await loadDatabase();
  assert.equal(saveClientIntegration({ clientId: MISSING_ID, provider: 'wordpress' }), null);
  // The client lookup happens before the provider lookup.
  assert.equal(saveClientIntegration({ clientId: MISSING_ID, provider: 'nope' as never }), null);

  const client = await makeClient();
  assert.throws(
    () => saveClientIntegration({ clientId: client.id, provider: 'nope' as never }),
    (error: unknown) => error instanceof UserFacingError && error.message === 'Proveedor de integración no soportado: nope',
  );
  assert.throws(
    () => saveClientIntegration({ clientId: client.id, provider: 'ga4', config: { propertyId: 'abc' } }),
    (error: unknown) => error instanceof UserFacingError && error.message === 'El Property ID de GA4 debe ser numérico',
  );
  assert.throws(
    () => saveClientIntegration({ clientId: client.id, provider: 'google_ads', config: { customerId: '123-456-7890' } }),
    (error: unknown) => error instanceof UserFacingError && error.message === 'El Customer ID de Google Ads debe ser numérico, sin guiones',
  );
  assert.throws(
    () => saveClientIntegration({ clientId: client.id, provider: 'woocommerce', config: { storeUrl: 'https://shop.example.test', refundPolicy: 'bogus' } }),
    (error: unknown) => error instanceof UserFacingError && error.message === 'Política de reembolsos WooCommerce inválida',
  );
  // Validation failures write nothing.
  assert.deepEqual(listClientIntegrations(client.id), []);
});

test('integration config and credentials are coerced to trimmed strings and stored as plain JSON', async () => {
  const { getIntegrationCredentialsById, saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const integration = saveClientIntegration({
    clientId: client.id,
    provider: 'wordpress',
    config: { siteUrl: '  https://coerce.example.test  ', leadSource: 42, leadFormPath: { not: 'a string' } },
    credentials: { username: '  spaced-user  ', applicationPassword: 12345 },
  });
  assert.ok(integration);
  assert.equal(integration.config.siteUrl, 'https://coerce.example.test');
  assert.equal(integration.config.leadSource, '42');
  // Non-scalar values become '' and then fall back to the field default.
  assert.equal(integration.config.leadFormPath, '/contacto');
  assert.deepEqual(getIntegrationCredentialsById(integration.id), { username: 'spaced-user', applicationPassword: '12345' });
  assert.equal(getIntegrationCredentialsById(MISSING_ID), null);
  assert.equal(getIntegrationCredentialsById(`x' OR '1'='1`), null);
});

test('integration config and credentials round-trip quotes, backslashes and unicode', async () => {
  const { getIntegrationById, getIntegrationCredentialsById, saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const siteUrl = `https://exa'mple.test/a?b=c&d=e\\f/日本/🚀`;
  const password = `pw'"\\ ?@x $1 -- ; DROP TABLE integrations`;
  const integration = saveClientIntegration({
    clientId: client.id,
    provider: 'wordpress',
    config: { siteUrl, leadSource: `O'Brien "Forms" \\ Ñ` },
    credentials: { username: `us'er`, applicationPassword: password },
  });
  assert.ok(integration);
  const reloaded = getIntegrationById(integration.id);
  assert.equal(reloaded?.config.siteUrl, siteUrl);
  assert.equal(reloaded?.config.leadSource, `O'Brien "Forms" \\ Ñ`);
  assert.deepEqual(getIntegrationCredentialsById(integration.id), { username: `us'er`, applicationPassword: password });
});

test('listClientIntegrations orders by updated_at desc and the summary variant adds the capability text', async () => {
  const { getClientIntegrations, getClientIntegrationsSummary, listClientIntegrations, saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const ga4 = saveClientIntegration({ clientId: client.id, provider: 'ga4', config: { propertyId: '999' } });
  assert.ok(ga4);

  assert.deepEqual(listClientIntegrations(client.id).map((row) => row.id), [ga4.id, wp.id]);
  saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { leadSource: 'bump' } });
  assert.deepEqual(listClientIntegrations(client.id).map((row) => row.id), [wp.id, ga4.id]);
  assert.deepEqual(listClientIntegrations(MISSING_ID), []);

  const summary = getClientIntegrationsSummary(client.id);
  assert.deepEqual(summary.map((row) => [row.id, row.summary]), [[wp.id, 'Leads'], [ga4.id, 'Tráfico']]);
  assert.deepEqual(getClientIntegrations(client.id), listClientIntegrations(client.id));
});

test('integration alias exports delegate to the primary functions', async () => {
  const {
    createOrUpdateClientIntegration, inspectClientIntegration, listIntegrationsForClient, removeClientIntegration, testClientIntegration,
    testIntegrationById, upsertClientIntegration, getClientByIdLoose, getClientByIdStrict,
  } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);

  assert.equal(upsertClientIntegration({ clientId: client.id, provider: 'wordpress' })?.id, wp.id);
  assert.equal(createOrUpdateClientIntegration({ clientId: client.id, provider: 'wordpress' })?.id, wp.id);
  assert.deepEqual(listIntegrationsForClient(client.id).map((row) => row.id), [wp.id]);
  assert.equal(inspectClientIntegration(wp.id)?.ready, true);
  assert.equal(testIntegrationById(wp.id)?.ready, true);
  assert.equal(testClientIntegration(wp.id)?.ready, true);
  assert.equal((await getClientByIdStrict(client.id))?.id, client.id);
  assert.equal((await getClientByIdLoose(client.slug))?.id, client.id);
  assert.equal(removeClientIntegration(wp.id), true);
  assert.equal(removeClientIntegration(wp.id), false);
});

// ---------------------------------------------------------------- integrations: state

test('setClientIntegrationActive toggles isActive and status; disabled integrations are not found by webhook secret', async () => {
  const { getIntegrationByWebhookSecret, saveClientIntegration, setClientIntegrationActive } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const secret = wp.webhookSecret!;
  assert.equal(getIntegrationByWebhookSecret(secret)?.id, wp.id);

  const disabled = setClientIntegrationActive(wp.id, false);
  assert.equal(disabled?.isActive, false);
  assert.equal(disabled?.status, 'disabled');
  assert.equal(disabled?.lastError, null);
  assert.equal(getIntegrationByWebhookSecret(secret), null);

  // Saving a disabled integration keeps it disabled and inactive even when the config changes; lastError still follows the save state.
  const resaved = saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { leadSource: 'while disabled' } });
  assert.equal(resaved?.isActive, false);
  assert.equal(resaved?.status, 'disabled');
  assert.equal(resaved?.lastError, SAVED_MESSAGE);
  assert.equal(getIntegrationByWebhookSecret(secret), null);

  const enabled = setClientIntegrationActive(wp.id, true);
  assert.equal(enabled?.isActive, true);
  assert.equal(enabled?.status, 'pending');
  assert.equal(enabled?.lastError, null);
  assert.equal(getIntegrationByWebhookSecret(secret)?.id, wp.id);

  assert.equal(setClientIntegrationActive(MISSING_ID, true), null);
});

test('getIntegrationByWebhookSecret rejects empty, unknown and injection-style secrets', async () => {
  const { getIntegrationByWebhookSecret } = await loadDatabase();
  assert.equal(getIntegrationByWebhookSecret(''), null);
  assert.equal(getIntegrationByWebhookSecret('0'.repeat(48)), null);
  assert.equal(getIntegrationByWebhookSecret(`x' OR '1'='1`), null);
});

test('rotateClientIntegrationWebhook replaces the secret for WordPress only', async () => {
  const { getIntegrationByWebhookSecret, rotateClientIntegrationWebhook, saveClientIntegration } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const oldSecret = wp.webhookSecret!;

  const rotated = rotateClientIntegrationWebhook(wp.id);
  assert.ok(rotated);
  assert.match(rotated.webhookSecret ?? '', WEBHOOK_SECRET);
  assert.notEqual(rotated.webhookSecret, oldSecret);
  assert.ok(rotated.updatedAt >= wp.updatedAt);
  assert.equal(getIntegrationByWebhookSecret(oldSecret), null);
  assert.equal(getIntegrationByWebhookSecret(rotated.webhookSecret!)?.id, wp.id);

  const ga4 = saveClientIntegration({ clientId: client.id, provider: 'ga4', config: { propertyId: '1' } });
  assert.ok(ga4);
  assert.equal(rotateClientIntegrationWebhook(ga4.id), null);
  assert.equal(rotateClientIntegrationWebhook(MISSING_ID), null);
});

test('setClientIntegrationStatus updates only active integrations and keeps lastSync when omitted', async () => {
  const { saveClientIntegration, setClientIntegrationActive, setClientIntegrationStatus } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const syncedAt = '2030-05-01T10:00:00.000Z';

  const connected = setClientIntegrationStatus(wp.id, 'connected', null, syncedAt);
  assert.equal(connected?.status, 'connected');
  assert.equal(connected?.lastSync, syncedAt);
  assert.equal(connected?.lastError, null);

  const failed = setClientIntegrationStatus(wp.id, 'error', 'boom \'quoted\' "x"');
  assert.equal(failed?.status, 'error');
  assert.equal(failed?.lastError, 'boom \'quoted\' "x"');
  assert.equal(failed?.lastSync, syncedAt);

  // Re-saving an unchanged configuration keeps a live provider connected or in error; a config change resets it to pending.
  setClientIntegrationStatus(wp.id, 'connected', null);
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress' })?.status, 'connected');
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress' })?.lastError, null);
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { leadSource: 'changed' } })?.status, 'pending');
  setClientIntegrationStatus(wp.id, 'error', 'still broken');
  assert.equal(saveClientIntegration({ clientId: client.id, provider: 'wordpress' })?.lastError, 'still broken');

  // Disabled integrations are not touched (the UPDATE has AND is_active = 1) but the current row is returned.
  setClientIntegrationActive(wp.id, false);
  const untouched = setClientIntegrationStatus(wp.id, 'connected', null);
  assert.equal(untouched?.status, 'disabled');
  assert.equal(setClientIntegrationStatus(MISSING_ID, 'connected'), null);
});

test('providers without a live adapter never show as connected and hide lastSync', async () => {
  const { saveClientIntegration, setClientIntegrationStatus } = await loadDatabase();
  const client = await makeClient();
  const woo = saveClientIntegration({
    clientId: client.id,
    provider: 'woocommerce',
    config: { storeUrl: 'https://shop.example.test' },
    credentials: { consumerKey: 'ck_x', consumerSecret: 'cs_x' },
  });
  assert.ok(woo);
  assert.equal(woo.label, 'WooCommerce · shop.example.test');
  assert.equal(woo.config.refundPolicy, 'subtract');
  assert.equal(woo.config.currency, 'EUR');
  assert.equal(woo.status, 'pending');
  assert.equal(woo.lastError, 'No hay un adaptador de conexión/sincronización real para este proveedor todavía.');
  assert.equal(woo.webhookSecret, null);

  const forced = setClientIntegrationStatus(woo.id, 'connected', null, '2030-05-01T10:00:00.000Z');
  assert.equal(forced?.status, 'pending');
  assert.equal(forced?.lastSync, null);
  assert.equal(forced?.lastError, 'Este proveedor todavía no tiene un adaptador real de conexión/sincronización.');
});

test('testClientIntegration validates required fields, resets status to pending and describes capabilities', async () => {
  const { saveClientIntegration, setClientIntegrationActive, setClientIntegrationStatus, testClientIntegration } = await loadDatabase();
  const client = await makeClient();
  assert.equal(testClientIntegration(MISSING_ID), null);

  const incomplete = saveClientIntegration({ clientId: client.id, provider: 'wordpress', config: { siteUrl: 'https://test.example.test' } });
  assert.ok(incomplete);
  const missing = testClientIntegration(incomplete.id);
  assert.ok(missing);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingFields, ['Usuario', 'Application Password']);
  assert.equal(missing.summary, 'Leads');
  assert.equal(missing.integration.lastError, 'Faltan campos obligatorios: Usuario, Application Password');

  saveClientIntegration({ clientId: client.id, provider: 'wordpress', credentials: { username: 'u', applicationPassword: 'p' } });
  setClientIntegrationStatus(incomplete.id, 'connected', null);
  const complete = testClientIntegration(incomplete.id);
  assert.equal(complete?.ready, true);
  assert.deepEqual(complete?.missingFields, []);
  assert.equal(complete?.integration.status, 'pending');
  assert.equal(complete?.integration.lastError, 'Configuración completa; falta una prueba o sincronización real.');
  assert.deepEqual(Object.keys(complete!).sort(), ['integration', 'missingFields', 'ready', 'summary']);

  const woo = saveClientIntegration({
    clientId: client.id,
    provider: 'woocommerce',
    config: { storeUrl: 'https://shop.example.test' },
    credentials: { consumerKey: 'ck_x', consumerSecret: 'cs_x' },
  });
  assert.ok(woo);
  const wooResult = testClientIntegration(woo.id);
  assert.equal(wooResult?.ready, true);
  assert.equal(wooResult?.summary, 'Ventas');
  assert.equal(wooResult?.integration.lastError, 'La configuración está completa, pero este proveedor todavía no dispone de una prueba/sincronización real.');

  // KNOWN BUG: testing a disabled integration flips its status to pending while isActive stays false.
  setClientIntegrationActive(incomplete.id, false);
  const disabledResult = testClientIntegration(incomplete.id);
  assert.equal(disabledResult?.integration.isActive, false);
  assert.equal(disabledResult?.integration.status, 'pending');
});

test('deleteClientIntegration reports presence and is idempotent', async () => {
  const { deleteClientIntegration, getIntegrationById } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  assert.equal(getIntegrationById(wp.id)?.id, wp.id);
  assert.equal(deleteClientIntegration(wp.id), true);
  assert.equal(getIntegrationById(wp.id), null);
  assert.equal(deleteClientIntegration(wp.id), false);
  assert.equal(deleteClientIntegration(MISSING_ID), false);
});

// ---------------------------------------------------------------- leads: insertLead

test('insertLead trims fields, turns blanks into null, defaults the source and returns the stored lead with its raw payload', async () => {
  const { insertLead } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const rawPayload = { count: 1, flag: true, nested: { list: [1, 2, { deep: null }] }, text: `it's "q" \\ 日本 🚀`, empty: '' };

  const { lead, duplicate } = insertLead(leadInput(client.id, wp.id, {
    source: '  Contact Form  ', name: '  Ana  ', email: ' ana@example.test ', phone: '   ', message: '', rawPayload, dedupeKey: 'delivery-1',
  }));

  assert.equal(duplicate, false);
  assert.equal(lead.clientId, client.id);
  assert.equal(lead.integrationId, wp.id);
  assert.equal(lead.source, 'Contact Form');
  assert.equal(lead.name, 'Ana');
  assert.equal(lead.email, 'ana@example.test');
  assert.equal(lead.phone, null);
  assert.equal(lead.message, null);
  assert.equal(lead.status, 'new');
  assert.deepEqual(lead.rawPayload, rawPayload);
  assert.equal(lead.createdAt, lead.receivedAt);
  assert.equal(lead.updatedAt, lead.receivedAt);
  assert.ok(!Number.isNaN(Date.parse(lead.receivedAt)));
  assert.deepEqual(Object.keys(lead).sort(), [
    'clientId', 'createdAt', 'email', 'id', 'integrationId', 'message', 'name', 'phone', 'rawPayload', 'receivedAt', 'source', 'status', 'updatedAt',
  ]);

  const blankSource = insertLead(leadInput(client.id, wp.id, { source: '   ' }));
  assert.equal(blankSource.lead.source, 'wordpress');
  const nullPayload = insertLead(leadInput(client.id, null, { rawPayload: null }));
  assert.deepEqual(nullPayload.lead.rawPayload, {});
  assert.equal(nullPayload.lead.integrationId, null);
});

test('insertLead round-trips quotes, newlines, backslashes and SQL-looking text', async () => {
  const { insertLead } = await loadDatabase();
  const client = await makeClient();
  const message = `Hola, soy O'Brien.\n"Quiero" info \\ por favor -- ; DROP TABLE leads; ?@name $1 日本語 🚀\tTab`;
  const { lead } = insertLead(leadInput(client.id, null, { name: `Zoë O'Neil`, message }));
  assert.equal(lead.name, `Zoë O'Neil`);
  assert.equal(lead.message, message);
});

test('insertLead is idempotent per (integration, dedupeKey) and returns the original lead for duplicates', async () => {
  const { insertLead, listLeadsByClient } = await loadDatabase();
  const client = await makeClient();
  const otherClient = await makeClient('Other');
  const wp = await makeWordpress(client.id);
  const otherWp = await makeWordpress(otherClient.id);

  const first = insertLead(leadInput(client.id, wp.id, { name: 'First', dedupeKey: 'same-delivery' }));
  const second = insertLead(leadInput(client.id, wp.id, { name: 'Second', dedupeKey: 'same-delivery' }));
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.lead.id, first.lead.id);
  assert.equal(second.lead.name, 'First');
  assert.equal(listLeadsByClient(client.id, { limit: 50, offset: 0, status: null, source: null }).total, 1);

  // A different key, a different integration, or no key at all create new leads.
  assert.equal(insertLead(leadInput(client.id, wp.id, { dedupeKey: 'other-delivery' })).duplicate, false);
  assert.equal(insertLead(leadInput(otherClient.id, otherWp.id, { dedupeKey: 'same-delivery' })).duplicate, false);
  const noKeyA = insertLead(leadInput(client.id, wp.id));
  const noKeyB = insertLead(leadInput(client.id, wp.id));
  assert.equal(noKeyA.duplicate, false);
  assert.equal(noKeyB.duplicate, false);
  assert.notEqual(noKeyA.lead.id, noKeyB.lead.id);

  // Without an integration the unique index never matches (NULLs are distinct), so a key does not deduplicate.
  const orphanA = insertLead(leadInput(client.id, null, { dedupeKey: 'no-integration' }));
  const orphanB = insertLead(leadInput(client.id, null, { dedupeKey: 'no-integration' }));
  assert.equal(orphanA.duplicate, false);
  assert.equal(orphanB.duplicate, false);
  assert.notEqual(orphanA.lead.id, orphanB.lead.id);
});

test('insertLead with an empty-string dedupeKey throws on the second delivery', async () => {
  const { insertLead } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  assert.equal(insertLead(leadInput(client.id, wp.id, { dedupeKey: '' })).duplicate, false);
  // KNOWN BUG: '' is stored (the partial index only excludes NULL) but the duplicate branch treats it as "no key" and throws.
  assert.throws(() => insertLead(leadInput(client.id, wp.id, { dedupeKey: '' })), /No se pudo guardar el lead/);
});

test('insertLead rejects unknown clients and integrations with foreign-key errors', async () => {
  const { insertLead } = await loadDatabase();
  const client = await makeClient();
  assert.throws(() => insertLead(leadInput(MISSING_ID, null)), /foreign key/i);
  assert.throws(() => insertLead(leadInput(client.id, MISSING_ID)), /foreign key/i);
});

test('deleting an integration keeps its leads and nulls their integrationId', async () => {
  const { deleteClientIntegration, insertLead, listLeadsByClient } = await loadDatabase();
  const client = await makeClient();
  const wp = await makeWordpress(client.id);
  const { lead } = insertLead(leadInput(client.id, wp.id));
  assert.equal(deleteClientIntegration(wp.id), true);
  const page = listLeadsByClient(client.id, { limit: 10, offset: 0, status: null, source: null });
  assert.deepEqual(page.leads.map((row) => [row.id, row.integrationId]), [[lead.id, null]]);
});

// ---------------------------------------------------------------- leads: listLeadsByClient

async function seedLeads() {
  const { getDatabase, insertLead } = await loadDatabase();
  const client = await makeClient('Lead list');
  const wp = await makeWordpress(client.id);
  // [name, source, status]; received_at is forced to a distinct, increasing timestamp so the ordering is deterministic.
  const plan: Array<[string, string, string]> = [
    ['L0', 'wordpress', 'new'],
    ['L1', 'Facebook', 'new'],
    ['L2', 'wordpress', 'in_progress'],
    ['L3', 'wordpress', 'closed'],
    ['L4', 'Facebook', 'lost'],
    ['L5', 'wordpress', 'new'],
  ];
  const ids: string[] = [];
  plan.forEach(([name, source, status], index) => {
    const { lead } = insertLead(leadInput(client.id, wp.id, { name, source, message: `msg ${name}`, rawPayload: { secret: `hidden-${name}` } }));
    getDatabase().prepare(`UPDATE leads SET status = ?, received_at = ? WHERE id = ?`).run(status, `2030-01-01T00:00:0${index}.000Z`, lead.id);
    ids.push(lead.id);
  });
  return { client, ids };
}

test('listLeadsByClient returns the page shape, newest first, without the raw payload', async () => {
  const { listLeadsByClient } = await loadDatabase();
  const { client } = await seedLeads();

  const page = listLeadsByClient(client.id, { limit: 100, offset: 0, status: null, source: null });
  assert.deepEqual(Object.keys(page).sort(), ['leads', 'limit', 'offset', 'openCount', 'resolvedCount', 'total']);
  assert.deepEqual(page.leads.map((lead) => lead.name), ['L5', 'L4', 'L3', 'L2', 'L1', 'L0']);
  assert.equal(page.total, 6);
  assert.equal(page.openCount, 4); // new x3 + in_progress x1
  assert.equal(page.resolvedCount, 2); // closed + lost
  assert.equal(page.limit, 100);
  assert.equal(page.offset, 0);
  for (const lead of page.leads) {
    assert.ok(!('rawPayload' in lead));
    assert.ok(!JSON.stringify(lead).includes('hidden-'));
    assert.deepEqual(Object.keys(lead).sort(), [
      'clientId', 'createdAt', 'email', 'id', 'integrationId', 'message', 'name', 'phone', 'receivedAt', 'source', 'status', 'updatedAt',
    ]);
  }
  assert.equal(page.leads[0]?.receivedAt, '2030-01-01T00:00:05.000Z');
});

test('listLeadsByClient paginates with limit/offset while totals stay constant', async () => {
  const { listLeadsByClient } = await loadDatabase();
  const { client } = await seedLeads();
  const query = (limit: number, offset: number) => listLeadsByClient(client.id, { limit, offset, status: null, source: null });

  assert.deepEqual(query(2, 0).leads.map((lead) => lead.name), ['L5', 'L4']);
  assert.deepEqual(query(2, 2).leads.map((lead) => lead.name), ['L3', 'L2']);
  assert.deepEqual(query(2, 4).leads.map((lead) => lead.name), ['L1', 'L0']);
  assert.deepEqual(query(2, 5).leads.map((lead) => lead.name), ['L0']);
  assert.deepEqual(query(2, 6).leads, []);
  assert.deepEqual(query(0, 0).leads, []);
  for (const page of [query(2, 0), query(2, 6), query(0, 0)]) {
    assert.equal(page.total, 6);
    assert.equal(page.openCount, 4);
    assert.equal(page.resolvedCount, 2);
  }
  assert.equal(query(2, 6).offset, 6);
  assert.equal(query(0, 0).limit, 0);

  // Negative values reach PostgreSQL unchecked at this layer.
  assert.throws(() => query(2, -1), /must not be negative/i);
  assert.throws(() => query(-1, 0), /must not be negative/i);
});

test('listLeadsByClient filters by status and source (exact, case-sensitive) and recomputes the counters', async () => {
  const { listLeadsByClient } = await loadDatabase();
  const { client } = await seedLeads();
  const query = (status: string | null, source: string | null) => listLeadsByClient(client.id, { limit: 100, offset: 0, status, source });

  const fresh = query('new', null);
  assert.deepEqual(fresh.leads.map((lead) => lead.name), ['L5', 'L1', 'L0']);
  assert.deepEqual([fresh.total, fresh.openCount, fresh.resolvedCount], [3, 3, 0]);

  const closed = query('closed', null);
  assert.deepEqual(closed.leads.map((lead) => lead.name), ['L3']);
  assert.deepEqual([closed.total, closed.openCount, closed.resolvedCount], [1, 0, 1]);

  const facebook = query(null, 'Facebook');
  assert.deepEqual(facebook.leads.map((lead) => lead.name), ['L4', 'L1']);
  assert.deepEqual([facebook.total, facebook.openCount, facebook.resolvedCount], [2, 1, 1]);

  const both = query('lost', 'Facebook');
  assert.deepEqual(both.leads.map((lead) => lead.name), ['L4']);
  assert.deepEqual([both.total, both.openCount, both.resolvedCount], [1, 0, 1]);

  // No match: empty page and zeroed counters (SUM over no rows is NULL and is coerced to 0).
  for (const none of [query(null, 'facebook'), query('bogus', null), query('new', 'Facebook-x'), query(null, `x' OR '1'='1`)]) {
    assert.deepEqual(none.leads, []);
    assert.deepEqual([none.total, none.openCount, none.resolvedCount], [0, 0, 0]);
  }

  // Empty strings are falsy, so they apply no filter.
  assert.equal(query('', '').total, 6);
});

test('listLeadsByClient is scoped to one client and handles clients without leads', async () => {
  const { insertLead, listLeadsByClient } = await loadDatabase();
  const { client } = await seedLeads();
  const other = await makeClient('Lead other');
  insertLead(leadInput(other.id, null, { name: 'Other lead' }));

  assert.deepEqual(
    listLeadsByClient(other.id, { limit: 10, offset: 0, status: null, source: null }).leads.map((lead) => lead.name),
    ['Other lead'],
  );
  assert.equal(listLeadsByClient(client.id, { limit: 10, offset: 0, status: null, source: null }).total, 6);

  const none = listLeadsByClient(MISSING_ID, { limit: 10, offset: 0, status: null, source: null });
  assert.deepEqual(none, { leads: [], total: 0, openCount: 0, resolvedCount: 0, limit: 10, offset: 0 });
});
