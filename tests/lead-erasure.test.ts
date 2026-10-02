import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EraseArgsError,
  eraseLeadsByEmail,
  findLeadIdsByEmail,
  hashEmailForLog,
  normalizeErasureEmail,
  parseEraseArgs,
} from '../src/lib/leadErasure.js';

test('parseEraseArgs reads email, optional client, note and apply; dry-run is the default', () => {
  assert.deepEqual(parseEraseArgs(['--email=Ana@Example.com']), { email: 'ana@example.com', clientId: null, apply: false, note: '' });
  assert.deepEqual(
    parseEraseArgs(['--email=ana@example.com', '--client=abc-1', '--apply', '--note=Solicitud 2026-10-02']),
    { email: 'ana@example.com', clientId: 'abc-1', apply: true, note: 'Solicitud 2026-10-02' },
  );
});

test('parseEraseArgs rejects missing/invalid input with Spanish messages', () => {
  assert.throws(() => parseEraseArgs([]), (error) => error instanceof EraseArgsError && /--email/.test(error.message));
  assert.throws(() => parseEraseArgs(['--email=not-an-email']), EraseArgsError);
  assert.throws(() => parseEraseArgs(['--email=a@b.co', '--bogus']), (error) => error instanceof EraseArgsError && /--bogus/.test(error.message));
  assert.throws(() => parseEraseArgs(['--email=a@b.co', '--client=']), EraseArgsError);
  assert.throws(() => parseEraseArgs(['--email=a@b.co', `--note=${'x'.repeat(201)}`]), EraseArgsError);
  assert.throws(() => parseEraseArgs(['--email=a@b.co', '--apply=yes']), EraseArgsError);
  assert.equal(parseEraseArgs(['--email=a@b.co', `--note=${'x'.repeat(200)}`]).note.length, 200);
});

test('normalizeErasureEmail trims, lowercases and validates', () => {
  assert.equal(normalizeErasureEmail('  Ana@Example.COM '), 'ana@example.com');
  for (const bad of ['', 'ana', 'ana@', '@example.com', 'a b@example.com', `${'a'.repeat(250)}@example.com`]) {
    assert.equal(normalizeErasureEmail(bad), null, bad);
  }
});

test('hashEmailForLog is a short, stable, case-insensitive sha256 prefix that does not contain the email', () => {
  const hash = hashEmailForLog('Ana@Example.com');
  assert.match(hash, /^[0-9a-f]{12}$/);
  assert.equal(hash, hashEmailForLog('ana@example.com'));
  assert.notEqual(hash, hashEmailForLog('other@example.com'));
});

test('findLeadIdsByEmail and eraseLeadsByEmail use bound parameters and return ids only', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [{ id: 'l1' }, { id: 'l2' }], rowCount: 2 };
    },
  };
  assert.deepEqual(await findLeadIdsByEmail(db, 'ana@example.com', null), ['l1', 'l2']);
  assert.match(calls[0].text, /lower\(btrim\(email\)\) = \$1/);
  assert.doesNotMatch(calls[0].text, /client_id/);
  assert.deepEqual(calls[0].values, ['ana@example.com']);

  assert.deepEqual(await eraseLeadsByEmail(db, 'ana@example.com', 'c1'), ['l1', 'l2']);
  assert.match(calls[1].text, /DELETE FROM leads/);
  assert.match(calls[1].text, /client_id = \$2/);
  assert.match(calls[1].text, /RETURNING id/);
  assert.deepEqual(calls[1].values, ['ana@example.com', 'c1']);
});
