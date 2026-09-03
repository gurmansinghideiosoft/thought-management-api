import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedFinanceTag, seedLoan, seedTransaction } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Transaction } from '../models/transaction.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Loan {
  id: string;
  title: string;
  amount: number;
  kind: 'spending' | 'earning';
  date: string;
  loan: {
    counterparty: string;
    direction: 'lent' | 'borrowed';
    principal: number;
    status: 'open' | 'settled';
    settledOn: string | null;
    dueDate: string | null;
    note: string | null;
    repayments: { amount: number; date: string }[];
  };
}
interface Summary {
  totalSpending: number;
  totalEarning: number;
  net: number;
  lentOutstanding: number;
  borrowedOutstanding: number;
  openLoanCount: number;
  byTag: { name: string; total: number }[];
}

const RANGE = 'from=2026-09-01&to=2026-09-30';

test('creating a lent loan books a spending transaction and lists in the loan space', async () => {
  const res = await api().post<Loan>('/api/finance/loans', {
    counterparty: 'Sam',
    amount: 1000,
    date: '2026-09-05',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.kind, 'spending');
  assert.equal(res.body.amount, 1000);
  assert.equal(res.body.title, 'Lent to Sam');
  assert.equal(res.body.loan.status, 'open');
  assert.equal(res.body.loan.principal, 1000);

  // shows up in the dedicated loan space
  const loans = await api().get<{ items: Loan[] }>('/api/finance/loans');
  assert.equal(loans.body.items.length, 1);

  // ...and in the normal transaction timeline, so the UI can badge it
  const feed = await api().get<{ items: Loan[] }>(`/api/finance/transactions?${RANGE}`);
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0]!.loan.counterparty, 'Sam');
});

test('a borrowed loan books an earning transaction', async () => {
  const res = await api().post<Loan>('/api/finance/loans', {
    counterparty: 'Dad',
    direction: 'borrowed',
    amount: 500,
    date: '2026-09-05',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.kind, 'earning');
  assert.equal(res.body.title, 'Borrowed from Dad');

  const summary = await api().get<Summary>(`/api/finance/summary?${RANGE}`);
  assert.equal(summary.body.borrowedOutstanding, 500);
  assert.equal(summary.body.lentOutstanding, 0);
});

test('an open lent loan counts in totalSpending but not in byTag categories', async () => {
  const tag = await seedFinanceTag(auth.userId, { name: 'grocery' });
  await seedTransaction(auth.userId, {
    amount: 40,
    tagId: tag._id,
    date: '2026-09-02',
  });
  await api().post('/api/finance/loans', {
    counterparty: 'Sam',
    amount: 1000,
    date: '2026-09-05',
    tagId: String(tag._id),
  });

  const summary = await api().get<Summary>(`/api/finance/summary?${RANGE}`);
  assert.equal(summary.body.totalSpending, 1040);
  assert.equal(summary.body.lentOutstanding, 1000);
  assert.equal(summary.body.openLoanCount, 1);
  // the loan is excluded from the category breakdown
  assert.deepEqual(
    summary.body.byTag.map((b) => [b.name, b.total]),
    [['grocery', 40]],
  );
});

test('a partial repayment shrinks the outstanding balance and stays open', async () => {
  const created = await api().post<Loan>('/api/finance/loans', {
    counterparty: 'Sam',
    amount: 1000,
    date: '2026-09-05',
  });
  const id = created.body.id;

  const repaid = await api().post<Loan>(`/api/finance/loans/${id}/repay`, {
    amount: 400,
    date: '2026-09-20',
  });
  assert.equal(repaid.status, 200);
  assert.equal(repaid.body.amount, 600);
  assert.equal(repaid.body.loan.status, 'open');
  assert.equal(repaid.body.loan.repayments.length, 1);
  assert.equal(repaid.body.loan.repayments[0]!.amount, 400);

  const summary = await api().get<Summary>(`/api/finance/summary?${RANGE}`);
  assert.equal(summary.body.lentOutstanding, 600);
  assert.equal(summary.body.totalSpending, 600);
});

test('repaying the whole balance settles the loan and clears it from the totals', async () => {
  await seedTransaction(auth.userId, { amount: 40, date: '2026-09-02' });
  const created = await api().post<Loan>('/api/finance/loans', {
    counterparty: 'Sam',
    amount: 1000,
    date: '2026-09-05',
  });
  const id = created.body.id;

  const settled = await api().post<Loan>(`/api/finance/loans/${id}/repay`, {
    date: '2026-09-25',
  });
  assert.equal(settled.body.amount, 0);
  assert.equal(settled.body.loan.status, 'settled');
  assert.equal(settled.body.loan.settledOn, '2026-09-25');

  const summary = await api().get<Summary>(`/api/finance/summary?${RANGE}`);
  assert.equal(summary.body.lentOutstanding, 0);
  assert.equal(summary.body.openLoanCount, 0);
  // back to just the ordinary 40 of spending — the loan nets out entirely
  assert.equal(summary.body.totalSpending, 40);

  // still retrievable in the loan space with ?status=all
  const open = await api().get<{ items: Loan[] }>('/api/finance/loans');
  assert.deepEqual(open.body.items, []);
  const all = await api().get<{ items: Loan[] }>('/api/finance/loans?status=all');
  assert.equal(all.body.items.length, 1);
});

test('over-repaying is rejected, and a settled loan cannot be repaid again', async () => {
  const created = await api().post<Loan>('/api/finance/loans', {
    counterparty: 'Sam',
    amount: 100,
    date: '2026-09-05',
  });
  const id = created.body.id;

  const tooMuch = await api().post(`/api/finance/loans/${id}/repay`, { amount: 500 });
  assert.equal(tooMuch.status, 400);

  await api().post(`/api/finance/loans/${id}/repay`, {});
  const again = await api().post(`/api/finance/loans/${id}/repay`, { amount: 1 });
  assert.equal(again.status, 409);
});

test('a loan transaction cannot have its amount changed through the transaction route', async () => {
  const loan = await seedLoan(auth.userId, { amount: 200, date: '2026-09-05' });
  const res = await api().patch(`/api/finance/transactions/${String(loan._id)}`, {
    amount: 5,
  });
  assert.equal(res.status, 409);

  // metadata edits are still fine
  const ok = await api().patch(`/api/finance/transactions/${String(loan._id)}`, {
    title: 'renamed',
  });
  assert.equal(ok.status, 200);
});

test('patching loan metadata works; deleting a loan removes the whole row', async () => {
  const loan = await seedLoan(auth.userId, { amount: 200, date: '2026-09-05' });
  const id = String(loan._id);

  const patched = await api().patch<Loan>(`/api/finance/loans/${id}`, {
    counterparty: 'Samir',
    dueDate: '2026-10-01',
    note: 'for the concert tickets',
  });
  assert.equal(patched.body.loan.counterparty, 'Samir');
  assert.equal(patched.body.loan.dueDate, '2026-10-01');

  const del = await api().del(`/api/finance/loans/${id}`);
  assert.equal(del.status, 204);
  assert.equal(await Transaction.countDocuments({ ownerId: auth.userId }), 0);
});

test('one user cannot see or touch another user’s loans', async () => {
  const loan = await seedLoan(auth.userId, { amount: 200, date: '2026-09-05' });
  const id = String(loan._id);
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Loan[] }>('/api/finance/loans?status=all')).body.items,
    [],
  );
  assert.equal(
    (await other.api.post(`/api/finance/loans/${id}/repay`, { amount: 1 })).status,
    404,
  );
  assert.equal(
    (await other.api.patch(`/api/finance/loans/${id}`, { counterparty: 'x' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/finance/loans/${id}`)).status, 404);
});
