import http from 'node:http';

import app from './app.ts';
import config from './config/index.ts';

/**
 * Process entry point.
 *
 * Responsibilities: open the HTTP socket, and shut it down cleanly on
 * SIGTERM/SIGINT or an unrecoverable error.
 */
const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(
    `[thought-management] listening on http://localhost:${config.port} (${config.env})`,
  );
});

// --- Graceful shutdown --------------------------------------------------

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received — closing HTTP server...`);

  server.close((err) => {
    if (err) {
      console.error('Error while closing server:', err);
      process.exit(1);
    }
    console.log('HTTP server closed. Bye.');
    process.exit(0);
  });

  // If open connections refuse to drain, don't hang forever.
  setTimeout(() => {
    console.error('Could not close connections in time — forcing shutdown.');
    process.exit(1);
  }, 10_000).unref();
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

// A rejected promise nobody handled, or a thrown error nobody caught, leaves the
// process in an unknown state. Log and exit so the supervisor restarts us.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
