import mongoose from 'mongoose';

/**
 * MongoDB connection lifecycle.
 *
 * `server.ts` calls `connectDb()` before it starts listening and `disconnectDb()`
 * during graceful shutdown. Tests connect to an in-memory mongod the same way.
 */

// Reject query filters containing keys not in the schema, instead of silently
// ignoring them.
mongoose.set('strictQuery', true);

let listenersBound = false;

const bindConnectionLogging = (): void => {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('connected', () => {
    console.log('[db] MongoDB connected');
  });
  mongoose.connection.on('disconnected', () => {
    console.log('[db] MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB error:', err);
  });
};

export const connectDb = async (uri: string): Promise<void> => {
  bindConnectionLogging();
  await mongoose.connect(uri, {
    // Fail fast instead of buffering operations for 30s when the DB is down.
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
  });
  // Build indexes declared on the schemas (no-op once they exist).
  await Promise.all(
    Object.values(mongoose.connection.models).map((model) => model.createIndexes()),
  );
};

export const disconnectDb = async (): Promise<void> => {
  await mongoose.disconnect();
};

export const isDbConnected = (): boolean => mongoose.connection.readyState === 1;
