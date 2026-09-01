import { Types } from 'mongoose';

import { badRequest, notFoundError } from '../errors.ts';
import { decodeCursor, encodeCursor, keysetClause, keysetSort } from '../lib/cursor.ts';
import {
  Entry,
  type EntryDocument,
  type EntryFile,
  type EntryKind,
  type EntryLink,
} from '../models/entry.model.ts';
import { Thought, type ThoughtDocument } from '../models/thought.model.ts';
import { getThoughtOrThrow } from './thought.service.ts';
import { assertParticipant } from './thoughtShare.service.ts';
import { downloadUrlFor } from './upload.service.ts';

// --- helpers ---------------------------------------------------------------

/** Map tag-id strings to ObjectIds, rejecting any not defined on the thought. */
const toTagObjectIds = (
  thought: ThoughtDocument,
  ids: string[] | undefined,
): Types.ObjectId[] => {
  if (!ids || ids.length === 0) return [];
  const known = new Set(thought.tags.map((tag) => String(tag._id)));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw badRequest(`Unknown tag id(s): ${unknown.join(', ')}`);
  }
  return [...new Set(ids)].map((id) => new Types.ObjectId(id));
};

/** Recompute `entryCount` / `lastEntryAt` from the entries themselves. */
const syncThoughtCounters = async (thoughtId: Types.ObjectId): Promise<void> => {
  const rows = (await Entry.aggregate([
    { $match: { thoughtId, deletedAt: null } },
    { $group: { _id: null, count: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ])) as { count: number; last: Date | null }[];
  const agg = rows[0];
  await Thought.updateOne(
    { _id: thoughtId },
    { $set: { entryCount: agg?.count ?? 0, lastEntryAt: agg?.last ?? null } },
  );
};

export const getEntryOrThrow = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
): Promise<EntryDocument> => {
  const entry = await Entry.findOne({
    _id: entryId,
    thoughtId,
    ownerId: new Types.ObjectId(ownerId),
  });
  if (!entry) throw notFoundError('Entry not found');
  return entry;
};

// --- reads ---------------------------------------------------------------

export interface TimelineParams {
  before?: string;
  after?: string;
  limit: number;
  tagId?: string;
  starred?: boolean;
  kind?: EntryKind;
  q?: string;
}

export interface TimelinePage {
  /** Ascending by `createdAt` — oldest first, like a chat transcript. */
  items: EntryDocument[];
  /** Whether more entries exist in the direction just travelled. */
  hasMore: boolean;
  /** Pass back as `before` (default) or `after` to continue in that direction. */
  nextCursor: string | null;
}

export const listTimeline = async (
  thoughtId: string,
  userId: string,
  params: TimelineParams,
): Promise<TimelinePage> => {
  // Owner or accepted collaborator — the entry rows themselves carry the
  // thought owner's id, so scope by `thoughtId` only once past this gate.
  await assertParticipant(thoughtId, userId);

  const base: Record<string, unknown> = {
    thoughtId: new Types.ObjectId(thoughtId),
    deletedAt: null,
  };
  if (params.tagId) base.tagIds = new Types.ObjectId(params.tagId);
  if (params.starred !== undefined) base.starred = params.starred;
  if (params.kind) base.kind = params.kind;
  if (params.q && params.q.trim() !== '') {
    base.$text = { $search: params.q.trim() };
  }

  const direction = params.after ? 'after' : 'before';
  const cursor = params.after ?? params.before;

  let filter: Record<string, unknown> = base;
  if (cursor) {
    const pos = decodeCursor(cursor);
    filter = {
      $and: [
        base,
        keysetClause(direction, {
          createdAt: pos.createdAt,
          id: new Types.ObjectId(pos.id),
        }),
      ],
    };
  }

  const docs = await Entry.find(filter)
    .sort(keysetSort(direction))
    .limit(params.limit + 1);

  const hasMore = docs.length > params.limit;
  const page = hasMore ? docs.slice(0, params.limit) : docs;
  const items = direction === 'before' ? [...page].reverse() : page;

  let nextCursor: string | null = null;
  if (hasMore) {
    const boundary = direction === 'before' ? items.at(0) : items.at(-1);
    if (boundary) nextCursor = encodeCursor(boundary.createdAt, String(boundary._id));
  }

  return { items, hasMore, nextCursor };
};

export const getEntryDetail = async (
  thoughtId: string,
  userId: string,
  entryId: string,
): Promise<{ entry: EntryDocument; downloadUrl: string | null }> => {
  await assertParticipant(thoughtId, userId);
  const entry = await Entry.findOne({ _id: entryId, thoughtId });
  if (!entry) throw notFoundError('Entry not found');
  const downloadUrl =
    entry.kind === 'file' && entry.file ? await downloadUrlFor(entry.file) : null;
  return { entry, downloadUrl };
};

// --- writes ------------------------------------------------------------

export interface AddEntryInput {
  kind: EntryKind;
  body?: string;
  link?: EntryLink;
  file?: EntryFile;
  tagIds?: string[];
  starred?: boolean;
}

export const addEntry = async (
  thoughtId: string,
  ownerId: string,
  input: AddEntryInput,
): Promise<EntryDocument> => {
  const thought = await getThoughtOrThrow(thoughtId, ownerId);

  const doc: Record<string, unknown> = {
    thoughtId: thought._id,
    ownerId: thought.ownerId,
    kind: input.kind,
    body: input.body ?? '',
    tagIds: toTagObjectIds(thought, input.tagIds),
    starred: input.starred ?? false,
  };

  if (input.kind === 'note') {
    if ((input.body ?? '').trim() === '') {
      throw badRequest('body is required for note entries');
    }
  } else if (input.kind === 'link') {
    if (!input.link?.url) throw badRequest('link.url is required for link entries');
    doc.link = input.link;
  } else {
    if (!input.file) throw badRequest('file is required for file entries');
    doc.file = input.file;
  }

  const entry = await Entry.create(doc);
  await Thought.updateOne(
    { _id: thought._id },
    { $inc: { entryCount: 1 }, $max: { lastEntryAt: entry.createdAt } },
  );
  return entry;
};

export const updateEntry = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
  patch: { body?: string; link?: EntryLink; tagIds?: string[] },
): Promise<EntryDocument> => {
  const entry = await getEntryOrThrow(thoughtId, ownerId, entryId);

  if (patch.body !== undefined) entry.body = patch.body;
  if (patch.link !== undefined) {
    if (entry.kind !== 'link') throw badRequest('Only link entries have a link');
    entry.link = patch.link;
  }
  if (patch.tagIds !== undefined) {
    const thought = await getThoughtOrThrow(thoughtId, ownerId);
    entry.tagIds = toTagObjectIds(thought, patch.tagIds);
  }

  await entry.save();
  return entry;
};

export const setEntryStarred = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
  starred: boolean,
): Promise<EntryDocument> => {
  const entry = await getEntryOrThrow(thoughtId, ownerId, entryId);
  entry.starred = starred;
  await entry.save();
  return entry;
};

export const attachTag = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
  tagId: string,
): Promise<EntryDocument> => {
  const thought = await getThoughtOrThrow(thoughtId, ownerId);
  toTagObjectIds(thought, [tagId]); // validates the tag exists
  const entry = await getEntryOrThrow(thoughtId, ownerId, entryId);
  await Entry.updateOne(
    { _id: entry._id },
    { $addToSet: { tagIds: new Types.ObjectId(tagId) } },
  );
  return getEntryOrThrow(thoughtId, ownerId, entryId);
};

export const detachTag = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
  tagId: string,
): Promise<EntryDocument> => {
  const entry = await getEntryOrThrow(thoughtId, ownerId, entryId);
  await Entry.updateOne(
    { _id: entry._id },
    { $pull: { tagIds: new Types.ObjectId(tagId) } },
  );
  return getEntryOrThrow(thoughtId, ownerId, entryId);
};

export const softDeleteEntry = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
): Promise<void> => {
  const entry = await getEntryOrThrow(thoughtId, ownerId, entryId);
  await Entry.updateOne(
    { _id: entry._id },
    { $set: { deletedAt: new Date(), deletedReason: 'direct' } },
  );
  await syncThoughtCounters(entry.thoughtId);
};

export const restoreEntry = async (
  thoughtId: string,
  ownerId: string,
  entryId: string,
): Promise<EntryDocument> => {
  const entry = await Entry.findOne({
    _id: entryId,
    thoughtId,
    ownerId: new Types.ObjectId(ownerId),
  }).setOptions({ withDeleted: true });
  if (!entry) throw notFoundError('Entry not found');
  if (entry.deletedAt === null) throw badRequest('Entry is not deleted');

  await Entry.updateOne(
    { _id: entry._id },
    { $set: { deletedAt: null, deletedReason: null } },
  );
  await syncThoughtCounters(entry.thoughtId);
  return getEntryOrThrow(thoughtId, ownerId, entryId);
};

/** Remove a tag id from every entry of a thought (used when a tag is deleted). */
export const pullTagFromEntries = async (
  thoughtId: string,
  tagId: string,
): Promise<void> => {
  await Entry.updateMany(
    { thoughtId: new Types.ObjectId(thoughtId) },
    { $pull: { tagIds: new Types.ObjectId(tagId) } },
  );
};
