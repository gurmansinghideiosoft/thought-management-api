import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';

import config from './config/index.ts';
import { errorHandler, notFound } from './middleware/errorHandler.ts';
import activityRouter from './routes/activity.ts';
import healthRouter from './routes/health.ts';
import thoughtsRouter from './routes/thoughts.ts';

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

// Throttle abusive clients. Applied to every route; tighten per-route later for
// expensive or auth endpoints.
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);

// --- Request parsing ---------------------------------------------------

// Cap body size so a single large payload can't exhaust memory.
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// --- Logging ---------------------------------------------------------

// Stay silent under the test runner; otherwise log every request.
if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

// --- Routes --------------------------------------------------------

app.use('/health', healthRouter);
app.use('/api/thoughts', thoughtsRouter);
app.use('/api/activity', activityRouter);

// --- Fallbacks ---------------------------------------------------

// Anything that didn't match a route above -> 404 -> error handler.
app.use(notFound);
app.use(errorHandler);

export default app;
