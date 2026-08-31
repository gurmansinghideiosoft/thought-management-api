import type { AddressInfo } from 'node:net';

import app from '../src/app.ts';

export interface TestServer {
  /** Base URL, e.g. http://127.0.0.1:53124 */
  url: string;
  /** Call in an `after()` hook to release the port. */
  close: () => Promise<void>;
}

/**
 * Boots the real Express app on a random free port (port 0) so a test file can
 * make actual HTTP requests against it.
 *
 * Because `app` never calls `listen()` itself, each test file gets its own
 * isolated server instance.
 */
export const createTestServer = (): Promise<TestServer> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
