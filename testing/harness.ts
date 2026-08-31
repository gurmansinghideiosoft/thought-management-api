import { after, before, beforeEach } from 'node:test';

import { memoryStorage } from '../src/storage/index.ts';
import { clearTestDb, startTestDb, stopTestDb } from './db.ts';
import { createTestServer, type TestServer } from './server.ts';

export interface TestApp {
  /** Base URL of the running app, e.g. http://127.0.0.1:53124 */
  readonly url: string;
}

/**
 * Registers the `node:test` lifecycle for an integration test file:
 *   - `before`     — start the in-memory DB, then the HTTP server
 *   - `beforeEach` — wipe the DB and the in-memory file store
 *   - `after`      — stop the server and the DB
 *
 * Usage:
 *   const app = useTestApp();
 *   test('...', async () => { await fetch(`${app.url}/api/thoughts`); });
 */
export const useTestApp = (): TestApp => {
  let server: TestServer | undefined;

  before(async () => {
    await startTestDb();
    server = await createTestServer();
  });

  beforeEach(async () => {
    await clearTestDb();
    memoryStorage?.clear();
  });

  after(async () => {
    if (server) await server.close();
    await stopTestDb();
  });

  return {
    get url(): string {
      if (!server) throw new Error('Test server not started yet');
      return server.url;
    },
  };
};
