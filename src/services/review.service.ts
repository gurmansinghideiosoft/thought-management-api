import { Types } from 'mongoose';

import {
  addDays,
  isoWeekKey,
  monthBounds,
  monthKey,
  todayUtc,
  weekBounds,
} from '../lib/day.ts';
import { Capture } from '../models/capture.model.ts';
import { Entry } from '../models/entry.model.ts';
import { Habit } from '../models/habit.model.ts';
import { HabitEntry } from '../models/habitEntry.model.ts';
import { JournalEntry } from '../models/journal.model.ts';
import {
  Review,
  type ReviewDocument,
  type ReviewPeriod,
} from '../models/review.model.ts';
import { Task } from '../models/task.model.ts';
import { Thought } from '../models/thought.model.ts';
import { getSummary } from './finance.service.ts';
import { isDone } from './habit.service.ts';
import { getStreak } from './journal.service.ts';

const owner = (id: string): Types.ObjectId => new Types.ObjectId(id);

interface Range {
  from: string;
  to: string;
}

const boundsFor = (period: ReviewPeriod, anchor: string): Range =>
  period === 'week' ? weekBounds(anchor) : monthBounds(monthKey(anchor));

const keyFor = (period: ReviewPeriod, anchor: string): string =>
  period === 'week' ? isoWeekKey(anchor) : monthKey(anchor);

/** Midnight-UTC … end-of-day-UTC `Date`s for a `YYYY-MM-DD` range. */
const asDates = ({ from, to }: Range): { start: Date; end: Date } => ({
  start: new Date(`${from}T00:00:00.000Z`),
  end: new Date(`${to}T23:59:59.999Z`),
});

/** Inclusive day count between two `YYYY-MM-DD` strings. */
const dayCount = (from: string, to: string): number =>
  to < from ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export interface SavedReview {
  intentions: string;
  reflection: string;
  rating: number | null;
  completedAt: Date | null;
}

export interface ReviewSummary {
  period: ReviewPeriod;
  periodKey: string;
  range: Range;
  prevRange: Range;
  isCurrent: boolean;
  tasks: {
    done: number;
    donePrev: number;
    open: number;
    list: { content: string; date: string | null; priority: number }[];
  };
  journal: {
    written: number;
    writtenPrev: number;
    words: number;
    streak: { current: number; longest: number };
    list: { id: string; date: string; title: string; excerpt: string }[];
  };
  finance: {
    totalSpending: number;
    totalEarning: number;
    net: number;
    spendingPrev: number;
    byTag: { tagId: string | null; name: string; color: string; total: number }[];
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
    items: {
      name: string;
      color: string;
      done: number;
      possible: number;
      rate: number;
    }[];
  };
  captures: { created: number; processed: number };
  saved: SavedReview | null;
  prevReview: SavedReview | null;
  completedStreak: number;
}

const project = (r: ReviewDocument | null): SavedReview | null =>
  r
    ? {
        intentions: r.intentions,
        reflection: r.reflection,
        rating: r.rating,
        completedAt: r.completedAt,
      }
    : null;

const summariseTasks = async (
  ownerId: string,
  range: Range,
  prev: Range,
): Promise<ReviewSummary['tasks']> => {
  const inRange = { $gte: range.from, $lte: range.to };
  const [done, donePrev, open, list] = await Promise.all([
    Task.countDocuments({ ownerId: owner(ownerId), date: inRange, status: 'done' }),
    Task.countDocuments({
      ownerId: owner(ownerId),
      date: { $gte: prev.from, $lte: prev.to },
      status: 'done',
    }),
    Task.countDocuments({ ownerId: owner(ownerId), date: inRange, status: 'pending' }),
    Task.find({ ownerId: owner(ownerId), date: inRange, status: 'done' })
      .sort({ date: -1, priority: 1 })
      .limit(8)
      .select('content date priority'),
  ]);
  return {
    done,
    donePrev,
    open,
    list: list.map((t) => ({ content: t.content, date: t.date, priority: t.priority })),
  };
};

const summariseJournal = async (
  ownerId: string,
  range: Range,
  prev: Range,
  today: string,
): Promise<ReviewSummary['journal']> => {
  const [entries, writtenPrev, streak] = await Promise.all([
    JournalEntry.find({
      ownerId: owner(ownerId),
      date: { $gte: range.from, $lte: range.to },
    })
      .sort({ date: -1 })
      .select('date title excerpt wordCount'),
    JournalEntry.countDocuments({
      ownerId: owner(ownerId),
      date: { $gte: prev.from, $lte: prev.to },
    }),
    getStreak(ownerId, today),
  ]);
  return {
    written: entries.length,
    writtenPrev,
    words: entries.reduce((sum, e) => sum + (e.wordCount ?? 0), 0),
    streak: { current: streak.current, longest: streak.longest },
    list: entries.map((e) => ({
      id: String(e._id),
      date: e.date,
      title: e.title,
      excerpt: e.excerpt,
    })),
  };
};

const summariseFinance = async (
  ownerId: string,
  range: Range,
  prev: Range,
  today: string,
): Promise<ReviewSummary['finance']> => {
  const [now, before] = await Promise.all([
    getSummary(ownerId, range, today),
    getSummary(ownerId, prev, today),
  ]);
  return {
    totalSpending: now.totalSpending,
    totalEarning: now.totalEarning,
    net: now.net,
    spendingPrev: before.totalSpending,
    byTag: now.byTag.slice(0, 5).map((t) => ({
      tagId: t.tagId,
      name: t.name,
      color: t.color,
      total: t.total,
    })),
  };
};

const countEntries = async (ownerId: string, range: Range): Promise<number> => {
  const { start, end } = asDates(range);
  const [row] = await Entry.aggregate<{ count: number }>([
    {
      $match: {
        ownerId: owner(ownerId),
        deletedAt: null,
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $count: 'count' },
  ]);
  return row?.count ?? 0;
};

const summariseThoughts = async (
  ownerId: string,
  range: Range,
  prev: Range,
): Promise<ReviewSummary['thoughts']> => {
  const { start, end } = asDates(range);
  const grouped = await Entry.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        ownerId: owner(ownerId),
        deletedAt: null,
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: '$thoughtId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const top = grouped.slice(0, 8);
  const docs = await Thought.find({ _id: { $in: top.map((g) => g._id) } })
    .setOptions({ withDeleted: true })
    .select('title');
  const titleById = new Map(docs.map((d) => [String(d._id), d.title]));

  return {
    entriesAdded: grouped.reduce((sum, g) => sum + g.count, 0),
    entriesAddedPrev: await countEntries(ownerId, prev),
    touched: grouped.length,
    list: top.map((g) => ({
      id: String(g._id),
      title: titleById.get(String(g._id)) ?? 'Untitled',
      count: g.count,
    })),
  };
};

interface HabitRollup {
  overallRate: number;
  items: ReviewSummary['habits']['items'];
}

const rollupHabits = async (
  ownerId: string,
  range: Range,
  today: string,
): Promise<HabitRollup> => {
  const habits = await Habit.find({ ownerId: owner(ownerId), archived: false }).sort({
    position: 1,
    createdAt: 1,
  });
  const cappedTo = range.to < today ? range.to : today;
  const possible = dayCount(range.from, cappedTo);
  if (habits.length === 0) return { overallRate: 0, items: [] };

  const entries = await HabitEntry.find({
    ownerId: owner(ownerId),
    habitId: { $in: habits.map((h) => h._id) },
    date: { $gte: range.from, $lte: cappedTo },
  }).select('habitId date value');

  const doneByHabit = new Map<string, number>();
  for (const e of entries) {
    const habit = habits.find((h) => String(h._id) === String(e.habitId));
    if (habit && isDone(habit, e.value)) {
      doneByHabit.set(String(e.habitId), (doneByHabit.get(String(e.habitId)) ?? 0) + 1);
    }
  }

  const items = habits.map((h) => {
    const done = doneByHabit.get(String(h._id)) ?? 0;
    return {
      name: h.name,
      color: h.color,
      done,
      possible,
      rate: possible > 0 ? done / possible : 0,
    };
  });
  const totalDone = items.reduce((sum, i) => sum + i.done, 0);
  const overallRate = possible > 0 ? totalDone / (possible * habits.length) : 0;
  return { overallRate, items };
};

const summariseCaptures = async (
  ownerId: string,
  range: Range,
): Promise<ReviewSummary['captures']> => {
  const { start, end } = asDates(range);
  const window = { createdAt: { $gte: start, $lte: end } };
  const [created, processed] = await Promise.all([
    Capture.countDocuments({ ownerId: owner(ownerId), ...window }),
    Capture.countDocuments({ ownerId: owner(ownerId), status: 'archived', ...window }),
  ]);
  return { created, processed };
};

const computeCompletedStreak = async (
  ownerId: string,
  period: ReviewPeriod,
  periodKey: string,
  range: Range,
  prevRange: Range,
): Promise<number> => {
  const rows = await Review.find({
    ownerId: owner(ownerId),
    period,
    completedAt: { $ne: null },
  }).select('periodKey');
  const done = new Set(rows.map((r) => r.periodKey));

  let streak = 0;
  let anchor = done.has(periodKey) ? range.from : prevRange.from;
  for (let i = 0; i < 520; i += 1) {
    if (!done.has(keyFor(period, anchor))) break;
    streak += 1;
    anchor = addDays(boundsFor(period, anchor).from, -1);
  }
  return streak;
};

export const getReviewSummary = async (
  ownerId: string,
  opts: { period: ReviewPeriod; anchor?: string; today?: string },
): Promise<ReviewSummary> => {
  const today = opts.today ?? todayUtc();
  const anchor = opts.anchor ?? today;
  const { period } = opts;

  const range = boundsFor(period, anchor);
  const prevRange = boundsFor(period, addDays(range.from, -1));
  const periodKey = keyFor(period, anchor);
  const prevPeriodKey = keyFor(period, prevRange.from);

  const [
    tasks,
    journal,
    finance,
    thoughts,
    habitsNow,
    habitsPrev,
    captures,
    savedDoc,
    prevDoc,
    completedStreak,
  ] = await Promise.all([
    summariseTasks(ownerId, range, prevRange),
    summariseJournal(ownerId, range, prevRange, today),
    summariseFinance(ownerId, range, prevRange, today),
    summariseThoughts(ownerId, range, prevRange),
    rollupHabits(ownerId, range, today),
    rollupHabits(ownerId, prevRange, today),
    summariseCaptures(ownerId, range),
    Review.findOne({ ownerId: owner(ownerId), period, periodKey }),
    Review.findOne({ ownerId: owner(ownerId), period, periodKey: prevPeriodKey }),
    computeCompletedStreak(ownerId, period, periodKey, range, prevRange),
  ]);

  return {
    period,
    periodKey,
    range,
    prevRange,
    isCurrent: today >= range.from && today <= range.to,
    tasks,
    journal,
    finance,
    thoughts,
    habits: {
      overallRate: habitsNow.overallRate,
      overallRatePrev: habitsPrev.overallRate,
      items: habitsNow.items,
    },
    captures,
    saved: project(savedDoc),
    prevReview: project(prevDoc),
    completedStreak,
  };
};

export const saveReview = async (
  ownerId: string,
  period: ReviewPeriod,
  periodKey: string,
  patch: {
    intentions?: string;
    reflection?: string;
    rating?: number | null;
    completed?: boolean;
  },
): Promise<ReviewDocument> => {
  const set: Record<string, unknown> = {};
  if (patch.intentions !== undefined) set.intentions = patch.intentions;
  if (patch.reflection !== undefined) set.reflection = patch.reflection;
  if (patch.rating !== undefined) set.rating = patch.rating;

  if (patch.completed !== undefined) {
    const existing = await Review.findOne({ ownerId: owner(ownerId), period, periodKey });
    // Completing stamps the time once; re-saving a completed review doesn't move it.
    set.completedAt = patch.completed ? (existing?.completedAt ?? new Date()) : null;
  }

  const update: Record<string, unknown> = {
    $setOnInsert: { ownerId: owner(ownerId), period, periodKey },
  };
  if (Object.keys(set).length > 0) update.$set = set;

  const doc = await Review.findOneAndUpdate(
    { ownerId: owner(ownerId), period, periodKey },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc as ReviewDocument;
};

export const listReviews = (
  ownerId: string,
  period: ReviewPeriod,
  limit: number,
): Promise<ReviewDocument[]> =>
  Review.find({ ownerId: owner(ownerId), period, completedAt: { $ne: null } })
    .sort({ completedAt: -1 })
    .limit(limit);
