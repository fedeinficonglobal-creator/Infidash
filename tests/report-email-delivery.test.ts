import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { deliverReportEmail } from '../src/lib/reportEmail.js';

const originalConsoleError = console.error;
afterEach(() => { console.error = originalConsoleError; });

const input = { recipient: 'cliente@example.com', clientName: 'Acme', from: '2026-09-01', to: '2026-09-30', pdf: Buffer.from('pdf') };

test('a failing SMTP transport is logged with its cause and reported as delivery unknown', async () => {
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')); };
  const recorded: Array<string | null> = [];
  const cause = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });

  const result = await deliverReportEmail(input, {
    send: async () => { throw cause; },
    record: (failure) => { recorded.push(failure); },
    context: { clientId: 'client-a', runId: 'run-1' },
  });

  assert.deepEqual(result, { ok: false, status: 502, code: 'SMTP_DELIVERY_UNKNOWN', message: 'No se pudo confirmar la entrega SMTP; revisa el buzón antes de repetir' });
  assert.deepEqual(recorded, ['Entrega no confirmada']);
  const log = lines.join('\n');
  assert.match(log, /\[infidash\] report email delivery failed/);
  assert.match(log, /ETIMEDOUT/);
  assert.match(log, /Connection timeout/);
  assert.match(log, /run-1/);
  assert.doesNotMatch(log, /cliente@example\.com/);
});

test('a successful SMTP delivery records no failure and logs nothing', async () => {
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')); };
  const recorded: Array<string | null> = [];
  const result = await deliverReportEmail(input, { send: async () => undefined, record: (failure) => { recorded.push(failure); }, context: { clientId: 'c', runId: 'r' } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(recorded, [null]);
  assert.equal(lines.length, 0);
});
