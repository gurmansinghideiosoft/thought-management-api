import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let alice: AuthedClient;
let bob: AuthedClient;

beforeEach(async () => {
  alice = await app.registerAndClient({ email: 'alice@c.test', username: 'alice_c' });
  bob = await app.registerAndClient({ email: 'bob@c.test', username: 'bob_c' });
});

interface Conversation {
  id: string;
  kind: 'thought' | 'dm';
  peer?: { username: string };
  thought?: { id: string; title: string };
  unreadCount: number;
  background: string | null;
}
interface Message {
  id: string;
  body: string;
  author: { username: string | null };
  createdAt: string;
}

// --- DMs ---------------------------------------------------------------

test('a DM is the same conversation from either side', async () => {
  const fromA = await alice.api.post<Conversation>('/api/conversations/dm', {
    username: 'bob_c',
  });
  assert.equal(fromA.status, 201);

  const againA = await alice.api.post<Conversation>('/api/conversations/dm', {
    username: 'bob_c',
  });
  const fromB = await bob.api.post<Conversation>('/api/conversations/dm', {
    username: 'alice_c',
  });
  assert.equal(againA.body.id, fromA.body.id);
  assert.equal(fromB.body.id, fromA.body.id);
});

test('POST /dm rejects an unknown handle and yourself', async () => {
  assert.equal(
    (await alice.api.post('/api/conversations/dm', { username: 'nobody_here' })).status,
    404,
  );
  assert.equal(
    (await alice.api.post('/api/conversations/dm', { username: 'alice_c' })).status,
    400,
  );
});

test('send + list messages, oldest-first with keyset paging', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;

  for (let i = 1; i <= 5; i += 1) {
    const res = await alice.api.post(`/api/conversations/${conv.id}/messages`, {
      body: `msg ${String(i)}`,
    });
    assert.equal(res.status, 201);
  }

  const firstPage = await bob.api.get<{ items: Message[]; nextCursor: string | null }>(
    `/api/conversations/${conv.id}/messages?limit=3`,
  );
  assert.deepEqual(
    firstPage.body.items.map((m) => m.body),
    ['msg 3', 'msg 4', 'msg 5'],
  );
  assert.ok(firstPage.body.nextCursor);

  const older = await bob.api.get<{ items: Message[] }>(
    `/api/conversations/${conv.id}/messages?limit=3&before=${firstPage.body.nextCursor}`,
  );
  assert.deepEqual(
    older.body.items.map((m) => m.body),
    ['msg 1', 'msg 2'],
  );
  assert.equal(older.body.items[0]?.author.username, 'alice_c');
});

test('message body is validated', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;
  assert.equal(
    (await alice.api.post(`/api/conversations/${conv.id}/messages`, { body: '   ' }))
      .status,
    400,
  );
  assert.equal(
    (
      await alice.api.post(`/api/conversations/${conv.id}/messages`, {
        body: 'x'.repeat(4001),
      })
    ).status,
    400,
  );
});

test('unread count tracks the other side and clears on read', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;
  await alice.api.post(`/api/conversations/${conv.id}/messages`, { body: 'hi bob' });
  await alice.api.post(`/api/conversations/${conv.id}/messages`, { body: 'you there?' });

  const bobList = await bob.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(bobList.body.items[0]?.unreadCount, 2);
  assert.equal(bobList.body.items[0]?.peer?.username, 'alice_c');

  // Alice doesn't see her own messages as unread.
  const aliceList = await alice.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(aliceList.body.items[0]?.unreadCount, 0);

  assert.equal((await bob.api.post(`/api/conversations/${conv.id}/read`)).status, 204);
  const afterRead = await bob.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(afterRead.body.items[0]?.unreadCount, 0);
});

test('non-members cannot read or post', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;
  const carol = await app.registerAndClient({
    email: 'carol@c.test',
    username: 'carol_c',
  });
  assert.equal(
    (await carol.api.get(`/api/conversations/${conv.id}/messages`)).status,
    404,
  );
  assert.equal(
    (await carol.api.post(`/api/conversations/${conv.id}/messages`, { body: 'sneak' }))
      .status,
    404,
  );
});

test('an author can delete their own message; others cannot', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;
  const msg = (
    await alice.api.post<Message>(`/api/conversations/${conv.id}/messages`, {
      body: 'oops',
    })
  ).body;

  assert.equal(
    (await bob.api.del(`/api/conversations/${conv.id}/messages/${msg.id}`)).status,
    404,
  );
  assert.equal(
    (await alice.api.del(`/api/conversations/${conv.id}/messages/${msg.id}`)).status,
    204,
  );

  const list = await bob.api.get<{ items: Message[] }>(
    `/api/conversations/${conv.id}/messages`,
  );
  assert.equal(list.body.items.length, 0);
});

// --- thought discussion ----------------------------------------------

test('a thought conversation is one shared thread for its participants', async () => {
  const t = (
    await alice.api.post<{ id: string }>('/api/thoughts', { title: 'Team plan' })
  ).body;

  const first = await alice.api.get<Conversation>(`/api/thoughts/${t.id}/conversation`);
  const second = await alice.api.get<Conversation>(`/api/thoughts/${t.id}/conversation`);
  assert.equal(first.status, 200);
  assert.equal(first.body.id, second.body.id); // find-or-create

  // A stranger can't touch it.
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}/conversation`)).status, 404);

  // Once Bob is a collaborator, he shares the thread.
  await alice.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['bob@c.test'] });
  const invId = (await bob.api.get<{ items: { id: string }[] }>('/api/invites')).body
    .items[0]?.id;
  await bob.api.post(`/api/invites/${invId}/accept`);

  const bobConv = await bob.api.get<Conversation>(`/api/thoughts/${t.id}/conversation`);
  assert.equal(bobConv.body.id, first.body.id);

  await alice.api.post(`/api/conversations/${first.body.id}/messages`, {
    body: 'welcome aboard',
  });
  const bobSees = await bob.api.get<{ items: Message[] }>(
    `/api/conversations/${first.body.id}/messages`,
  );
  assert.equal(bobSees.body.items[0]?.body, 'welcome aboard');

  // It also shows up in Bob's conversation list as a thought thread.
  const list = await bob.api.get<{ items: Conversation[] }>('/api/conversations');
  const row = list.body.items.find((c) => c.id === first.body.id);
  assert.equal(row?.kind, 'thought');
  assert.equal(row?.thought?.title, 'Team plan');
});

test('chat wallpaper is per-user and per-conversation', async () => {
  const conv = (
    await alice.api.post<Conversation>('/api/conversations/dm', { username: 'bob_c' })
  ).body;
  assert.equal(conv.background, null);

  // Alice sets a wallpaper; Bob is unaffected.
  assert.equal(
    (
      await alice.api.put(`/api/conversations/${conv.id}/background`, {
        banner: 'misty-lake',
      })
    ).status,
    204,
  );

  const aliceList = await alice.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(aliceList.body.items[0]?.background, 'misty-lake');
  const bobList = await bob.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(bobList.body.items[0]?.background, null);

  // The dm endpoint echoes the caller's choice.
  const reopened = await alice.api.post<Conversation>('/api/conversations/dm', {
    username: 'bob_c',
  });
  assert.equal(reopened.body.background, 'misty-lake');

  // null clears it.
  await alice.api.put(`/api/conversations/${conv.id}/background`, { banner: null });
  const cleared = await alice.api.get<{ items: Conversation[] }>('/api/conversations');
  assert.equal(cleared.body.items[0]?.background, null);

  // A non-member can't set one.
  const carol = await app.registerAndClient({
    email: 'carol@c.test',
    username: 'carol_c',
  });
  assert.equal(
    (
      await carol.api.put(`/api/conversations/${conv.id}/background`, {
        banner: 'misty-lake',
      })
    ).status,
    404,
  );
});
