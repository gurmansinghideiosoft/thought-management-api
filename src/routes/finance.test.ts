import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedFinanceTag, seedTransaction } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Transaction } from '../models/transaction.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Tag {
  id: string;
  name: string;
  color: string;
}
interface Txn {
  id: string;
  title: string;
  amount: number;
  kind: 'spending' | 'earning';
  date: string;
  tagId: string | null;
}
interface Summary {
  totalSpending: number;
  totalEarning: number;
  net: number;
  count: number;
  byTag: { tagId: string | null; name: string; total: number; count: number }[];
}

const RANGE = 'from=2026-09-01&to=2026-09-30';

test('CRUD a finance tag; case-insensitive duplicate is 409', async () => {
  const created = await api().post<Tag>('/api/finance/tags', {
    name: 'grocery',
    color: '#3f7d58',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.color, '#3f7d58');

  const renamed = await api().patch<Tag>(`/api/finance/tags/${created.body.id}`, {
    name: 'groceries',
  });
  assert.equal(renamed.body.name, 'groceries');

  const dup = await api().post('/api/finance/tags', { name: 'GROCERIES' });
  assert.equal(dup.status, 409);
});

test('deleting a tag leaves its transactions untagged', async () => {
  const tag = await seedFinanceTag(auth.userId, { name: 'petrol' });
  await seedTransaction(auth.userId, { tagId: tag._id, date: '2026-09-10' });
  await seedTransaction(auth.userId, { tagId: tag._id, date: '2026-09-12' });

  const del = await api().del(`/api/finance/tags/${String(tag._id)}`);
  assert.equal(del.status, 204);

  const remaining = await Transaction.find({ ownerId: auth.userId });
  assert.equal(remaining.length, 2);
  assert.ok(remaining.every((t) => t.tagId === null));
});

test('batch create returns the created transactions', async () => {
  const tag = await seedFinanceTag(auth.userId, { name: 'food' });
  const res = await api().post<{ items: Txn[] }>('/api/finance/transactions', {
    transactions: [
      { title: 'Lunch', amount: 12.5, date: '2026-09-03', tagId: String(tag._id) },
      { title: 'Salary', amount: 3000, kind: 'earning', date: '2026-09-01' },
      { title: 'Bus', amount: 2.256, date: '2026-09-03' },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.items.length, 3);
  // rounded to 2dp on the way in
  assert.equal(res.body.items.find((t) => t.title === 'Bus')?.amount, 2.26);
  assert.equal(res.body.items.find((t) => t.title === 'Salary')?.kind, 'earning');
});

test('batch create rejects an unknown tag (404) and a non-positive amount (400)', async () => {
  const badTag = await api().post('/api/finance/transactions', {
    transactions: [
      { title: 'x', amount: 1, date: '2026-09-03', tagId: '64b7f9b0c0000000000000aa' },
    ],
  });
  assert.equal(badTag.status, 404);

  const badAmount = await api().post('/api/finance/transactions', {
    transactions: [{ title: 'x', amount: 0, date: '2026-09-03' }],
  });
  assert.equal(badAmount.status, 400);
});

test('batch create rejects more than 100 rows', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    title: `t${String(i)}`,
    amount: 1,
    date: '2026-09-03',
  }));
  const res = await api().post('/api/finance/transactions', { transactions: rows });
  assert.equal(res.status, 400);
});

test('listing transactions honours the date range, newest first', async () => {
  await seedTransaction(auth.userId, { title: 'in-a', date: '2026-09-05' });
  await seedTransaction(auth.userId, { title: 'in-b', date: '2026-09-20' });
  await seedTransaction(auth.userId, { title: 'before', date: '2026-08-31' });
  await seedTransaction(auth.userId, { title: 'after', date: '2026-10-01' });

  const res = await api().get<{ items: Txn[] }>(`/api/finance/transactions?${RANGE}`);
  assert.deepEqual(
    res.body.items.map((t) => t.title),
    ['in-b', 'in-a'],
  );
});

test('a range with from after to is rejected', async () => {
  const res = await api().get('/api/finance/transactions?from=2026-09-30&to=2026-09-01');
  assert.equal(res.status, 400);
});

test('update a transaction: amount, kind, and clearing its tag', async () => {
  const tag = await seedFinanceTag(auth.userId);
  const txn = await seedTransaction(auth.userId, {
    tagId: tag._id,
    amount: 5,
    date: '2026-09-09',
  });

  const patched = await api().patch<Txn>(`/api/finance/transactions/${String(txn._id)}`, {
    amount: 8.999,
    kind: 'earning',
    tagId: null,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.amount, 9);
  assert.equal(patched.body.kind, 'earning');
  assert.equal(patched.body.tagId, null);
});

test('delete a transaction', async () => {
  const txn = await seedTransaction(auth.userId, { date: '2026-09-09' });
  const del = await api().del(`/api/finance/transactions/${String(txn._id)}`);
  assert.equal(del.status, 204);
  assert.equal(await Transaction.countDocuments({ ownerId: auth.userId }), 0);
});

test('summary totals, byTag ordering, Untagged bucket, and earnings excluded from byTag', async () => {
  const grocery = await seedFinanceTag(auth.userId, { name: 'grocery' });
  const petrol = await seedFinanceTag(auth.userId, { name: 'petrol' });

  await seedTransaction(auth.userId, {
    amount: 40,
    tagId: grocery._id,
    date: '2026-09-02',
  });
  await seedTransaction(auth.userId, {
    amount: 25,
    tagId: grocery._id,
    date: '2026-09-08',
  });
  await seedTransaction(auth.userId, {
    amount: 50,
    tagId: petrol._id,
    date: '2026-09-05',
  });
  await seedTransaction(auth.userId, { amount: 15, date: '2026-09-06' }); // untagged
  await seedTransaction(auth.userId, {
    amount: 2000,
    kind: 'earning',
    tagId: grocery._id,
    date: '2026-09-01',
  });

  const res = await api().get<Summary>(`/api/finance/summary?${RANGE}`);
  assert.equal(res.body.totalSpending, 130);
  assert.equal(res.body.totalEarning, 2000);
  assert.equal(res.body.net, 1870);
  assert.equal(res.body.count, 5);

  assert.deepEqual(
    res.body.byTag.map((b) => [b.name, b.total]),
    [
      ['grocery', 65],
      ['petrol', 50],
      ['Untagged', 15],
    ],
  );
});

test('summary of an empty range is all zeros', async () => {
  const res = await api().get<Summary>(
    '/api/finance/summary?from=2020-01-01&to=2020-01-31',
  );
  assert.deepEqual(
    [res.body.totalSpending, res.body.totalEarning, res.body.net, res.body.count],
    [0, 0, 0, 0],
  );
  assert.deepEqual(res.body.byTag, []);
});

test('one user cannot touch another user’s finance data', async () => {
  const tag = await seedFinanceTag(auth.userId);
  const txn = await seedTransaction(auth.userId, { date: '2026-09-09' });
  const other = await app.registerAndClient();

  assert.equal(
    (await other.api.patch(`/api/finance/tags/${String(tag._id)}`, { name: 'x' })).status,
    404,
  );
  assert.equal(
    (await other.api.del(`/api/finance/transactions/${String(txn._id)}`)).status,
    404,
  );
  const feed = await other.api.get<{ items: Txn[] }>(
    `/api/finance/transactions?${RANGE}`,
  );
  assert.deepEqual(feed.body.items, []);
});
