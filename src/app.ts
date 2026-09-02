import cors from 'cors';
import express, { type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmetImport from 'helmet';
import morgan from 'morgan';

import config from './config/index.ts';
import { requireAuth } from './middleware/auth.ts';
import { errorHandler, notFound } from './middleware/errorHandler.ts';
import activityRouter from './routes/activity.ts';
import authRouter from './routes/auth.ts';
import captureRouter from './routes/capture.ts';
import conversationsRouter from './routes/conversations.ts';
import exportRouter from './routes/export.ts';
import financeRouter from './routes/finance.ts';
import habitRouter from './routes/habit.ts';
import healthRouter from './routes/health.ts';
import invitesRouter from './routes/invites.ts';
import journalRouter from './routes/journal.ts';
import logRouter from './routes/log.ts';
import reviewsRouter from './routes/reviews.ts';
import routineRouter from './routes/routine.ts';
import searchRouter from './routes/search.ts';
import taskTagsRouter from './routes/taskTags.ts';
import tasksRouter from './routes/tasks.ts';
import thoughtsRouter from './routes/thoughts.ts';
import vaultRouter from './routes/vault.ts';

/**
 * `helmet@8` ships no ESM type declaration and its `package.json` `exports`
 * field has no `types` condition, so under strict `nodenext` resolution the
 * default import can resolve to a non-callable *namespace* on toolchains that
 * differ from this repo's pinned TypeScript (e.g. a CI runner). The runtime
 * value is always the middleware factory, so pin the shape here.
 */
const helmet = helmetImport as unknown as (
  options?: Record<string, unknown>,
) => RequestHandler;

/**
 * Builds and configures the Express application.
 *
 * This module knows nothing about ports or sockets — it just returns a
 * configured `app`. `server.ts` is responsible for actually listening. Keeping
 * them separate lets tests exercise the app in-process.
 */
const app = express();

// --- Platform settings -----------------------------------------------------

// Trust the reverse proxy's X-Forwarded-* headers only when we explicitly
// opted in via config. `1` = trust exactly one proxy hop.
app.set('trust proxy', config.trustProxy ? 1 : false);

// Don't advertise the framework in response headers.
app.disable('x-powered-by');

// --- Security middleware --------------------------------------------------

// Secure default HTTP response headers (HSTS, no-sniff, frameguard, CSP…).
app.use(helmet());

// Cross-origin access control. `origin: false` (no configured origins) means
// the browser blocks cross-origin requests entirely.
app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
  }),
);

// Throttle abusive clients. Applied to every route; tighter per-route limits sit
// on the auth endpoints below. Disabled under the test runner so a busy suite
// doesn't trip it.
if (!config.isTest) {
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
}

// --- Request parsing ---------------------------------------------------

// Cap body size so a single large payload can't exhaust memory. Journal
// entries carry a rich-text document, so the ceiling is 1 MB rather than a few kB.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// --- Logging ---------------------------------------------------------

// Stay silent under the test runner; otherwise log every request.
if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

// --- Routes --------------------------------------------------------

app.use('/health', healthRouter);

// Auth — public, but with a tighter limiter on the credential endpoints to slow
// brute-force / enumeration attempts.
if (!config.isTest) {
  const authLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.auth.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/change-password', authLimiter);
}
app.use('/api/auth', authRouter);

// Everything below requires a valid access token.
app.use('/api/thoughts', requireAuth, thoughtsRouter);
app.use('/api/invites', requireAuth, invitesRouter);
app.use('/api/conversations', requireAuth, conversationsRouter);
app.use('/api/activity', requireAuth, activityRouter);
app.use('/api/search', requireAuth, searchRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/task-tags', requireAuth, taskTagsRouter);
app.use('/api/routine', requireAuth, routineRouter);
app.use('/api/journal', requireAuth, journalRouter);
app.use('/api/reviews', requireAuth, reviewsRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/habits', requireAuth, habitRouter);
app.use('/api/captures', requireAuth, captureRouter);
app.use('/api/log', requireAuth, logRouter);
app.use('/api/finance', requireAuth, financeRouter);
app.use('/api/vault', requireAuth, vaultRouter);

// --- Fallbacks ---------------------------------------------------

// Anything that didn't match a route above -> 404 -> error handler.
app.use(notFound);
app.use(errorHandler);

export default app;
