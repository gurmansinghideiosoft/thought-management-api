import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import {
  JournalEntry,
  type JournalContent,
  type JournalEntryDocument,
} from '../models/journal.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export interface JournalPatch {
  title?: string;
  content?: JournalContent;
  excerpt?: string;
  wordCount?: number;
}

export interface JournalListPage {
  items: JournalEntryDocument[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Newest day first, keyset-paginated on `(date, _id)`. */
export const listJournal = async (
  ownerId: string,
  params: { cursor?: string; limit: number },
): Promise<JournalListPage> => {
  const filter: Record<string, unknown> = { ownerId: owner(ownerId) };

  if (params.cursor) {
    const pos = decodeCursor(params.cursor);
    // The cursor encodes the boundary day as midnight-UTC; `date` strings sort
    // lexically like dates, so a plain string compare is the keyset.
    const boundaryDay = pos.createdAt.toISOString().slice(0, 10);
    filter.$or = [
      { date: { $lt: boundaryDay } },
      { date: boundaryDay, _id: { $lt: new Types.ObjectId(pos.id) } },
    ];
  }

  const docs = await JournalEntry.find(filter)
    .sort({ date: -1, _id: -1 })
    .limit(params.limit + 1);

  const hasMore = docs.length > params.limit;
  const items = hasMore ? docs.slice(0, params.limit) : docs;
  const last = items.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor(new Date(`${last.date}T00:00:00.000Z`), String(last._id))
      : null;

  return { items, hasMore, nextCursor };
};

export const getJournalByIdOrThrow = async (
  ownerId: string,
  id: string,
): Promise<JournalEntryDocument> => {
  const entry = await JournalEntry.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!entry) throw notFoundError('Journal entry not found');
  return entry;
};

export const getJournalByDate = async (
  ownerId: string,
  date: string,
): Promise<JournalEntryDocument> => {
  const entry = await JournalEntry.findOne({ ownerId: owner(ownerId), date });
  if (!entry) throw notFoundError('No journal entry for that day');
  return entry;
};

/** Open (or start) the entry for a day. */
export const upsertJournalByDate = async (
  ownerId: string,
  date: string,
  patch: JournalPatch,
): Promise<JournalEntryDocument> => {
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.excerpt !== undefined) set.excerpt = patch.excerpt;
  if (patch.wordCount !== undefined) set.wordCount = patch.wordCount;

  const entry = await JournalEntry.findOneAndUpdate(
    { ownerId: owner(ownerId), date },
    {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      $setOnInsert: { ownerId: owner(ownerId), date },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  // `upsert: true` always returns a doc.
  return entry as JournalEntryDocument;
};

export const updateJournal = async (
  ownerId: string,
  id: string,
  patch: JournalPatch,
): Promise<JournalEntryDocument> => {
  const entry = await getJournalByIdOrThrow(ownerId, id);
  if (patch.title !== undefined) entry.title = patch.title;
  if (patch.content !== undefined) entry.content = patch.content;
  if (patch.excerpt !== undefined) entry.excerpt = patch.excerpt;
  if (patch.wordCount !== undefined) entry.wordCount = patch.wordCount;
  await entry.save();
  return entry;
};

export const deleteJournal = async (ownerId: string, id: string): Promise<void> => {
  const entry = await getJournalByIdOrThrow(ownerId, id);
  await JournalEntry.updateOne(
    { _id: entry._id },
    { $set: { deletedAt: new Date(), deletedReason: 'direct' } },
  );
};
