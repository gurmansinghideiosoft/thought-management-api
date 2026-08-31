import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';

import config from '../config/index.ts';
import { AppError } from '../errors.ts';

/**
 * 404 handler.
 *
 * Runs after every route. If we reached it, nothing matched, so we build a
 * not-found error and pass it to the error handler below.
 */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

interface NormalizedError {
  status: number;
  message: string;
  /** Field-level validation problems, when we have them. */
  details?: unknown;
}

/**
 * Turn any thrown value into a status + client-safe message. Library errors
 * (Zod, Mongoose, Multer) are translated here so route handlers can just
 * `throw` and stay clean.
 */
const normalize = (err: unknown): NormalizedError => {
  if (err instanceof AppError) {
    return { status: err.status, message: err.message };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      message: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  if (err instanceof MongooseError.ValidationError) {
    return {
      status: 400,
      message: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({
        path: e.path,
        message: e.message,
      })),
    };
  }

  if (err instanceof MongooseError.CastError) {
    return { status: 400, message: `Invalid value for "${err.path}"` };
  }

  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return { status, message: err.message };
  }

  // Duplicate key from a unique index.
  if (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 11000
  ) {
    return { status: 409, message: 'Resource already exists' };
  }

  if (
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { status?: unknown }).status === 'number'
  ) {
    const status = (err as { status: number }).status;
    const message = err instanceof Error ? err.message : 'Error';
    return { status, message };
  }

  return {
    status: 500,
    message: err instanceof Error ? err.message : 'Unknown error',
  };
};

/**
 * Central error handler.
 *
 * Express identifies an error handler purely by its arity — it MUST declare
 * four parameters, so `_next` stays even though it is unused. Every `next(err)`
 * call and (in Express 5) every rejected async handler ends up here.
 *
 *  - 5xx: log the full error; never leak its message/stack in production.
 *  - 4xx: client's problem — echo the message, no logging.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, message, details } = normalize(err);

  if (status >= 500) {
    console.error(err);
  }

  const safeMessage =
    status >= 500 && config.isProduction ? 'Internal Server Error' : message;

  const body: {
    error: { message: string; details?: unknown; stack?: string };
  } = { error: { message: safeMessage } };

  if (details !== undefined) {
    body.error.details = details;
  }
  if (!config.isProduction && err instanceof Error && err.stack !== undefined) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
};
