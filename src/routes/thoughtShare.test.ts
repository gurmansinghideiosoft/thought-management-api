import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let owner: AuthedClient;

beforeEach(async () => {
  owner = await app.registerAndClient({
    email: 'owner@share.test',
    username: 'owner_user',
  });
});

interface Thought {
  id: string;
  title: string;
  role?: 'owner' | 'collaborator';
  sharedBy?: { id: string; username: string | null };
}
interface Invite {
  id: string;
  thought: { id: string; title: string };
  invitedBy: { username: string | null };
}

const makeThought = (title = 'Shared thing') =>
  owner.api.post<Thought>('/api/thoughts', { title });

test('invite → accept → collaborator can read but not edit', async () => {
  const t = (await makeThought()).body;
  await owner.api.post(`/api/thoughts/${t.id}/entries`, { kind: 'note', body: 'first' });

  const bob = await app.registerAndClient({
    email: 'bob@share.test',
    username: 'bob_user',
  });

  const invited = await owner.api.post(`/api/thoughts/${t.id}/invites`, {
    emails: ['bob@share.test'],
  });
  assert.equal(invited.status, 201);

  const inbox = await bob.api.get<{ items: Invite[] }>('/api/invites');
  assert.equal(inbox.body.items.length, 1);
  assert.equal(inbox.body.items[0]?.thought.id, t.id);
  assert.equal(inbox.body.items[0]?.invitedBy.username, 'owner_user');

  const accepted = await bob.api.post(`/api/invites/${inbox.body.items[0]?.id}/accept`);
  assert.equal(accepted.status, 200);

  // Shows up in Bob's list, tagged as shared.
  const list = await bob.api.get<{ items: Thought[] }>('/api/thoughts');
  const row = list.body.items.find((x) => x.id === t.id);
  assert.equal(row?.role, 'collaborator');
  assert.equal(row?.sharedBy?.username, 'owner_user');

  // Reads work.
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}`)).status, 200);
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}/stats`)).status, 200);
  const timeline = await bob.api.get<{ items: unknown[] }>(
    `/api/thoughts/${t.id}/entries`,
  );
  assert.equal(timeline.body.items.length, 1);

  // Writes do not.
  assert.equal(
    (await bob.api.patch(`/api/thoughts/${t.id}`, { title: 'hijack' })).status,
    404,
  );
  assert.equal((await bob.api.del(`/api/thoughts/${t.id}`)).status, 404);
  assert.equal(
    (await bob.api.post(`/api/thoughts/${t.id}/entries`, { kind: 'note', body: 'x' }))
      .status,
    404,
  );
});

test('declining leaves the thought invisible', async () => {
  const t = (await makeThought()).body;
  const bob = await app.registerAndClient({
    email: 'bob2@share.test',
    username: 'bob_two',
  });
  await owner.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['bob2@share.test'] });
  const inv = (await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items[0];

  assert.equal((await bob.api.post(`/api/invites/${inv?.id}/decline`)).status, 200);
  assert.equal(
    (await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items.length,
    0,
  );
  assert.equal(
    (await bob.api.get<{ items: Thought[] }>('/api/thoughts')).body.items.length,
    0,
  );
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}`)).status, 404);
});

test('an invite to an unknown email binds when that person signs up', async () => {
  const t = (await makeThought()).body;
  const res = await owner.api.post(`/api/thoughts/${t.id}/invites`, {
    emails: ['newcomer@share.test'],
  });
  assert.equal(res.status, 201);

  // They register with that email later.
  const newcomer = await app.registerAndClient({
    email: 'newcomer@share.test',
    username: 'newcomer',
  });
  const inbox = await newcomer.api.get<{ items: Invite[] }>('/api/invites');
  assert.equal(inbox.body.items.length, 1);
  assert.equal(
    (await newcomer.api.post(`/api/invites/${inbox.body.items[0]?.id}/accept`)).status,
    200,
  );
  assert.equal((await newcomer.api.get(`/api/thoughts/${t.id}`)).status, 200);
});

test('only the owner can invite; duplicates are skipped', async () => {
  const t = (await makeThought()).body;
  const bob = await app.registerAndClient({
    email: 'bob3@share.test',
    username: 'bob_three',
  });
  await owner.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['bob3@share.test'] });
  await bob.api.post(
    `/api/invites/${(await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items[0]?.id}/accept`,
  );

  // A collaborator can't invite anyone.
  assert.equal(
    (await bob.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['x@share.test'] }))
      .status,
    404,
  );

  // Re-inviting the same person is a no-op (skipped, not created).
  const again = await owner.api.post<{ created: unknown[]; skipped: unknown[] }>(
    `/api/thoughts/${t.id}/invites`,
    { emails: ['bob3@share.test'] },
  );
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.skipped.length, 1);
});

test('members list, revoke, and leave', async () => {
  const t = (await makeThought()).body;
  const bob = await app.registerAndClient({
    email: 'bob4@share.test',
    username: 'bob_four',
  });
  await owner.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['bob4@share.test'] });
  const invId = (await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items[0]
    ?.id;
  await bob.api.post(`/api/invites/${invId}/accept`);

  const members = await owner.api.get<{
    owner: { username: string };
    collaborators: { id: string; username: string }[];
    pendingInvites: unknown[];
  }>(`/api/thoughts/${t.id}/members`);
  assert.equal(members.body.owner.username, 'owner_user');
  assert.equal(members.body.collaborators[0]?.username, 'bob_four');

  // Owner revokes Bob.
  assert.equal(
    (await owner.api.del(`/api/thoughts/${t.id}/members/${bob.userId}`)).status,
    204,
  );
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}`)).status, 404);
  assert.equal(
    (await bob.api.get<{ items: Thought[] }>('/api/thoughts')).body.items.length,
    0,
  );

  // Re-add, then Bob leaves on his own.
  await owner.api.post(`/api/thoughts/${t.id}/invites`, { emails: ['bob4@share.test'] });
  await bob.api.post(
    `/api/invites/${(await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items[0]?.id}/accept`,
  );
  assert.equal(
    (await bob.api.del(`/api/thoughts/${t.id}/members/${bob.userId}`)).status,
    204,
  );
  assert.equal((await bob.api.get(`/api/thoughts/${t.id}`)).status, 404);
});

test('owner can revoke a still-pending invite', async () => {
  const t = (await makeThought()).body;
  const bob = await app.registerAndClient({
    email: 'bob5@share.test',
    username: 'bob_five',
  });
  const created = await owner.api.post<{ created: { id: string }[] }>(
    `/api/thoughts/${t.id}/invites`,
    { emails: ['bob5@share.test'] },
  );
  const inviteId = created.body.created[0]?.id;

  assert.equal(
    (await owner.api.del(`/api/thoughts/${t.id}/invites/${inviteId}`)).status,
    204,
  );
  assert.equal(
    (await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items.length,
    0,
  );
});

test('a stranger sees nothing and cannot respond to a foreign invite', async () => {
  const t = (await makeThought()).body;
  const bob = await app.registerAndClient({
    email: 'bob6@share.test',
    username: 'bob_six',
  });
  const stranger = await app.registerAndClient({
    email: 'stranger@share.test',
    username: 'stranger',
  });
  const created = await owner.api.post<{ created: { id: string }[] }>(
    `/api/thoughts/${t.id}/invites`,
    { emails: ['bob6@share.test'] },
  );

  assert.equal(
    (await stranger.api.post(`/api/invites/${created.body.created[0]?.id}/accept`))
      .status,
    404,
  );
  assert.equal((await stranger.api.get(`/api/thoughts/${t.id}/members`)).status, 404);
  assert.equal(
    (await bob.api.get<{ items: Invite[] }>('/api/invites')).body.items.length,
    1,
  );
});
