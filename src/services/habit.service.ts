import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { addDays, monthBounds, todayUtc } from '../lib/day.ts';
import { Habit, type HabitAttrs, type HabitDocument } from '../models/habit.model.ts';
import { HabitEntry, type HabitEntryDocument } from '../models/habitEntry.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

const isDone = (habit: Pick<HabitAttrs, 'type' | 'target'>, value: number): boolean =>
  habit.type === 'binary' ? value >= 1 : value >= habit.target;

interface Streak {
  current: number;
  longest: number;
  doneToday: boolean;
}

/** Consecutive-day streak from a set of "done" `YYYY-MM-DD` strings — the same
 * shape the Journal uses: today or (grace) yesterday anchors `current`. */
const computeStreak = (doneDates: string[], today: string): Streak => {
  const days = [...new Set(doneDates)].sort().reverse();
  if (days.length === 0) return { current: 0, longest: 0, doneToday: false };

  const doneToday = days[0] === today;
  const yesterday = addDays(today, -1);
  const anchor = days[0] === today ? today : days[0] === yesterday ? yesterday : null;

  let current = 0;
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

  return { current, longest, doneToday };
};

export interface HabitView {
  todayValue: number;
  doneToday: boolean;
  currentStreak: number;
  longestStreak: number;
}

export const listHabits = async (
  ownerId: string,
  opts: { date?: string; includeArchived?: boolean } = {},
): Promise<(Record<string, unknown> & HabitView)[]> => {
  const date = opts.date ?? todayUtc();
  const filter: Record<string, unknown> = { ownerId: owner(ownerId) };
  if (!opts.includeArchived) filter.archived = false;

  const habits = await Habit.find(filter).sort({ position: 1, createdAt: 1 });
  if (habits.length === 0) return [];

  const entries = await HabitEntry.find({
    ownerId: owner(ownerId),
    habitId: { $in: habits.map((h) => h._id) },
  }).select('habitId date value');

  const byHabit = new Map<string, { date: string; value: number }[]>();
  for (const e of entries) {
    const key = String(e.habitId);
    const list = byHabit.get(key);
    if (list) list.push({ date: e.date, value: e.value });
    else byHabit.set(key, [{ date: e.date, value: e.value }]);
  }

  return habits.map((habit) => {
    const rows = byHabit.get(String(habit._id)) ?? [];
    const todayValue = rows.find((r) => r.date === date)?.value ?? 0;
    const doneDates = rows.filter((r) => isDone(habit, r.value)).map((r) => r.date);
    const streak = computeStreak(doneDates, date);
    return {
      ...(habit.toJSON() as unknown as Record<string, unknown>),
      todayValue,
      doneToday: streak.doneToday,
      currentStreak: streak.current,
      longestStreak: streak.longest,
    };
  });
};

export const createHabit = async (
  ownerId: string,
  input: {
    name: string;
    type?: 'binary' | 'count';
    target?: number;
    unit?: string;
    color?: string;
  },
): Promise<HabitDocument> => {
  const position = await Habit.countDocuments({ ownerId: owner(ownerId) });
  return Habit.create({
    ownerId: owner(ownerId),
    name: input.name.trim(),
    type: input.type ?? 'binary',
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.color ? { color: input.color } : {}),
    position,
  });
};

export const getHabitOrThrow = async (
  ownerId: string,
  id: string,
): Promise<HabitDocument> => {
  const habit = await Habit.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!habit) throw notFoundError('Habit not found');
  return habit;
};

export const updateHabit = async (
  ownerId: string,
  id: string,
  patch: {
    name?: string;
    type?: 'binary' | 'count';
    target?: number;
    unit?: string;
    color?: string;
    archived?: boolean;
    position?: number;
  },
): Promise<HabitDocument> => {
  const habit = await getHabitOrThrow(ownerId, id);
  if (patch.name !== undefined) habit.name = patch.name.trim();
  if (patch.type !== undefined) habit.type = patch.type;
  if (patch.target !== undefined) habit.target = patch.target;
  if (patch.unit !== undefined) habit.unit = patch.unit.trim();
  if (patch.color !== undefined) habit.color = patch.color;
  if (patch.archived !== undefined) habit.archived = patch.archived;
  if (patch.position !== undefined) habit.position = patch.position;
  await habit.save();
  return habit;
};

export const deleteHabit = async (ownerId: string, id: string): Promise<void> => {
  const habit = await getHabitOrThrow(ownerId, id);
  await HabitEntry.deleteMany({ ownerId: owner(ownerId), habitId: habit._id });
  await habit.deleteOne();
};

export const reorderHabits = async (ownerId: string, ids: string[]): Promise<void> => {
  const unique = [...new Set(ids)];
  const found = await Habit.countDocuments({
    _id: { $in: unique },
    ownerId: owner(ownerId),
  });
  if (found !== unique.length) throw notFoundError('One or more habits do not exist');

  await Habit.bulkWrite(
    unique.map((id, position) => ({
      updateOne: { filter: { _id: id, ownerId: owner(ownerId) }, update: { position } },
    })),
  );
};

export const setEntry = async (
  ownerId: string,
  habitId: string,
  date: string,
  value: number,
): Promise<HabitEntryDocument | null> => {
  await getHabitOrThrow(ownerId, habitId);
  if (value >= 1) {
    return HabitEntry.findOneAndUpdate(
      { ownerId: owner(ownerId), habitId: new Types.ObjectId(habitId), date },
      { $set: { value: Math.round(value) } },
      { upsert: true, new: true },
    );
  }
  await HabitEntry.deleteOne({
    ownerId: owner(ownerId),
    habitId: new Types.ObjectId(habitId),
    date,
  });
  return null;
};

export const getHabitMonth = async (
  ownerId: string,
  habitId: string,
  month: string,
): Promise<{ month: string; days: { date: string; value: number }[] }> => {
  await getHabitOrThrow(ownerId, habitId);
  const { from, to } = monthBounds(month);
  const rows = await HabitEntry.find({
    ownerId: owner(ownerId),
    habitId: new Types.ObjectId(habitId),
    date: { $gte: from, $lte: to },
  })
    .select('date value')
    .sort({ date: 1 });
  return { month, days: rows.map((r) => ({ date: r.date, value: r.value })) };
};
