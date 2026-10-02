import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverReportEmail } from '../src/lib/reportEmail.js';

// Delivery failures go to the structured logger; tests inject a fake one to inspect the event.
function fakeLog() {
  const entries: Array<{ fields: unknown; message: string }> = [];
  return { entries, log: { error: ((fields: unknown, message: string) => { entries.push({ fields, message }); }) as never } };
}

const input = { recipient: 'cliente@example.com', clientName: 'Acme', from: '2026-09-01', to: '2026-09-30', pdf: Buffer.from('pdf') };

test('a failing SMTP transport is logged with its cause and reported as delivery unknown', async () => {
  const { entries, log } = fakeLog();
  const recorded: Array<string | null> = [];
  const cause = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });

  const result = await deliverReportEmail(input, {
    send: async () => { throw cause; },
    record: (failure) => { recorded.push(failure); },
    context: { clientId: 'client-a', runId: 'run-1' },
    log,
  });

  assert.deepEqual(result, { ok: false, status: 502, code: 'SMTP_DELIVERY_UNKNOWN', message: 'No se pudo confirmar la entrega SMTP; revisa el buzón antes de repetir' });
  assert.deepEqual(recorded, ['Entrega no confirmada']);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'report email delivery failed');
  const logged = JSON.stringify(entries[0].fields);
  assert.match(logged, /ETIMEDOUT/);
  assert.match(logged, /Connection timeout/);
  assert.match(logged, /run-1/);
  assert.doesNotMatch(logged, /cliente@example\.com/);
});

test('a successful SMTP delivery records no failure and logs nothing', async () => {
  const { entries, log } = fakeLog();
  const recorded: Array<string | null> = [];
  const result = await deliverReportEmail(input, { send: async () => undefined, record: (failure) => { recorded.push(failure); }, context: { clientId: 'c', runId: 'r' }, log });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(recorded, [null]);
  assert.equal(entries.length, 0);
});
