import 'dotenv/config';

/**
 * Central configuration.
 *
 * Every environment variable the app reads is parsed and validated here, once,
 * at startup. Nothing else in the codebase touches `process.env`. On bad input
 * the module throws immediately with a list of every problem found.
 */

type NodeEnv = 'development' | 'test' | 'production';
type StorageDriver = 's3' | 'memory';

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface S3Config {
  region: string;
  bucket: string;
  /** Custom endpoint for S3-compatible services (MinIO, R2, …). */
  endpoint: string | undefined;
  /** Path-style URLs (`endpoint/bucket/key`) — needed by most S3-compatibles. */
  forcePathStyle: boolean;
}

interface StorageConfig {
  driver: StorageDriver;
  /** Present only when `driver === 's3'`. */
  s3: S3Config | undefined;
}

interface UploadsConfig {
  maxBytes: number;
  /** S3 key prefix for uploaded files, e.g. `thoughts/`. */
  keyPrefix: string;
}

interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  /** `jsonwebtoken` duration strings, e.g. `15m`, `30d`. */
  accessTtl: string;
  refreshTtl: string;
  /** Extra rate-limit cap for /auth/login and /auth/register (per window). */
  rateLimitMax: number;
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
  readonly mongo: Readonly<{ uri: string }>;
  readonly storage: Readonly<StorageConfig>;
  readonly uploads: Readonly<UploadsConfig>;
  readonly auth: Readonly<AuthConfig>;
}

const ALLOWED_ENVS = ['development', 'test', 'production'] as const;

const isNodeEnv = (value: string): value is NodeEnv =>
  (ALLOWED_ENVS as readonly string[]).includes(value);

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value: string | undefined): boolean => value === 'true';

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
const isTest = env === 'test';

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

// MongoDB — required. Tests inject their own URI via mongodb-memory-server, so
// only demand it outside the test runner.
const mongoUri = process.env.MONGODB_URI ?? '';
if (!isTest && mongoUri === '') {
  errors.push('MONGODB_URI is required');
}

// Storage — defaults to the in-memory driver so local dev and tests need no S3.
const rawDriver = process.env.STORAGE_DRIVER ?? 'memory';
if (rawDriver !== 's3' && rawDriver !== 'memory') {
  errors.push(`STORAGE_DRIVER must be "s3" or "memory" (got "${rawDriver}")`);
}
const driver: StorageDriver = isTest ? 'memory' : rawDriver === 's3' ? 's3' : 'memory';

let s3: S3Config | undefined;
if (driver === 's3') {
  const region = process.env.S3_REGION ?? '';
  const bucket = process.env.S3_BUCKET ?? '';
  if (region === '') errors.push('S3_REGION is required when STORAGE_DRIVER=s3');
  if (bucket === '') errors.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  s3 = {
    region,
    bucket,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: toBool(process.env.S3_FORCE_PATH_STYLE),
  };
}

const uploads: UploadsConfig = {
  // Small cap under the test runner so oversize-upload tests don't allocate 25 MiB.
  maxBytes: toInt(process.env.UPLOAD_MAX_BYTES, isTest ? 64 * 1024 : 25 * 1024 * 1024),
  keyPrefix: process.env.UPLOAD_KEY_PREFIX ?? 'thoughts/',
};
if (uploads.maxBytes < 1024) {
  errors.push('UPLOAD_MAX_BYTES must be at least 1024');
}

// Auth — JWT secrets are required outside tests (tests use fixed dev secrets).
const TEST_SECRET = 'test-secret-value-that-is-at-least-32-characters';
const accessSecret = process.env.JWT_ACCESS_SECRET ?? (isTest ? TEST_SECRET : '');
const refreshSecret =
  process.env.JWT_REFRESH_SECRET ?? (isTest ? `${TEST_SECRET}-refresh` : '');
if (accessSecret.length < 32) {
  errors.push('JWT_ACCESS_SECRET is required and must be at least 32 characters');
}
if (refreshSecret.length < 32) {
  errors.push('JWT_REFRESH_SECRET is required and must be at least 32 characters');
}
if (accessSecret !== '' && accessSecret === refreshSecret) {
  errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
}

const auth: AuthConfig = {
  accessSecret,
  refreshSecret,
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  rateLimitMax: toInt(process.env.AUTH_RATE_LIMIT_MAX, 10),
};

if (errors.length > 0) {
  throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
}

// --- Freeze & export -------------------------------------------------------

const config: Config = Object.freeze({
  env,
  isProduction: env === 'production',
  isDevelopment: env === 'development',
  isTest,
  port,
  // Enable only behind a real reverse proxy; otherwise clients can spoof
  // X-Forwarded-For and bypass the rate limiter.
  trustProxy: toBool(process.env.TRUST_PROXY),
  // Empty => same-origin only, the safe default.
  corsOrigins: Object.freeze(parseList(process.env.CORS_ORIGIN)),
  rateLimit: Object.freeze(rateLimit),
  mongo: Object.freeze({ uri: mongoUri }),
  storage: Object.freeze({ driver, s3: s3 ? Object.freeze(s3) : undefined }),
  uploads: Object.freeze(uploads),
  auth: Object.freeze(auth),
});

export default config;
