import config from '../config/index.ts';
import { MemoryStorage } from './memory.storage.ts';
import { S3Storage } from './s3.storage.ts';
import type { StoragePort } from './types.ts';

const createStorage = (): StoragePort => {
  if (config.storage.driver === 's3' && config.storage.s3) {
    return new S3Storage(config.storage.s3);
  }
  return new MemoryStorage();
};

/** The process-wide storage backend, chosen from config at startup. */
export const storage: StoragePort = createStorage();

/**
 * The concrete in-memory store when the memory driver is active — for tests to
 * seed, inspect, and clear between cases. `null` under the S3 driver.
 */
export const memoryStorage: MemoryStorage | null =
  storage instanceof MemoryStorage ? storage : null;
