import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  seedCapture,
  seedEntry,
  seedJournalEntry,
  seedTask,
  seedThought,
  seedTransaction,
} from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Res {
  query: string;
  groups: {
    thoughts: { id: string; title: string }[];
    entries: { id: string; thoughtTitle: string }[];
    journal: { id: string; date: string }[];
    tasks: { id: string; content: string }[];
    transactions: { id: string; title: string }[];
    captures: { id: string; text: string }[];
  };
}

test('finds a term across every content type', async () => {
  const t = await seedThought(auth.userId, {
    title: 'plans',
    description: 'about xylophones',
  });
  await seedEntry(String(t._id), auth.userId, { body: 'bought a xylophone' });
  await seedJournalEntry(auth.userId, {
    date: '2026-09-10',
    excerpt: 'played the xylophone',
  });
  await seedTask(auth.userId, { content: 'tune the xylophone' });
  await seedTransaction(auth.userId, { title: 'xylophone strings', date: '2026-09-05' });
  await seedCapture(auth.userId, { text: 'idea: a xylophone app' });

  const res = await api().get<Res>('/api/search?q=xylophone');
  assert.equal(res.body.groups.thoughts.length, 1);
  assert.equal(res.body.groups.entries.length, 1);
  assert.equal(res.body.groups.entries[0]!.thoughtTitle, 'plans');
  assert.equal(res.body.groups.journal.length, 1);
  assert.equal(res.body.groups.tasks.length, 1);
  assert.equal(res.body.groups.transactions.length, 1);
  assert.equal(res.body.groups.captures.length, 1);
});

test('search is case-insensitive and matches partial words', async () => {
  await seedTask(auth.userId, { content: 'Grocery run' });
  const res = await api().get<Res>('/api/search?q=GROC');
  assert.equal(res.body.groups.tasks.length, 1);
});

test('a term in only one place returns only that group', async () => {
  await seedCapture(auth.userId, { text: 'quokka' });
  const res = await api().get<Res>('/api/search?q=quokka');
  assert.equal(res.body.groups.captures.length, 1);
  assert.equal(res.body.groups.thoughts.length, 0);
  assert.equal(res.body.groups.tasks.length, 0);
});

test('a query shorter than two characters is rejected', async () => {
  assert.equal((await api().get('/api/search?q=a')).status, 400);
});

test('one user never sees another user’s content', async () => {
  await seedTask(auth.userId, { content: 'narwhal facts' });
  const other = await app.registerAndClient();
  const res = await other.api.get<Res>('/api/search?q=narwhal');
  assert.equal(res.body.groups.tasks.length, 0);
});

test('the per-group limit is respected', async () => {
  for (let i = 0; i < 10; i += 1) {
    await seedCapture(auth.userId, { text: `wombat note ${String(i)}` });
  }
  const res = await api().get<Res>('/api/search?q=wombat&limit=3');
  assert.equal(res.body.groups.captures.length, 3);
});
