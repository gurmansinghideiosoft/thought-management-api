import http from 'node:http';

import app from './app.ts';
import config from './config/index.ts';
import { connectDb, disconnectDb } from './db/mongoose.ts';

/**
 * Process entry point.
 *
 * Responsibilities: connect to MongoDB, open the HTTP socket, and shut both
 * down cleanly on SIGTERM/SIGINT or an unrecoverable error.
 */
const server = http.createServer(app);

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received — shutting down...`);

  server.close((err) => {
    void (async () => {
      if (err) console.error('Error while closing server:', err);
      try {
        await disconnectDb();
      } catch (dbErr) {
        console.error('Error while disconnecting from MongoDB:', dbErr);
      }
      console.log('Shutdown complete. Bye.');
      process.exit(err ? 1 : 0);
    })();
  });

  // If open connections refuse to drain, don't hang forever.
  setTimeout(() => {
    console.error('Could not close connections in time — forcing shutdown.');
    process.exit(1);
  }, 10_000).unref();
};

const main = async (): Promise<void> => {
  await connectDb(config.mongo.uri);

  server.listen(config.port, () => {
    console.log(
      `[thought-management] listening on http://localhost:${config.port} (${config.env})`,
    );
  });
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

main().catch((err: unknown) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
