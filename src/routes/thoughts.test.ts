import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { Types } from 'mongoose';

import { seedEntry, seedThought } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Thought } from '../models/thought.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;
const uid = () => auth.userId;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

/** Backdate a thought's createdAt via the raw driver (bypasses timestamps). */
const backdateThought = (id: string, when: Date): Promise<unknown> =>
  Thought.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { createdAt: when } },
  );

interface ThoughtBody {
  id: string;
  title: string;
  description: string;
  status: string;
  tags: { id: string; name: string }[];
  entryCount: number;
  lastEntryAt: string | null;
}
interface ListBody {
  items: ThoughtBody[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

test('requires authentication', async () => {
  const anon = await fetch(`${app.url}/api/thoughts`);
  assert.equal(anon.status, 401);
});

test('POST /api/thoughts creates a thought with initial tags', async () => {
  const res = await api().post<ThoughtBody>('/api/thoughts', {
    title: '  Website idea  ',
    description: 'the basic idea in my mind',
    tags: [{ name: 'credentials' }, { name: 'design', color: '#00ff88' }],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Website idea');
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.tags.length, 2);
  assert.ok(res.body.tags[0]?.id);
  assert.equal(res.body.entryCount, 0);
});

test('POST /api/thoughts rejects an empty title with 400', async () => {
  const res = await api().post('/api/thoughts', { description: 'no title' });
  assert.equal(res.status, 400);
});

test('POST /api/thoughts rejects duplicate tag names with 409', async () => {
  const res = await api().post('/api/thoughts', {
    title: 'x',
    tags: [{ name: 'Creds' }, { name: 'creds' }],
  });
  assert.equal(res.status, 409);
});

test('GET /api/thoughts filters by name, date, and status; and sorts', async () => {
  const old = await seedThought(uid(), { title: 'Alpha project' });
  await backdateThought(old.id, new Date('2026-01-01T00:00:00Z'));
  const recent = await seedThought(uid(), { title: 'Beta project' });
  const gamma = await seedThought(uid(), { title: 'Gamma', status: 'archived' });

  const byName = await api().get<ListBody>('/api/thoughts?q=beta');
  assert.equal(byName.body.items.length, 1);
  assert.equal(byName.body.items[0]?.title, 'Beta project');

  const active = await api().get<ListBody>('/api/thoughts?status=active');
  assert.deepEqual(active.body.items.map((t) => t.title).sort(), [
    'Alpha project',
    'Beta project',
  ]);

  const fromFilter = await api().get<ListBody>('/api/thoughts?createdFrom=2026-06-01');
  assert.ok(
    fromFilter.body.items.every((t) => t.id !== old.id),
    'the January thought is filtered out by createdFrom=2026-06-01',
  );

  const oldest = await api().get<ListBody>('/api/thoughts?sort=oldest');
  assert.equal(oldest.body.items[0]?.id, old.id);

  const created = await api().get<ListBody>('/api/thoughts?sort=created');
  assert.equal(created.body.items[0]?.id, gamma.id);
  const createdIds = created.body.items.map((t) => t.id);
  assert.ok(createdIds.indexOf(recent.id) < createdIds.indexOf(old.id));
});

test('GET /api/thoughts paginates', async () => {
  for (let i = 0; i < 5; i += 1) await seedThought(uid(), { title: `T${String(i)}` });

  const page1 = await api().get<ListBody>('/api/thoughts?limit=2&page=1');
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.pagination.total, 5);
  assert.equal(page1.body.pagination.totalPages, 3);

  const page3 = await api().get<ListBody>('/api/thoughts?limit=2&page=3');
  assert.equal(page3.body.items.length, 1);
});

test('one user cannot see or touch another user’s thought', async () => {
  const mine = await api().post<ThoughtBody>('/api/thoughts', { title: 'mine' });
  const other = await app.registerAndClient();

  assert.equal((await other.api.get(`/api/thoughts/${mine.body.id}`)).status, 404);
  assert.equal(
    (await other.api.patch(`/api/thoughts/${mine.body.id}`, { title: 'hijack' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/thoughts/${mine.body.id}`)).status, 404);
  assert.deepEqual((await other.api.get<ListBody>('/api/thoughts')).body.items, []);
});

test('GET /api/thoughts/:id returns 404 for a missing id', async () => {
  const res = await api().get('/api/thoughts/65b0c0ffee0c0ffee0c0ffee');
  assert.equal(res.status, 404);
});

test('GET /api/thoughts/:id returns 400 for a malformed id', async () => {
  const res = await api().get('/api/thoughts/not-an-id');
  assert.equal(res.status, 400);
});

test('PATCH /api/thoughts/:id edits fields', async () => {
  const thought = await seedThought(uid(), { title: 'old' });
  const res = await api().patch<ThoughtBody>(`/api/thoughts/${thought.id}`, {
    title: 'new title',
    description: 'new description',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'new title');
  assert.equal(res.body.description, 'new description');
});

test('archive / unarchive toggle status', async () => {
  const thought = await seedThought(uid());
  const archived = await api().post<ThoughtBody>(`/api/thoughts/${thought.id}/archive`);
  assert.equal(archived.body.status, 'archived');
  const active = await api().post<ThoughtBody>(`/api/thoughts/${thought.id}/unarchive`);
  assert.equal(active.body.status, 'active');
});

test('DELETE soft-deletes, hides from list, cascades to entries, and restores', async () => {
  const thought = await seedThought(uid(), { title: 'to delete' });
  await seedEntry(thought._id, uid(), { body: 'child entry' });

  const del = await api().del(`/api/thoughts/${thought.id}`);
  assert.equal(del.status, 204);

  const list = await api().get<ListBody>('/api/thoughts');
  assert.ok(list.body.items.every((t) => t.id !== thought.id));

  const trash = await api().get<ListBody>('/api/thoughts/trash');
  assert.equal(trash.body.items.length, 1);
  assert.equal(trash.body.items[0]?.id, thought.id);

  const entries = await api().get<{ items: unknown[] }>(
    `/api/thoughts/${thought.id}/entries`,
  );
  assert.equal(entries.status, 404);

  const restore = await api().post<ThoughtBody>(`/api/thoughts/${thought.id}/restore`);
  assert.equal(restore.status, 200);

  const afterRestore = await api().get<{ items: unknown[] }>(
    `/api/thoughts/${thought.id}/entries`,
  );
  assert.equal(afterRestore.status, 200);
  assert.equal(afterRestore.body.items.length, 1);
});

test('restoring a thought that is not deleted returns 400', async () => {
  const thought = await seedThought(uid());
  const res = await api().post(`/api/thoughts/${thought.id}/restore`);
  assert.equal(res.status, 400);
});

test('GET /api/thoughts/:id/stats summarizes the chain', async () => {
  const thought = await seedThought(uid());
  await seedEntry(thought._id, uid(), { kind: 'note', body: 'a' });
  await seedEntry(thought._id, uid(), { kind: 'note', body: 'b', starred: true });
  await seedEntry(thought._id, uid(), { kind: 'link', body: 'c' });

  const res = await api().get<{
    totalEntries: number;
    starredEntries: number;
    byKind: Record<string, number>;
    firstEntryAt: string | null;
  }>(`/api/thoughts/${thought.id}/stats`);

  assert.equal(res.status, 200);
  assert.equal(res.body.totalEntries, 3);
  assert.equal(res.body.starredEntries, 1);
  assert.equal(res.body.byKind.note, 2);
  assert.equal(res.body.byKind.link, 1);
  assert.ok(res.body.firstEntryAt);
});
