import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from './password.ts';

test('hashPassword produces a verifiable argon2id hash', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
});

test('verifyPassword rejects the wrong password', async () => {
  const hash = await hashPassword('right');
  assert.equal(await verifyPassword(hash, 'wrong'), false);
});

test('verifyPassword returns false (never throws) for a malformed hash', async () => {
  assert.equal(await verifyPassword('not-a-hash', 'anything'), false);
});
