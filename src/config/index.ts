import 'dotenv/config';

/**
 * Central configuration.
 *
 * Every environment variable the app reads is parsed and validated here, once,
 * at startup. Nothing else in the codebase touches `process.env`. On bad input
 * the module throws immediately with a list of every problem found.
 */

type NodeEnv = 'development' | 'test' | 'production';

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface Config {
  readonly env: NodeEnv;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly trustProxy: boolean;
  readonly corsOrigins: readonly string[];
  readonly rateLimit: Readonly<RateLimitConfig>;
}

const ALLOWED_ENVS = ['development', 'test', 'production'] as const;

const isNodeEnv = (value: string): value is NodeEnv =>
  (ALLOWED_ENVS as readonly string[]).includes(value);

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

// --- Read & validate --------------------------------------------------------

const errors: string[] = [];

const rawEnv = process.env.NODE_ENV ?? 'development';
if (!isNodeEnv(rawEnv)) {
  errors.push(`NODE_ENV must be one of ${ALLOWED_ENVS.join(', ')} (got "${rawEnv}")`);
}
const env: NodeEnv = isNodeEnv(rawEnv) ? rawEnv : 'development';

const port = toInt(process.env.PORT, 3000);
if (port < 1 || port > 65535) {
  errors.push(`PORT must be between 1 and 65535 (got "${port}")`);
}

const rateLimit: RateLimitConfig = {
  windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.RATE_LIMIT_MAX, 100),
};
if (rateLimit.windowMs < 1000) {
  errors.push('RATE_LIMIT_WINDOW_MS must be at least 1000');
}
if (rateLimit.max < 1) {
  errors.push('RATE_LIMIT_MAX must be at least 1');
}

if (errors.length > 0) {
  throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
}

// --- Freeze & export -------------------------------------------------------

const config: Config = Object.freeze({
  env,
  isProduction: env === 'production',
  isDevelopment: env === 'development',
  isTest: env === 'test',
  port,
  // Enable only behind a real reverse proxy; otherwise clients can spoof
  // X-Forwarded-For and bypass the rate limiter.
  trustProxy: process.env.TRUST_PROXY === 'true',
  // Empty => same-origin only, the safe default.
  corsOrigins: Object.freeze(parseList(process.env.CORS_ORIGIN)),
  rateLimit: Object.freeze(rateLimit),
});

export default config;
