import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  seedCapture,
  seedEntry,
  seedHabit,
  seedHabitEntry,
  seedJournalEntry,
  seedReview,
  seedTask,
  seedThought,
  seedTransaction,
} from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Capture } from '../models/capture.model.ts';
import { Entry } from '../models/entry.model.ts';
import { Thought } from '../models/thought.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;
const uid = () => auth.userId;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

// Anchored test week: Mon 2026-09-14 … Sun 2026-09-20  (ISO 2026-W38)
// Previous week:       Mon 2026-09-07 … Sun 2026-09-13  (ISO 2026-W37)
const WEEK = '/api/reviews/summary?period=week&anchor=2026-09-16&today=2026-09-20';

const backdate = (
  coll: typeof Entry.collection | typeof Capture.collection,
  id: unknown,
  iso: string,
): Promise<unknown> =>
  coll.updateOne({ _id: id as never }, { $set: { createdAt: new Date(iso) } });

interface Summary {
  periodKey: string;
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  isCurrent: boolean;
  tasks: {
    done: number;
    donePrev: number;
    open: number;
    list: { content: string; date: string | null }[];
  };
  journal: {
    written: number;
    writtenPrev: number;
    words: number;
    streak: { current: number; longest: number };
    list: { id: string; date: string; title: string }[];
  };
  finance: {
    totalSpending: number;
    totalEarning: number;
    net: number;
    spendingPrev: number;
    byTag: { name: string; total: number }[];
  };
  thoughts: {
    entriesAdded: number;
    entriesAddedPrev: number;
    touched: number;
    list: { id: string; title: string; count: number }[];
  };
  habits: {
    overallRate: number;
    overallRatePrev: number;
    items: { name: string; done: number; possible: number; rate: number }[];
  };
  captures: { created: number; processed: number };
  saved: { intentions: string; reflection: string; rating: number | null } | null;
  prevReview: { intentions: string; reflection: string } | null;
  completedStreak: number;
}

interface Review {
  id: string;
  intentions: string;
  reflection: string;
  rating: number | null;
  completedAt: string | null;
}

const summary = async (url = WEEK): Promise<Summary> =>
  (await api().get<Summary>(url)).body;

test('empty period → zeros, no saved / prev review', async () => {
  const res = await api().get<Summary>(WEEK);
  assert.equal(res.status, 200);
  assert.equal(res.body.periodKey, '2026-W38');
  assert.deepEqual(res.body.range, { from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(res.body.prevRange, { from: '2026-09-07', to: '2026-09-13' });
  assert.equal(res.body.isCurrent, true);
  assert.equal(res.body.tasks.done, 0);
  assert.equal(res.body.journal.written, 0);
  assert.equal(res.body.finance.totalSpending, 0);
  assert.equal(res.body.thoughts.entriesAdded, 0);
  assert.equal(res.body.habits.items.length, 0);
  assert.equal(res.body.captures.created, 0);
  assert.equal(res.body.saved, null);
  assert.equal(res.body.prevReview, null);
  assert.equal(res.body.completedStreak, 0);
});

test('tasks: done in range counts, prior week does not, pending → open', async () => {
  await seedTask(uid(), { date: '2026-09-15', status: 'done' });
  await seedTask(uid(), { date: '2026-09-17', status: 'done' });
  await seedTask(uid(), { date: '2026-09-18', status: 'pending' });
  await seedTask(uid(), { date: '2026-09-08', status: 'done' }); // previous week

  const b = await summary();
  assert.equal(b.tasks.done, 2);
  assert.equal(b.tasks.donePrev, 1);
  assert.equal(b.tasks.open, 1);
  assert.equal(b.tasks.list.length, 2);
});

test('journal: entries + words summed, prior week separate, newest first', async () => {
  await seedJournalEntry(uid(), { date: '2026-09-15', wordCount: 100, title: 'Mon' });
  await seedJournalEntry(uid(), { date: '2026-09-16', wordCount: 50, title: 'Tue' });
  await seedJournalEntry(uid(), { date: '2026-09-10', wordCount: 999 }); // previous week

  const b = await summary();
  assert.equal(b.journal.written, 2);
  assert.equal(b.journal.words, 150);
  assert.equal(b.journal.writtenPrev, 1);
  assert.equal(b.journal.list[0]?.date, '2026-09-16');
});

test('finance: totals, net, and previous-week spending', async () => {
  await seedTransaction(uid(), { date: '2026-09-15', amount: 40, kind: 'spending' });
  await seedTransaction(uid(), { date: '2026-09-16', amount: 10, kind: 'spending' });
  await seedTransaction(uid(), { date: '2026-09-17', amount: 200, kind: 'earning' });
  await seedTransaction(uid(), { date: '2026-09-08', amount: 25, kind: 'spending' });

  const b = await summary();
  assert.equal(b.finance.totalSpending, 50);
  assert.equal(b.finance.totalEarning, 200);
  assert.equal(b.finance.net, 150);
  assert.equal(b.finance.spendingPrev, 25);
});

test('thoughts: entries grouped per thought, sorted desc, prev counted', async () => {
  const alpha = await seedThought(uid(), { title: 'Alpha' });
  const beta = await seedThought(uid(), { title: 'Beta' });

  for (let i = 0; i < 3; i += 1) {
    const e = await seedEntry(alpha._id, uid());
    await backdate(Entry.collection, e._id, '2026-09-15T12:00:00Z');
  }
  const one = await seedEntry(beta._id, uid());
  await backdate(Entry.collection, one._id, '2026-09-16T12:00:00Z');

  for (let i = 0; i < 2; i += 1) {
    const pe = await seedEntry(alpha._id, uid());
    await backdate(Entry.collection, pe._id, '2026-09-09T12:00:00Z'); // previous week
  }

  const b = await summary();
  assert.equal(b.thoughts.entriesAdded, 4);
  assert.equal(b.thoughts.touched, 2);
  assert.equal(b.thoughts.entriesAddedPrev, 2);
  assert.equal(b.thoughts.list[0]?.title, 'Alpha');
  assert.equal(b.thoughts.list[0]?.count, 3);
});

test('thoughts: a soft-deleted thought still resolves its title', async () => {
  const gone = await seedThought(uid(), { title: 'Gone' });
  const e = await seedEntry(gone._id, uid());
  await backdate(Entry.collection, e._id, '2026-09-15T12:00:00Z');
  await Thought.collection.updateOne(
    { _id: gone._id },
    { $set: { deletedAt: new Date() } },
  );

  const b = await summary();
  assert.equal(b.thoughts.entriesAdded, 1);
  assert.equal(b.thoughts.list[0]?.title, 'Gone');
});

test('habits: rate = done / possible, possible clamped to today', async () => {
  const h = await seedHabit(uid(), { name: 'Meditate' });
  await seedHabitEntry(uid(), h._id, '2026-09-14');
  await seedHabitEntry(uid(), h._id, '2026-09-15');
  await seedHabitEntry(uid(), h._id, '2026-09-16');

  // today is mid-week → only Mon–Thu are "possible", not the whole week.
  const b = await summary(
    '/api/reviews/summary?period=week&anchor=2026-09-16&today=2026-09-17',
  );
  assert.equal(b.habits.items.length, 1);
  assert.equal(b.habits.items[0]?.done, 3);
  assert.equal(b.habits.items[0]?.possible, 4);
  assert.equal(b.habits.items[0]?.rate, 0.75);
  assert.equal(b.habits.overallRate, 0.75);
});

test('captures: created + processed within the window', async () => {
  const c1 = await seedCapture(uid());
  const c2 = await seedCapture(uid(), { status: 'archived' });
  const c3 = await seedCapture(uid());
  await backdate(Capture.collection, c1._id, '2026-09-15T09:00:00Z');
  await backdate(Capture.collection, c2._id, '2026-09-16T09:00:00Z');
  await backdate(Capture.collection, c3._id, '2026-08-01T09:00:00Z'); // out of range

  const b = await summary();
  assert.equal(b.captures.created, 2);
  assert.equal(b.captures.processed, 1);
});

test('period=month: calendar-month bounds and a YYYY-MM key', async () => {
  const res = await api().get<Summary>(
    '/api/reviews/summary?period=month&anchor=2026-09-16&today=2026-09-20',
  );
  assert.equal(res.body.periodKey, '2026-09');
  assert.deepEqual(res.body.range, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(res.body.prevRange, { from: '2026-08-01', to: '2026-08-31' });
});

test('PUT creates then updates a review; summary returns it as saved', async () => {
  const put1 = await api().put<Review>('/api/reviews/week/2026-W38', {
    reflection: 'good week',
    rating: 4,
  });
  assert.equal(put1.status, 200);
  assert.equal(put1.body.reflection, 'good week');
  assert.equal(put1.body.rating, 4);
  assert.equal(put1.body.completedAt, null);

  const put2 = await api().put<Review>('/api/reviews/week/2026-W38', {
    intentions: 'ship reviews',
  });
  assert.equal(put2.body.id, put1.body.id);
  assert.equal(put2.body.reflection, 'good week'); // untouched
  assert.equal(put2.body.intentions, 'ship reviews');

  const b = await summary();
  assert.equal(b.saved?.reflection, 'good week');
  assert.equal(b.saved?.intentions, 'ship reviews');
  assert.equal(b.saved?.rating, 4);
});

test('completing stamps completedAt once and does not move it', async () => {
  const done1 = await api().put<Review>('/api/reviews/week/2026-W38', {
    completed: true,
  });
  assert.ok(done1.body.completedAt);
  const stamp = done1.body.completedAt;

  await new Promise((r) => setTimeout(r, 5));
  const done2 = await api().put<Review>('/api/reviews/week/2026-W38', {
    completed: true,
    reflection: 'later edit',
  });
  assert.equal(done2.body.completedAt, stamp);
  assert.equal(done2.body.reflection, 'later edit');

  const undone = await api().put<Review>('/api/reviews/week/2026-W38', {
    completed: false,
  });
  assert.equal(undone.body.completedAt, null);
});

test('prevReview surfaces the prior period’s review', async () => {
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W37',
    intentions: 'last-week goal',
    completedAt: new Date(),
  });
  const b = await summary();
  assert.equal(b.prevReview?.intentions, 'last-week goal');
});

test('completedStreak counts consecutive completed periods', async () => {
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W37',
    completedAt: new Date(),
  });
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W36',
    completedAt: new Date(),
  });

  // Current week not completed yet → grace from the previous week: 2.
  let b = await summary();
  assert.equal(b.completedStreak, 2);

  await api().put('/api/reviews/week/2026-W38', { completed: true });
  b = await summary();
  assert.equal(b.completedStreak, 3);
});

test('a gap breaks the completedStreak', async () => {
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W37',
    completedAt: new Date(),
  });
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W35', // W36 missing
    completedAt: new Date(),
  });
  const b = await summary();
  assert.equal(b.completedStreak, 1);
});

test('GET /api/reviews lists completed reviews only, newest first', async () => {
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W36',
    completedAt: new Date('2026-09-07T00:00:00Z'),
  });
  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W37',
    completedAt: new Date('2026-09-14T00:00:00Z'),
  });
  await seedReview(uid(), { period: 'week', periodKey: '2026-W38' }); // not completed
  await seedReview(uid(), {
    period: 'month',
    periodKey: '2026-09',
    completedAt: new Date(),
  }); // other period

  const res = await api().get<{ items: { periodKey: string }[] }>(
    '/api/reviews?period=week',
  );
  assert.deepEqual(
    res.body.items.map((i) => i.periodKey),
    ['2026-W37', '2026-W36'],
  );
});

test('a second user sees none of the first user’s data', async () => {
  const other = await app.registerAndClient();
  await seedTask(uid(), { date: '2026-09-15', status: 'done' });
  await other.api.put('/api/reviews/week/2026-W38', { reflection: 'theirs' });

  const mine = await summary();
  assert.equal(mine.tasks.done, 1);
  assert.equal(mine.saved, null);

  const theirs = (await other.api.get<Summary>(WEEK)).body;
  assert.equal(theirs.tasks.done, 0);
  assert.equal(theirs.saved?.reflection, 'theirs');
});

test('validation: bad period and mismatched period key are 400', async () => {
  assert.equal((await api().get('/api/reviews/summary?period=day')).status, 400);
  assert.equal((await api().get('/api/reviews/summary')).status, 400);
  assert.equal(
    (await api().put('/api/reviews/week/2026-09', { reflection: 'x' })).status,
    400,
  );
  assert.equal(
    (await api().put('/api/reviews/month/2026-W10', { reflection: 'x' })).status,
    400,
  );
  assert.equal((await api().put('/api/reviews/week/2026-W38', {})).status, 400);
});
