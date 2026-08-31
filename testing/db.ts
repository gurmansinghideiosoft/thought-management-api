import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../src/db/mongoose.ts';

let mongod: MongoMemoryServer | null = null;

/** Spin up an in-memory mongod and point mongoose at it. */
export const startTestDb = async (): Promise<void> => {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri());
};

export const stopTestDb = async (): Promise<void> => {
  await disconnectDb();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
};

/** Wipe every collection — call between tests for isolation. */
export const clearTestDb = async (): Promise<void> => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
};
