import { Types } from 'mongoose';

import { badRequest, conflict, notFoundError } from '../errors.ts';
import { type PublicUser, toPublicUser } from '../lib/publicUser.ts';
import { Entry, type EntryKind } from '../models/entry.model.ts';
import {
  Thought,
  type ThoughtDocument,
  type ThoughtStatus,
} from '../models/thought.model.ts';
import { User } from '../models/user.model.ts';
import { escapeRegExp } from '../schemas/common.ts';
import {
  acceptedThoughtIdsFor,
  assertParticipant,
  type ThoughtRole,
} from './thoughtShare.service.ts';

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

/** A list row plus how the caller relates to it. */
export type ThoughtListItem = Record<string, unknown> & {
  role: ThoughtRole;
  sharedBy?: PublicUser;
};

export interface ThoughtListPage {
  items: ThoughtListItem[];
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

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

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
  ownerId: string,
  input: CreateThoughtInput,
): Promise<ThoughtDocument> =>
  Thought.create({
    ownerId: owner(ownerId),
    title: input.title,
    description: input.description ?? '',
    tags: normalizeTags(input.tags),
  });

/** Not-found (never 403) when the thought exists but belongs to someone else. */
export const getThoughtOrThrow = async (
  id: string,
  ownerId: string,
): Promise<ThoughtDocument> => {
  const thought = await Thought.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!thought) throw notFoundError('Thought not found');
  return thought;
};

/** Read a thought as the owner or an accepted collaborator; carries `role`. */
export const getThoughtForReader = async (
  id: string,
  userId: string,
): Promise<ThoughtListItem> => {
  const { thought, role } = await assertParticipant(id, userId);
  const json = thought.toJSON() as unknown as Record<string, unknown>;
  if (role === 'owner') return { ...json, role };
  const foreignOwner = await User.findById(thought.ownerId);
  return {
    ...json,
    role,
    ...(foreignOwner ? { sharedBy: toPublicUser(foreignOwner) } : {}),
  };
};

export const listThoughts = async (
  userId: string,
  params: ListThoughtsParams,
): Promise<ThoughtListPage> => {
  const sharedIds = await acceptedThoughtIdsFor(userId);

  const filter: Record<string, unknown> = {
    $or: [{ ownerId: owner(userId) }, { _id: { $in: sharedIds } }],
  };

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

  const [docs, total] = await Promise.all([
    Thought.find(filter).sort(SORT_SPECS[params.sort]).skip(skip).limit(params.limit),
    Thought.countDocuments(filter),
  ]);

  // Decorate shared rows with their owner (for a "shared by @x" hint).
  const foreignOwnerIds = docs
    .filter((d) => String(d.ownerId) !== userId)
    .map((d) => d.ownerId);
  const owners = foreignOwnerIds.length
    ? await User.find({ _id: { $in: foreignOwnerIds } })
    : [];
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));

  const items: ThoughtListItem[] = docs.map((doc) => {
    const json = doc.toJSON() as unknown as Record<string, unknown>;
    if (String(doc.ownerId) === userId) return { ...json, role: 'owner' };
    const foreignOwner = ownerById.get(String(doc.ownerId));
    return {
      ...json,
      role: 'collaborator',
      ...(foreignOwner ? { sharedBy: toPublicUser(foreignOwner) } : {}),
    };
  });

  return {
    items,
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
};

export const listTrashedThoughts = async (
  ownerId: string,
  params: { page: number; limit: number },
): Promise<ThoughtListResult> => {
  const filter = { ownerId: owner(ownerId), deletedAt: { $ne: null } };
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
  ownerId: string,
  patch: { title?: string; description?: string },
): Promise<ThoughtDocument> => {
  const thought = await getThoughtOrThrow(id, ownerId);
  if (patch.title !== undefined) thought.title = patch.title;
  if (patch.description !== undefined) thought.description = patch.description;
  await thought.save();
  return thought;
};

export const setThoughtStatus = async (
  id: string,
  ownerId: string,
  status: ThoughtStatus,
): Promise<ThoughtDocument> => {
  const thought = await getThoughtOrThrow(id, ownerId);
  thought.status = status;
  await thought.save();
  return thought;
};

export const softDeleteThought = async (id: string, ownerId: string): Promise<void> => {
  const thought = await getThoughtOrThrow(id, ownerId);
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

export const restoreThought = async (
  id: string,
  ownerId: string,
): Promise<ThoughtDocument> => {
  const thought = await Thought.findOne({ _id: id, ownerId: owner(ownerId) }).setOptions({
    withDeleted: true,
  });
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

export const getThoughtStats = async (
  id: string,
  userId: string,
): Promise<ThoughtStats> => {
  const { thought } = await assertParticipant(id, userId);
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
