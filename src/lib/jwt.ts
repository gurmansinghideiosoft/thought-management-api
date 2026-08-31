import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import config from '../config/index.ts';
import { AppError } from '../errors.ts';

export interface TokenClaims {
  /** User id. */
  sub: string;
  /** Unique token id — the handle used for blacklisting. */
  jti: string;
  iat: number;
  exp: number;
}

type TokenKind = 'access' | 'refresh';

const secretFor = (kind: TokenKind): string =>
  kind === 'access' ? config.auth.accessSecret : config.auth.refreshSecret;

const ttlFor = (kind: TokenKind): string =>
  kind === 'access' ? config.auth.accessTtl : config.auth.refreshTtl;

const signToken = (kind: TokenKind, userId: string): { token: string; jti: string } => {
  const jti = randomUUID();
  const options: jwt.SignOptions = {
    expiresIn: ttlFor(kind) as jwt.SignOptions['expiresIn'],
  };
  const token = jwt.sign({ sub: userId, jti }, secretFor(kind), options);
  return { token, jti };
};

export const signAccess = (userId: string): { token: string; jti: string } =>
  signToken('access', userId);

export const signRefresh = (userId: string): { token: string; jti: string } =>
  signToken('refresh', userId);

const verifyToken = (kind: TokenKind, token: string): TokenClaims => {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secretFor(kind));
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof (payload as Record<string, unknown>).sub !== 'string' ||
    typeof (payload as Record<string, unknown>).jti !== 'string'
  ) {
    throw new AppError('Invalid or expired token', 401);
  }
  return payload as TokenClaims;
};

export const verifyAccess = (token: string): TokenClaims => verifyToken('access', token);

export const verifyRefresh = (token: string): TokenClaims =>
  verifyToken('refresh', token);
