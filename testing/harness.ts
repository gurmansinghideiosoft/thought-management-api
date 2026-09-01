import { randomUUID } from 'node:crypto';
import { after, before, beforeEach } from 'node:test';

import { memoryStorage } from '../src/storage/index.ts';
import { type ApiClient, makeClient } from './api.ts';
import { clearTestDb, startTestDb, stopTestDb } from './db.ts';
import { createTestServer, type TestServer } from './server.ts';

export interface AuthedClient {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** A `makeClient` that sends `Authorization: Bearer <accessToken>`. */
  api: ApiClient;
}

export interface TestApp {
  /** Base URL of the running app, e.g. http://127.0.0.1:53124 */
  readonly url: string;
  /** Register a fresh user and return an authenticated client for them. */
  registerAndClient(overrides?: {
    email?: string;
    password?: string;
    username?: string;
  }): Promise<AuthedClient>;
}

/**
 * Registers the `node:test` lifecycle for an integration test file:
 *   - `before`     — start the in-memory DB, then the HTTP server
 *   - `beforeEach` — wipe the DB and the in-memory file store
 *   - `after`      — stop the server and the DB
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

  const url = (): string => {
    if (!server) throw new Error('Test server not started yet');
    return server.url;
  };

  return {
    get url(): string {
      return url();
    },
    async registerAndClient(overrides): Promise<AuthedClient> {
      const anon = makeClient(url());
      const res = await anon.post<{
        user: { id: string };
        accessToken: string;
        refreshToken: string;
      }>('/api/auth/register', {
        email: overrides?.email ?? `user-${randomUUID()}@test.dev`,
        password: overrides?.password ?? 'correct horse battery',
        username:
          overrides?.username ?? `u${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      });
      if (res.status !== 201) {
        throw new Error(`registerAndClient failed: ${String(res.status)}`);
      }
      return {
        userId: res.body.user.id,
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        api: makeClient(url(), res.body.accessToken),
      };
    },
  };
};
