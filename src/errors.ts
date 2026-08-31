/**
 * An error that carries an HTTP status code.
 *
 * Throw this (or pass it to `next()`) whenever a request should fail with a
 * specific status. The central error handler reads `.status` and `.expose` off
 * it to decide what to send back.
 */
export class AppError extends Error {
  readonly status: number;

  /** Whether `message` is safe to reveal to the client (true for 4xx). */
  readonly expose: boolean;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = status < 500;

    // Keep this constructor out of the captured stack trace (V8 only).
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string): AppError => new AppError(message, 400);
export const notFoundError = (message = 'Not found'): AppError =>
  new AppError(message, 404);
export const conflict = (message: string): AppError => new AppError(message, 409);
