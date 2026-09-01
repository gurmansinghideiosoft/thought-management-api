import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { Types } from 'mongoose';

import { seedEntry, seedThought } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Entry } from '../models/entry.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;
const uid = () => auth.userId;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

const backdateEntry = (id: Types.ObjectId, when: Date): Promise<unknown> =>
  Entry.collection.updateOne({ _id: id }, { $set: { createdAt: when } });

interface Feed {
  items: { id: string; body: string; thought: { id: string; title: string | null } }[];
  hasMore: boolean;
  nextCursor: string | null;
}

test('GET /api/activity returns entries across thoughts, newest first', async () => {
  const t1 = await seedThought(uid(), { title: 'One' });
  const t2 = await seedThought(uid(), { title: 'Two' });

  const e1 = await seedEntry(t1._id, uid(), { body: 'first' });
  await backdateEntry(e1._id, new Date('2026-01-01T00:00:00Z'));
  const e2 = await seedEntry(t2._id, uid(), { body: 'second' });
  await backdateEntry(e2._id, new Date('2026-02-01T00:00:00Z'));
  const e3 = await seedEntry(t1._id, uid(), { body: 'third' });
  await backdateEntry(e3._id, new Date('2026-03-01T00:00:00Z'));

  const feed = await api().get<Feed>('/api/activity');
  assert.deepEqual(
    feed.body.items.map((i) => i.body),
    ['third', 'second', 'first'],
  );
  assert.equal(feed.body.items[0]?.thought.title, 'One');
  assert.equal(feed.body.items[1]?.thought.title, 'Two');
});

test('GET /api/activity honours from / to window', async () => {
  const t = await seedThought(uid());
  const older = await seedEntry(t._id, uid(), { body: 'january' });
  await backdateEntry(older._id, new Date('2026-01-15T00:00:00Z'));
  const newer = await seedEntry(t._id, uid(), { body: 'march' });
  await backdateEntry(newer._id, new Date('2026-03-15T00:00:00Z'));

  const windowed = await api().get<Feed>('/api/activity?from=2026-02-01&to=2026-04-01');
  assert.deepEqual(
    windowed.body.items.map((i) => i.body),
    ['march'],
  );
});

test('GET /api/activity paginates with a cursor', async () => {
  const t = await seedThought(uid());
  for (let i = 0; i < 5; i += 1) {
    const e = await seedEntry(t._id, uid(), { body: `n${String(i)}` });
    await backdateEntry(e._id, new Date(`2026-01-0${String(i + 1)}T00:00:00Z`));
  }

  const page1 = await api().get<Feed>('/api/activity?limit=2');
  assert.deepEqual(
    page1.body.items.map((i) => i.body),
    ['n4', 'n3'],
  );
  assert.equal(page1.body.hasMore, true);

  const page2 = await api().get<Feed>(
    `/api/activity?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor ?? '')}`,
  );
  assert.deepEqual(
    page2.body.items.map((i) => i.body),
    ['n2', 'n1'],
  );
});

test('GET /api/activity excludes soft-deleted entries and thoughts', async () => {
  const kept = await seedThought(uid(), { title: 'Kept' });
  await seedEntry(kept._id, uid(), { body: 'visible' });

  const gone = await seedThought(uid(), { title: 'Gone' });
  await seedEntry(gone._id, uid(), { body: 'hidden' });
  await api().del(`/api/thoughts/${gone.id}`);

  const feed = await api().get<Feed>('/api/activity');
  assert.deepEqual(
    feed.body.items.map((i) => i.body),
    ['visible'],
  );
});
