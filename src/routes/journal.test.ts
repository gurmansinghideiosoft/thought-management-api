import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedJournalEntry } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Entry {
  id: string;
  date: string;
  title: string;
  content: { type: string; content?: unknown[] };
  excerpt: string;
  wordCount: number;
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

test('PUT /by-date creates the day, then resumes the same entry', async () => {
  const first = await api().put<Entry>('/api/journal/by-date/2026-09-01', {});
  assert.equal(first.status, 200);
  assert.equal(first.body.date, '2026-09-01');
  assert.deepEqual(first.body.content, { type: 'doc', content: [] });

  const saved = await api().put<Entry>('/api/journal/by-date/2026-09-01', {
    title: 'A good day',
    content: doc('the sun was out'),
    excerpt: 'the sun was out',
    wordCount: 4,
  });
  assert.equal(saved.body.id, first.body.id); // same entry
  assert.equal(saved.body.title, 'A good day');
  assert.equal(saved.body.wordCount, 4);
});

test('GET /by-date/:date is 404 when nothing is written', async () => {
  assert.equal((await api().get('/api/journal/by-date/2026-01-01')).status, 404);
});

test('at most one entry per day', async () => {
  await api().put('/api/journal/by-date/2026-09-02', { content: doc('a') });
  await api().put('/api/journal/by-date/2026-09-02', { content: doc('b') });
  await api().put('/api/journal/by-date/2026-09-03', { content: doc('c') });

  const list = await api().get<{ items: Entry[] }>('/api/journal');
  assert.equal(list.body.items.length, 2);
});

test('GET /api/journal lists newest day first and paginates by cursor', async () => {
  for (const d of ['05', '01', '09', '03', '07']) {
    await seedJournalEntry(auth.userId, { date: `2026-09-${d}` });
  }

  const page1 = await api().get<{ items: Entry[]; hasMore: boolean; nextCursor: string }>(
    '/api/journal?limit=3',
  );
  assert.deepEqual(
    page1.body.items.map((e) => e.date),
    ['2026-09-09', '2026-09-07', '2026-09-05'],
  );
  assert.equal(page1.body.hasMore, true);

  const page2 = await api().get<{ items: Entry[]; hasMore: boolean }>(
    `/api/journal?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
  );
  assert.deepEqual(
    page2.body.items.map((e) => e.date),
    ['2026-09-03', '2026-09-01'],
  );
  assert.equal(page2.body.hasMore, false);
});

test('PATCH /:id edits an entry; large content is accepted', async () => {
  const entry = (await api().put<Entry>('/api/journal/by-date/2026-09-10', {})).body;

  const big = 'word '.repeat(20_000);
  const res = await api().patch<Entry>(`/api/journal/${entry.id}`, {
    title: 'edited',
    content: doc(big),
    excerpt: big.slice(0, 280),
    wordCount: 20_000,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'edited');
  assert.equal(res.body.wordCount, 20_000);
});

test('DELETE soft-deletes and hides from the list', async () => {
  const entry = (await api().put<Entry>('/api/journal/by-date/2026-09-11', {})).body;
  assert.equal((await api().del(`/api/journal/${entry.id}`)).status, 204);

  const list = await api().get<{ items: Entry[] }>('/api/journal');
  assert.deepEqual(list.body.items, []);
  assert.equal((await api().get(`/api/journal/${entry.id}`)).status, 404);

  // the day can be journalled again
  const again = await api().put<Entry>('/api/journal/by-date/2026-09-11', {});
  assert.equal(again.status, 200);
  assert.notEqual(again.body.id, entry.id);
});

test('journal entries are isolated per user', async () => {
  const mine = (await api().put<Entry>('/api/journal/by-date/2026-09-12', {})).body;
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Entry[] }>('/api/journal')).body.items,
    [],
  );
  assert.equal((await other.api.get(`/api/journal/${mine.id}`)).status, 404);
  assert.equal(
    (await other.api.patch(`/api/journal/${mine.id}`, { title: 'x' })).status,
    404,
  );
});
