import type { ErrorRequestHandler, RequestHandler } from 'express';

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

interface ErrorBody {
  error: {
    message: string;
    stack?: string;
  };
}

/** Pull an HTTP status off an unknown thrown value, defaulting to 500. */
const statusOf = (err: unknown): number => {
  if (err instanceof AppError) {
    return err.status;
  }
  if (err !== null && typeof err === 'object') {
    const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
    const value = status ?? statusCode;
    if (typeof value === 'number' && value >= 400 && value <= 599) {
      return value;
    }
  }
  return 500;
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
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : 'Unknown error';

  if (status >= 500) {
    console.error(err);
  }

  const body: ErrorBody = {
    error: {
      message: status >= 500 && config.isProduction ? 'Internal Server Error' : message,
    },
  };

  if (!config.isProduction && err instanceof Error && err.stack !== undefined) {
    body.error.stack = err.stack;
  }

  res.status(status).json(body);
};
