import { Types } from 'mongoose';

import { badRequest, conflict, notFoundError } from '../errors.ts';
import { escapeRegExp } from '../schemas/common.ts';
import { Entry, type EntryKind } from '../models/entry.model.ts';
import {
  Thought,
  type ThoughtDocument,
  type ThoughtStatus,
} from '../models/thought.model.ts';

export type ThoughtSort = 'recent' | 'created' | 'oldest' | 'title';

interface TagInput {
  name: string;
  color?: string;
}

export interface CreateThoughtInput {
  title: string;
  description?: string;
  tags?: TagInput[];
}

export interface ListThoughtsParams {
  q?: string;
  status?: ThoughtStatus;
  createdFrom?: Date;
  createdTo?: Date;
  sort: ThoughtSort;
  page: number;
  limit: number;
}

export interface ThoughtListResult {
  items: ThoughtDocument[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const SORT_SPECS: Record<ThoughtSort, Record<string, 1 | -1>> = {
  recent: { lastEntryAt: -1, _id: -1 },
  created: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  title: { title: 1, _id: 1 },
};

/** Reject duplicate tag names (case-insensitive) within one create call. */
const normalizeTags = (tags: TagInput[] | undefined): TagInput[] => {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const key = tag.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw conflict(`Duplicate tag name: "${tag.name}"`);
    }
    seen.add(key);
  }
  return tags.map((tag) => ({
    name: tag.name.trim(),
    ...(tag.color ? { color: tag.color } : {}),
  }));
};

export const createThought = async (
  input: CreateThoughtInput,
): Promise<ThoughtDocument> => {
  return Thought.create({
    title: input.title,
    description: input.description ?? '',
    tags: normalizeTags(input.tags),
  });
};

export const getThoughtOrThrow = async (id: string): Promise<ThoughtDocument> => {
  const thought = await Thought.findById(id);
  if (!thought) throw notFoundError('Thought not found');
  return thought;
};

export const listThoughts = async (
  params: ListThoughtsParams,
): Promise<ThoughtListResult> => {
  const filter: Record<string, unknown> = {};

  if (params.status) filter.status = params.status;

  if (params.q && params.q.trim() !== '') {
    filter.title = { $regex: escapeRegExp(params.q.trim()), $options: 'i' };
  }

  if (params.createdFrom || params.createdTo) {
    filter.createdAt = {
      ...(params.createdFrom ? { $gte: params.createdFrom } : {}),
      ...(params.createdTo ? { $lte: params.createdTo } : {}),
    };
  }

  const skip = (params.page - 1) * params.limit;

  const [items, total] = await Promise.all([
    Thought.find(filter).sort(SORT_SPECS[params.sort]).skip(skip).limit(params.limit),
    Thought.countDocuments(filter),
  ]);

  return {
    items,
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
};

export const listTrashedThoughts = async (params: {
  page: number;
  limit: number;
}): Promise<ThoughtListResult> => {
  const filter = { deletedAt: { $ne: null } };
  const skip = (params.page - 1) * params.limit;

  const [items, total] = await Promise.all([
    Thought.find(filter)
      .setOptions({ withDeleted: true })
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(params.limit),
    Thought.find(filter).setOptions({ withDeleted: true }).countDocuments(),
  ]);

  return {
    items,
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
};

export const updateThought = async (
  id: string,
  patch: { title?: string; description?: string },
): Promise<ThoughtDocument> => {
  const thought = await getThoughtOrThrow(id);
  if (patch.title !== undefined) thought.title = patch.title;
  if (patch.description !== undefined) thought.description = patch.description;
  await thought.save();
  return thought;
};

export const setThoughtStatus = async (
  id: string,
  status: ThoughtStatus,
): Promise<ThoughtDocument> => {
  const thought = await getThoughtOrThrow(id);
  thought.status = status;
  await thought.save();
  return thought;
};

export const softDeleteThought = async (id: string): Promise<void> => {
  const thought = await getThoughtOrThrow(id);
  const now = new Date();

  await Entry.updateMany(
    { thoughtId: thought._id, deletedAt: null },
    { $set: { deletedAt: now, deletedReason: 'cascade' } },
  );
  await Thought.updateOne(
    { _id: thought._id },
    { $set: { deletedAt: now, deletedReason: 'direct' } },
  );
};

export const restoreThought = async (id: string): Promise<ThoughtDocument> => {
  const thought = await Thought.findById(id).setOptions({ withDeleted: true });
  if (!thought) throw notFoundError('Thought not found');
  if (thought.deletedAt === null) {
    throw badRequest('Thought is not deleted');
  }

  // Restore only the entries that were removed *with* this thought.
  // (update queries aren't filtered by the soft-delete plugin, so these reach
  // the deleted rows directly.)
  await Entry.updateMany(
    { thoughtId: thought._id, deletedReason: 'cascade' },
    { $set: { deletedAt: null, deletedReason: null } },
  );
  await Thought.updateOne(
    { _id: thought._id },
    { $set: { deletedAt: null, deletedReason: null } },
  );

  const restored = await Thought.findById(thought._id);
  if (!restored) throw notFoundError('Thought not found');
  return restored;
};

export interface ThoughtStats {
  totalEntries: number;
  starredEntries: number;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  byKind: Record<EntryKind, number>;
  byTag: { tagId: string; name: string; count: number }[];
}

export const getThoughtStats = async (id: string): Promise<ThoughtStats> => {
  const thought = await getThoughtOrThrow(id);
  const thoughtId = thought._id;

  const [result] = (await Entry.aggregate([
    { $match: { thoughtId, deletedAt: null } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              starred: { $sum: { $cond: ['$starred', 1, 0] } },
              first: { $min: '$createdAt' },
              last: { $max: '$createdAt' },
            },
          },
        ],
        byKind: [{ $group: { _id: '$kind', count: { $sum: 1 } } }],
        byTag: [
          { $unwind: '$tagIds' },
          { $group: { _id: '$tagIds', count: { $sum: 1 } } },
        ],
      },
    },
  ])) as [
    {
      totals: { total: number; starred: number; first: Date | null; last: Date | null }[];
      byKind: { _id: EntryKind; count: number }[];
      byTag: { _id: Types.ObjectId; count: number }[];
    },
  ];

  const totals = result.totals[0] ?? {
    total: 0,
    starred: 0,
    first: null,
    last: null,
  };

  const byKind: Record<EntryKind, number> = { note: 0, link: 0, file: 0 };
  for (const row of result.byKind) byKind[row._id] = row.count;

  const tagNameById = new Map(thought.tags.map((tag) => [String(tag._id), tag.name]));
  const byTag = result.byTag
    .map((row) => ({
      tagId: String(row._id),
      name: tagNameById.get(String(row._id)) ?? '(deleted tag)',
      count: row.count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEntries: totals.total,
    starredEntries: totals.starred,
    firstEntryAt: totals.first,
    lastEntryAt: totals.last,
    byKind,
    byTag,
  };
};
