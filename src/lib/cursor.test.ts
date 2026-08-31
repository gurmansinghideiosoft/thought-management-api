import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../errors.ts';
import { decodeCursor, encodeCursor, keysetClause, keysetSort } from './cursor.ts';

test('encodeCursor / decodeCursor round-trips a position', () => {
  const createdAt = new Date('2026-01-02T03:04:05.678Z');
  const id = '65b0c0ffee0c0ffee0c0ffee';

  const decoded = decodeCursor(encodeCursor(createdAt, id));

  assert.equal(decoded.id, id);
  assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
});

test('decodeCursor rejects malformed input with a 400', () => {
  for (const bad of [
    '',
    'not-base64!!',
    Buffer.from('{"nope":1}').toString('base64url'),
  ]) {
    assert.throws(
      () => decodeCursor(bad),
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  }
});

test('keysetClause selects strictly older rows for "before"', () => {
  const pos = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'abc' };
  const clause = keysetClause('before', pos) as { $or: Record<string, unknown>[] };

  assert.deepEqual(clause.$or[0], { createdAt: { $lt: pos.createdAt } });
  assert.deepEqual(clause.$or[1], { createdAt: pos.createdAt, _id: { $lt: 'abc' } });
});

test('keysetClause selects strictly newer rows for "after"', () => {
  const pos = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'abc' };
  const clause = keysetClause('after', pos) as { $or: Record<string, unknown>[] };

  assert.deepEqual(clause.$or[0], { createdAt: { $gt: pos.createdAt } });
});

test('keysetSort matches the direction', () => {
  assert.deepEqual(keysetSort('before'), { createdAt: -1, _id: -1 });
  assert.deepEqual(keysetSort('after'), { createdAt: 1, _id: 1 });
});
