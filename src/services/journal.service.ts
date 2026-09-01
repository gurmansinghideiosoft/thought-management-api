import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { addDays, monthBounds, todayUtc } from '../lib/day.ts';
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

// --- streak & calendar -------------------------------------------------

export interface JournalStreak {
  /** Consecutive days written, ending today (or yesterday if not yet written). */
  current: number;
  /** Longest run of consecutive days ever written. */
  longest: number;
  /** Whether `today` already has an entry. */
  writtenToday: boolean;
}

/**
 * The writing streak. `today` (client-local `YYYY-MM-DD`) keeps "wrote today"
 * and "streak still alive" correct across time zones; defaults to server UTC.
 */
export const getStreak = async (
  ownerId: string,
  today: string = todayUtc(),
): Promise<JournalStreak> => {
  const rows = await JournalEntry.find({ ownerId: owner(ownerId) })
    .select('date')
    .sort({ date: -1 });
  // Unique days, newest first (the partial-unique index already dedupes, but be safe).
  const days = [...new Set(rows.map((r) => r.date))];
  if (days.length === 0) return { current: 0, longest: 0, writtenToday: false };

  const writtenToday = days[0] === today;
  const yesterday = addDays(today, -1);

  let current = 0;
  let anchor: string | null = null;
  if (days[0] === today) anchor = today;
  else if (days[0] === yesterday) anchor = yesterday;
  if (anchor) {
    let expect = anchor;
    for (const day of days) {
      if (day === expect) {
        current += 1;
        expect = addDays(expect, -1);
      } else if (day < expect) {
        break;
      }
    }
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] === addDays(days[i - 1]!, -1)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  return { current, longest, writtenToday };
};

/** The days of `month` (`YYYY-MM`) that have an entry. */
export const getMonthDates = async (
  ownerId: string,
  month: string,
): Promise<string[]> => {
  const { from, to } = monthBounds(month);
  const rows = await JournalEntry.find({
    ownerId: owner(ownerId),
    date: { $gte: from, $lte: to },
  })
    .select('date')
    .sort({ date: 1 });
  return rows.map((r) => r.date);
};
