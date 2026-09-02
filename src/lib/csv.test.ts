import assert from 'node:assert/strict';
import test from 'node:test';

import { toCsv } from './csv.ts';

test('the header row uses the given column order', () => {
  assert.equal(toCsv([], ['b', 'a']), 'b,a');
});

test('one CRLF-terminated line per record, columns in order', () => {
  const csv = toCsv(
    [
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ],
    ['a', 'b'],
  );
  assert.equal(csv, 'a,b\r\n1,x\r\n2,y');
});

test('fields with comma, quote or newline are quoted (quotes doubled)', () => {
  const csv = toCsv(
    [{ a: 'has,comma', b: 'has"quote', c: 'two\nlines' }],
    ['a', 'b', 'c'],
  );
  assert.equal(csv, 'a,b,c\r\n"has,comma","has""quote","two\nlines"');
});

test('null and undefined become empty cells; 0 does not', () => {
  assert.equal(toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']), 'a,b,c\r\n,,0');
});

test('Date renders as an ISO string', () => {
  const d = new Date('2026-09-02T10:00:00.000Z');
  assert.equal(toCsv([{ d }], ['d']), 'd\r\n2026-09-02T10:00:00.000Z');
});

test('missing keys are blank; booleans stringify', () => {
  assert.equal(toCsv([{ a: true }], ['a', 'b']), 'a,b\r\ntrue,');
});
