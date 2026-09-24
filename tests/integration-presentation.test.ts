import assert from 'node:assert/strict';
import test from 'node:test';
import { redactIntegrationSecrets } from '../src/lib/integrationPresentation.js';

const data = [{ id: 'i1', webhookSecret: 'bearer-secret' }];

test('viewer integration responses redact bearer webhook secrets', () => {
  assert.deepEqual(redactIntegrationSecrets(data, 'viewer'), [{ id: 'i1', webhookSecret: null }]);
});

test('admin integration responses retain provisioned webhook secrets', () => {
  assert.deepEqual(redactIntegrationSecrets(data, 'admin'), data);
});
