import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { FinanceTag, type FinanceTagDocument } from '../models/financeTag.model.ts';
import {
  Transaction,
  type TransactionDocument,
  type TransactionKind,
} from '../models/transaction.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const UNTAGGED = { name: 'Untagged', color: '#6f6d65' } as const;

// --- tags -----------------------------------------------------------------

export const listTags = (ownerId: string): Promise<FinanceTagDocument[]> =>
  FinanceTag.find({ ownerId: owner(ownerId) }).sort({ name: 1 });

export const createTag = (
  ownerId: string,
  input: { name: string; color?: string },
): Promise<FinanceTagDocument> =>
  FinanceTag.create({
    ownerId: owner(ownerId),
    name: input.name.trim(),
    ...(input.color ? { color: input.color } : {}),
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
  patch: { name?: string; color?: string },
): Promise<FinanceTagDocument> => {
  const tag = await getTagOrThrow(ownerId, id);
  if (patch.name !== undefined) tag.name = patch.name.trim();
  if (patch.color !== undefined) tag.color = patch.color;
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

export const listTransactions = (
  ownerId: string,
  { from, to }: Range,
): Promise<TransactionDocument[]> =>
  Transaction.find({ ownerId: owner(ownerId), date: { $gte: from, $lte: to } })
    .sort({ date: -1, _id: -1 })
    .limit(2000);

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
}

export interface FinanceSummary {
  from: string;
  to: string;
  totalSpending: number;
  totalEarning: number;
  net: number;
  count: number;
  byTag: TagSpend[];
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
): Promise<FinanceSummary> => {
  const [facet] = await Transaction.aggregate<{
    totals: KindGroup[];
    byTag: TagGroup[];
  }>([
    { $match: { ownerId: owner(ownerId), date: { $gte: from, $lte: to } } },
    {
      $facet: {
        totals: [
          { $group: { _id: '$kind', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ],
        byTag: [
          { $match: { kind: 'spending' } },
          { $group: { _id: '$tagId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ],
      },
    },
  ]);

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
  };
};
