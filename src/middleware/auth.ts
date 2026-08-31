import type { Request, RequestHandler } from 'express';

import { AppError } from '../errors.ts';
import { verifyAccess } from '../lib/jwt.ts';
import { isBlacklisted } from '../services/auth.service.ts';

/**
 * Gate for protected routes. Verifies the `Authorization: Bearer <accessToken>`
 * header, checks it hasn't been revoked, and attaches `req.auth`.
 * Express 5 forwards the thrown `AppError` to the error handler.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required', 401);
  }

  const claims = verifyAccess(token);
  if (await isBlacklisted(claims.jti)) {
    throw new AppError('Invalid or expired token', 401);
  }

  req.auth = { userId: claims.sub, jti: claims.jti, exp: claims.exp };
  next();
};

/** Read the authenticated user off a request inside a protected handler. */
export const getAuth = (req: Request): NonNullable<Request['auth']> => {
  if (!req.auth) throw new AppError('Authentication required', 401);
  return req.auth;
};
