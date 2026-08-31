import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { createTestServer, type TestServer } from '../../testing/server.ts';

let server: TestServer;

before(async () => {
  server = await createTestServer();
});

after(async () => {
  await server.close();
});

test('GET /health responds 200 with a healthy body', async () => {
  const res = await fetch(`${server.url}/health`);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');

  const body = (await res.json()) as {
    status: string;
    uptime: number;
    timestamp: string;
  };
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptime, 'number');
  assert.ok(Number.isFinite(Date.parse(body.timestamp)), 'timestamp is an ISO date');
});

test('GET /health omits the X-Powered-By header', async () => {
  const res = await fetch(`${server.url}/health`);

  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unknown routes fall through to the 404 handler', async () => {
  const res = await fetch(`${server.url}/definitely-not-a-route`);

  assert.equal(res.status, 404);

  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /not found/i);
});
