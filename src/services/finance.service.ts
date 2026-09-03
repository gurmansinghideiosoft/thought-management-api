import { Types } from 'mongoose';

import { badRequest, conflict, notFoundError } from '../errors.ts';
import { todayUtc } from '../lib/day.ts';
import { FinanceTag, type FinanceTagDocument } from '../models/financeTag.model.ts';
import {
  RecurringTransaction,
  type RecurringTransactionDocument,
} from '../models/recurringTransaction.model.ts';
import {
  Transaction,
  type TransactionDocument,
  type TransactionKind,
  type LoanDirection,
} from '../models/transaction.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const UNTAGGED = { name: 'Untagged', color: '#6f6d65' } as const;

const monthKey = (day: string): string => day.slice(0, 7);

const nextMonthKey = (mk: string): string => {
  const [y, m] = mk.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** `YYYY-MM-DD` for `dayOfMonth` in month `mk`, clamped to the month's length. */
const scheduledDate = (mk: string, dayOfMonth: number): string => {
  const [y, m] = mk.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mk}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, '0')}`;
};

/**
 * Post any due-and-not-yet-posted rows for the user's active recurring rules.
 * Called lazily whenever finance data is read — this backend has no scheduler.
 * Each read posts at most the months in `(lastPostedMonth, thisMonth]` whose
 * scheduled day has already passed; deleting a posted row does not bring it back.
 */
export const materializeRecurring = async (
  ownerId: string,
  today: string = todayUtc(),
): Promise<void> => {
  const rules = await RecurringTransaction.find({
    ownerId: owner(ownerId),
    active: true,
  });
  if (rules.length === 0) return;

  const thisMonth = monthKey(today);
  const inserts: Record<string, unknown>[] = [];
  const bumps: { id: Types.ObjectId; month: string }[] = [];

  for (const rule of rules) {
    const start = rule.lastPostedMonth
      ? nextMonthKey(rule.lastPostedMonth)
      : monthKey(rule.createdAt.toISOString().slice(0, 10));
    if (start > thisMonth) continue;

    let month = start;
    let highest: string | null = null;
    for (let i = 0; i < 24 && month <= thisMonth; i += 1) {
      const date = scheduledDate(month, rule.dayOfMonth);
      if (date <= today) {
        inserts.push({
          ownerId: owner(ownerId),
          title: rule.title,
          amount: round2(rule.amount),
          kind: rule.kind,
          tagId: rule.tagId,
          date,
          recurringId: rule._id,
        });
        highest = month;
      }
      month = nextMonthKey(month);
    }
    if (highest) bumps.push({ id: rule._id, month: highest });
  }

  if (inserts.length > 0) {
    try {
      await Transaction.insertMany(inserts, { ordered: false });
    } catch (err) {
      // A concurrent materialisation may have inserted the same row first.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  await Promise.all(
    bumps.map((b) =>
      RecurringTransaction.updateOne(
        { _id: b.id },
        { $set: { lastPostedMonth: b.month } },
      ),
    ),
  );
};

// --- tags -----------------------------------------------------------------

export const listTags = (ownerId: string): Promise<FinanceTagDocument[]> =>
  FinanceTag.find({ ownerId: owner(ownerId) }).sort({ name: 1 });

export const createTag = (
  ownerId: string,
  input: { name: string; color?: string; monthlyBudget?: number | null },
): Promise<FinanceTagDocument> =>
  FinanceTag.create({
    ownerId: owner(ownerId),
    name: input.name.trim(),
    ...(input.color ? { color: input.color } : {}),
    ...(input.monthlyBudget !== undefined ? { monthlyBudget: input.monthlyBudget } : {}),
  });

export const getTagOrThrow = async (
  ownerId: string,
  id: string,
): Promise<FinanceTagDocument> => {
  const tag = await FinanceTag.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!tag) throw notFoundError('Tag not found');
  return tag;
};

export const updateTag = async (
  ownerId: string,
  id: string,
  patch: { name?: string; color?: string; monthlyBudget?: number | null },
): Promise<FinanceTagDocument> => {
  const tag = await getTagOrThrow(ownerId, id);
  if (patch.name !== undefined) tag.name = patch.name.trim();
  if (patch.color !== undefined) tag.color = patch.color;
  if (patch.monthlyBudget !== undefined) tag.monthlyBudget = patch.monthlyBudget;
  await tag.save();
  return tag;
};

export const deleteTag = async (ownerId: string, id: string): Promise<void> => {
  const tag = await getTagOrThrow(ownerId, id);
  await Transaction.updateMany(
    { ownerId: owner(ownerId), tagId: tag._id },
    { $set: { tagId: null } },
  );
  await tag.deleteOne();
};

/** Resolve tag-id strings, rejecting any that don't belong to the user. */
export const assertTagsExist = async (ownerId: string, ids: string[]): Promise<void> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await FinanceTag.countDocuments({
    _id: { $in: unique },
    ownerId: owner(ownerId),
  });
  if (found !== unique.length) throw notFoundError('One or more tags do not exist');
};

// --- transactions -------------------------------------------------------

interface Range {
  from: string;
  to: string;
}

export interface TransactionInput {
  title: string;
  amount: number;
  kind?: TransactionKind;
  date: string;
  tagId?: string | null;
}

export const listTransactions = async (
  ownerId: string,
  { from, to }: Range,
  today: string = todayUtc(),
): Promise<TransactionDocument[]> => {
  await materializeRecurring(ownerId, today);
  return Transaction.find({ ownerId: owner(ownerId), date: { $gte: from, $lte: to } })
    .sort({ date: -1, _id: -1 })
    .limit(2000);
};

export const createTransactions = async (
  ownerId: string,
  items: TransactionInput[],
): Promise<TransactionDocument[]> => {
  const tagIds = items
    .map((it) => it.tagId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  await assertTagsExist(ownerId, tagIds);

  return Transaction.insertMany(
    items.map((it) => ({
      ownerId: owner(ownerId),
      title: it.title.trim(),
      amount: round2(it.amount),
      kind: it.kind ?? 'spending',
      date: it.date,
      tagId: it.tagId ? new Types.ObjectId(it.tagId) : null,
    })),
  );
};

export const getTransactionOrThrow = async (
  ownerId: string,
  id: string,
): Promise<TransactionDocument> => {
  const txn = await Transaction.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!txn) throw notFoundError('Transaction not found');
  return txn;
};

export const updateTransaction = async (
  ownerId: string,
  id: string,
  patch: {
    title?: string;
    amount?: number;
    kind?: TransactionKind;
    date?: string;
    tagId?: string | null;
  },
): Promise<TransactionDocument> => {
  const txn = await getTransactionOrThrow(ownerId, id);
  if (
    txn.loan &&
    (patch.amount !== undefined || patch.kind !== undefined || patch.date !== undefined)
  ) {
    throw conflict('Use the loan endpoints to change a loan transaction');
  }
  if (patch.tagId) await assertTagsExist(ownerId, [patch.tagId]);

  if (patch.title !== undefined) txn.title = patch.title.trim();
  if (patch.amount !== undefined) txn.amount = round2(patch.amount);
  if (patch.kind !== undefined) txn.kind = patch.kind;
  if (patch.date !== undefined) txn.date = patch.date;
  if (patch.tagId !== undefined) {
    txn.tagId = patch.tagId ? new Types.ObjectId(patch.tagId) : null;
  }
  await txn.save();
  return txn;
};

export const deleteTransaction = async (ownerId: string, id: string): Promise<void> => {
  const txn = await getTransactionOrThrow(ownerId, id);
  await txn.deleteOne();
};

// --- analytics --------------------------------------------------------

export interface TagSpend {
  tagId: string | null;
  name: string;
  color: string;
  total: number;
  count: number;
  /** The tag's monthly budget, if it has one. */
  budget: number | null;
}

export interface FinanceSummary {
  from: string;
  to: string;
  totalSpending: number;
  totalEarning: number;
  net: number;
  count: number;
  byTag: TagSpend[];
  /** Money still owed *to* you across all open `lent` loans (not range-scoped). */
  lentOutstanding: number;
  /** Money you still owe across all open `borrowed` loans (not range-scoped). */
  borrowedOutstanding: number;
  /** How many loans are still open. */
  openLoanCount: number;
}

interface KindGroup {
  _id: TransactionKind;
  total: number;
  count: number;
}
interface TagGroup {
  _id: Types.ObjectId | null;
  total: number;
  count: number;
}

export const getSummary = async (
  ownerId: string,
  { from, to }: Range,
  today: string = todayUtc(),
): Promise<FinanceSummary> => {
  await materializeRecurring(ownerId, today);

  const [facet] = await Transaction.aggregate<{
    totals: KindGroup[];
    byTag: TagGroup[];
  }>([
    { $match: { ownerId: owner(ownerId), date: { $gte: from, $lte: to } } },
    {
      $facet: {
        // A settled loan's row is history — keep it out of the running totals.
        totals: [
          { $match: { $or: [{ loan: null }, { 'loan.status': 'open' }] } },
          { $group: { _id: '$kind', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ],
        // Lending isn't category spending — exclude every loan-backed row.
        byTag: [
          { $match: { kind: 'spending', loan: null } },
          { $group: { _id: '$tagId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ],
      },
    },
  ]);

  const loanBalances = await Transaction.aggregate<{
    _id: LoanDirection;
    total: number;
    count: number;
  }>([
    { $match: { ownerId: owner(ownerId), 'loan.status': 'open' } },
    {
      $group: {
        _id: '$loan.direction',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);
  const lentOutstanding = round2(loanBalances.find((b) => b._id === 'lent')?.total ?? 0);
  const borrowedOutstanding = round2(
    loanBalances.find((b) => b._id === 'borrowed')?.total ?? 0,
  );
  const openLoanCount = loanBalances.reduce((sum, b) => sum + b.count, 0);

  const totals = facet?.totals ?? [];
  const totalSpending = round2(totals.find((t) => t._id === 'spending')?.total ?? 0);
  const totalEarning = round2(totals.find((t) => t._id === 'earning')?.total ?? 0);
  const count = totals.reduce((sum, t) => sum + t.count, 0);

  const groups = facet?.byTag ?? [];
  const tagDocs = await FinanceTag.find({
    _id: { $in: groups.map((g) => g._id).filter((v): v is Types.ObjectId => v !== null) },
    ownerId: owner(ownerId),
  });
  const byId = new Map(tagDocs.map((t) => [String(t._id), t]));

  const byTag: TagSpend[] = groups.map((g) => {
    const tag = g._id === null ? null : byId.get(String(g._id));
    return {
      tagId: g._id === null ? null : String(g._id),
      name: tag?.name ?? UNTAGGED.name,
      color: tag?.color ?? UNTAGGED.color,
      total: round2(g.total),
      count: g.count,
      budget: tag?.monthlyBudget ?? null,
    };
  });

  return {
    from,
    to,
    totalSpending,
    totalEarning,
    net: round2(totalEarning - totalSpending),
    count,
    byTag,
    lentOutstanding,
    borrowedOutstanding,
    openLoanCount,
  };
};

// --- recurring rules ---------------------------------------------------

export interface RecurringInput {
  title: string;
  amount: number;
  kind?: TransactionKind;
  tagId?: string | null;
  dayOfMonth: number;
  active?: boolean;
}

export const listRecurring = (ownerId: string): Promise<RecurringTransactionDocument[]> =>
  RecurringTransaction.find({ ownerId: owner(ownerId) }).sort({ title: 1 });

export const getRecurringOrThrow = async (
  ownerId: string,
  id: string,
): Promise<RecurringTransactionDocument> => {
  const rule = await RecurringTransaction.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!rule) throw notFoundError('Recurring rule not found');
  return rule;
};

export const createRecurring = async (
  ownerId: string,
  input: RecurringInput,
  today: string = todayUtc(),
): Promise<RecurringTransactionDocument> => {
  if (input.tagId) await assertTagsExist(ownerId, [input.tagId]);
  const rule = await RecurringTransaction.create({
    ownerId: owner(ownerId),
    title: input.title.trim(),
    amount: round2(input.amount),
    kind: input.kind ?? 'spending',
    tagId: input.tagId ? new Types.ObjectId(input.tagId) : null,
    dayOfMonth: input.dayOfMonth,
    active: input.active ?? true,
  });
  await materializeRecurring(ownerId, today);
  return (await RecurringTransaction.findById(rule._id))!;
};

export const updateRecurring = async (
  ownerId: string,
  id: string,
  patch: Partial<RecurringInput>,
  today: string = todayUtc(),
): Promise<RecurringTransactionDocument> => {
  const rule = await getRecurringOrThrow(ownerId, id);
  if (patch.tagId) await assertTagsExist(ownerId, [patch.tagId]);

  if (patch.title !== undefined) rule.title = patch.title.trim();
  if (patch.amount !== undefined) rule.amount = round2(patch.amount);
  if (patch.kind !== undefined) rule.kind = patch.kind;
  if (patch.dayOfMonth !== undefined) rule.dayOfMonth = patch.dayOfMonth;
  if (patch.active !== undefined) rule.active = patch.active;
  if (patch.tagId !== undefined) {
    rule.tagId = patch.tagId ? new Types.ObjectId(patch.tagId) : null;
  }
  await rule.save();
  await materializeRecurring(ownerId, today);
  return (await RecurringTransaction.findById(id))!;
};

export const deleteRecurring = async (ownerId: string, id: string): Promise<void> => {
  const rule = await getRecurringOrThrow(ownerId, id);
  // The rows it already posted stay — they're real spending; just cut the link.
  await Transaction.updateMany(
    { ownerId: owner(ownerId), recurringId: rule._id },
    { $set: { recurringId: null } },
  );
  await rule.deleteOne();
};

// --- loans (money lent out / borrowed) -------------------------------

export interface LoanInput {
  counterparty: string;
  direction?: LoanDirection;
  amount: number;
  date: string;
  dueDate?: string | null;
  note?: string | null;
  tagId?: string | null;
  title?: string;
}

export interface LoanPatch {
  counterparty?: string;
  dueDate?: string | null;
  note?: string | null;
  tagId?: string | null;
  title?: string;
}

export interface LoanListFilter {
  status: 'open' | 'settled' | 'all';
  direction: LoanDirection | 'all';
}

const defaultLoanTitle = (direction: LoanDirection, counterparty: string): string =>
  `${direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${counterparty}`;

export const listLoans = (
  ownerId: string,
  { status, direction }: LoanListFilter,
): Promise<TransactionDocument[]> => {
  const query: Record<string, unknown> = {
    ownerId: owner(ownerId),
    loan: { $ne: null },
  };
  if (status !== 'all') query['loan.status'] = status;
  if (direction !== 'all') query['loan.direction'] = direction;
  return Transaction.find(query)
    .sort({ 'loan.status': 1, date: -1, _id: -1 })
    .limit(2000);
};

export const getLoanOrThrow = async (
  ownerId: string,
  id: string,
): Promise<TransactionDocument> => {
  const txn = await Transaction.findOne({
    _id: id,
    ownerId: owner(ownerId),
    loan: { $ne: null },
  });
  if (!txn) throw notFoundError('Loan not found');
  return txn;
};

export const createLoan = async (
  ownerId: string,
  input: LoanInput,
): Promise<TransactionDocument> => {
  if (input.tagId) await assertTagsExist(ownerId, [input.tagId]);
  const direction = input.direction ?? 'lent';
  const counterparty = input.counterparty.trim();
  const principal = round2(input.amount);

  return Transaction.create({
    ownerId: owner(ownerId),
    title: input.title?.trim() || defaultLoanTitle(direction, counterparty),
    amount: principal,
    kind: direction === 'lent' ? 'spending' : 'earning',
    date: input.date,
    tagId: input.tagId ? new Types.ObjectId(input.tagId) : null,
    loan: {
      counterparty,
      direction,
      principal,
      status: 'open',
      settledOn: null,
      dueDate: input.dueDate ?? null,
      note: input.note ?? null,
      repayments: [],
    },
  });
};

export const updateLoan = async (
  ownerId: string,
  id: string,
  patch: LoanPatch,
): Promise<TransactionDocument> => {
  const txn = await getLoanOrThrow(ownerId, id);
  if (patch.tagId) await assertTagsExist(ownerId, [patch.tagId]);
  const loan = txn.loan!;

  if (patch.counterparty !== undefined) loan.counterparty = patch.counterparty.trim();
  if (patch.dueDate !== undefined) loan.dueDate = patch.dueDate;
  if (patch.note !== undefined) loan.note = patch.note;
  if (patch.title !== undefined) txn.title = patch.title.trim();
  if (patch.tagId !== undefined) {
    txn.tagId = patch.tagId ? new Types.ObjectId(patch.tagId) : null;
  }
  txn.markModified('loan');
  await txn.save();
  return txn;
};

export const repayLoan = async (
  ownerId: string,
  id: string,
  input: { amount?: number; date?: string },
  today: string = todayUtc(),
): Promise<TransactionDocument> => {
  const txn = await getLoanOrThrow(ownerId, id);
  const loan = txn.loan!;
  if (loan.status === 'settled') throw conflict('Loan already settled');

  const outstanding = txn.amount;
  const pay = round2(input.amount ?? outstanding);
  if (pay <= 0) throw badRequest('Repayment amount must be positive');
  if (pay > outstanding) throw badRequest('Repayment exceeds the outstanding balance');

  const date = input.date ?? today;
  txn.amount = round2(outstanding - pay);
  loan.repayments.push({ amount: pay, date, at: new Date() });
  if (txn.amount <= 0) {
    txn.amount = 0;
    loan.status = 'settled';
    loan.settledOn = date;
  }
  txn.markModified('loan');
  await txn.save();
  return txn;
};

export const deleteLoan = async (ownerId: string, id: string): Promise<void> => {
  const txn = await getLoanOrThrow(ownerId, id);
  // Cancelling a loan removes the whole row — it never really moved money.
  await txn.deleteOne();
};
