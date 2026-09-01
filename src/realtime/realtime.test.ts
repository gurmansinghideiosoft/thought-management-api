import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { makeClient } from '../../testing/api.ts';
import { clearTestDb, startTestDb, stopTestDb } from '../../testing/db.ts';
import app from '../app.ts';
import { closeRealtime, initRealtime } from './index.ts';

let httpServer: HttpServer;
let url: string;

before(async () => {
  await startTestDb();
  httpServer = createServer(app);
  initRealtime(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await clearTestDb();
});

after(async () => {
  await closeRealtime();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await stopTestDb();
});

const anon = () => makeClient(url);

interface Registered {
  token: string;
  api: ReturnType<typeof makeClient>;
}
const register = async (username: string): Promise<Registered> => {
  const res = await anon().post<{ accessToken: string }>('/api/auth/register', {
    email: `${username}@rt.test`,
    password: 'password123',
    username,
  });
  return { token: res.body.accessToken, api: makeClient(url, res.body.accessToken) };
};

const connect = (token: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: { token },
      transports: ['websocket'],
      // Don't let a rejected handshake retry forever in the background.
      reconnection: false,
      timeout: 4000,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });

/**
 * Resolve with the first `event` payload, or reject after `ms`. The timeout is
 * generous: this file runs in parallel with the rest of the suite, so event
 * latency is dominated by scheduling, not the socket.
 */
const nextEvent = <T = unknown>(
  socket: ClientSocket,
  event: string,
  ms = 10_000,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      ms,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const emitWithAck = <T = unknown>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 10_000);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

test('a bad token is refused', async () => {
  await assert.rejects(connect('not-a-real-token'), /unauthorized/);
});

test('a valid token connects', async () => {
  const alice = await register('rt_alice');
  const socket = await connect(alice.token);
  assert.equal(socket.connected, true);
  socket.disconnect();
});

test('joining a conversation you are not in is refused', async () => {
  const alice = await register('rt_alice2');
  await register('rt_bob2'); // must exist for the DM below
  const carol = await register('rt_carol2');

  const conv = await alice.api.post<{ id: string }>('/api/conversations/dm', {
    username: 'rt_bob2',
  });

  const socket = await connect(carol.token);
  const ack = await emitWithAck<{ ok: boolean }>(socket, 'conversation:join', {
    id: conv.body.id,
  });
  assert.equal(ack.ok, false);
  socket.disconnect();
});

test('a message posted over REST reaches everyone in the room', async () => {
  const alice = await register('rt_alice3');
  const bob = await register('rt_bob3');
  const conv = await alice.api.post<{ id: string }>('/api/conversations/dm', {
    username: 'rt_bob3',
  });

  const [aSocket, bSocket] = await Promise.all([
    connect(alice.token),
    connect(bob.token),
  ]);
  await Promise.all([
    emitWithAck(aSocket, 'conversation:join', { id: conv.body.id }),
    emitWithAck(bSocket, 'conversation:join', { id: conv.body.id }),
  ]);

  const bobGetsMessage = nextEvent<{ message: { body: string } }>(bSocket, 'message:new');
  const bobGetsBump = nextEvent<{ conversationId: string }>(bSocket, 'conversation:bump');

  const posted = await alice.api.post(`/api/conversations/${conv.body.id}/messages`, {
    body: 'hello over the wire',
  });
  assert.equal(posted.status, 201);

  assert.equal((await bobGetsMessage).message.body, 'hello over the wire');
  assert.equal((await bobGetsBump).conversationId, conv.body.id);

  aSocket.disconnect();
  bSocket.disconnect();
});

test('typing relays to the other member, not the sender', async () => {
  const alice = await register('rt_alice4');
  const bob = await register('rt_bob4');
  const conv = await alice.api.post<{ id: string }>('/api/conversations/dm', {
    username: 'rt_bob4',
  });

  const [aSocket, bSocket] = await Promise.all([
    connect(alice.token),
    connect(bob.token),
  ]);
  await Promise.all([
    emitWithAck(aSocket, 'conversation:join', { id: conv.body.id }),
    emitWithAck(bSocket, 'conversation:join', { id: conv.body.id }),
  ]);

  const bobSeesTyping = nextEvent<{ user: { username: string }; isTyping: boolean }>(
    bSocket,
    'typing',
  );
  let senderGotOwnTyping = false;
  aSocket.once('typing', () => {
    senderGotOwnTyping = true;
  });

  aSocket.emit('typing:start', { id: conv.body.id });

  const evt = await bobSeesTyping;
  assert.equal(evt.user.username, 'rt_alice4');
  assert.equal(evt.isTyping, true);
  assert.equal(senderGotOwnTyping, false);

  aSocket.disconnect();
  bSocket.disconnect();
});
