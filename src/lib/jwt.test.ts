import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../errors.ts';
import { signAccess, signRefresh, verifyAccess, verifyRefresh } from './jwt.ts';

test('a signed access token verifies and carries sub + jti', () => {
  const { token, jti } = signAccess('user-123');
  const claims = verifyAccess(token);
  assert.equal(claims.sub, 'user-123');
  assert.equal(claims.jti, jti);
  assert.ok(claims.exp > claims.iat);
});

test('access and refresh secrets are not interchangeable', () => {
  const { token } = signAccess('u1');
  assert.throws(
    () => verifyRefresh(token),
    (e: unknown) => e instanceof AppError,
  );
});

test('verify rejects garbage with a 401 AppError', () => {
  assert.throws(
    () => verifyAccess('not.a.jwt'),
    (e: unknown) => e instanceof AppError && e.status === 401,
  );
});

test('refresh tokens round-trip too', () => {
  const { token, jti } = signRefresh('user-9');
  const claims = verifyRefresh(token);
  assert.equal(claims.sub, 'user-9');
  assert.equal(claims.jti, jti);
});
