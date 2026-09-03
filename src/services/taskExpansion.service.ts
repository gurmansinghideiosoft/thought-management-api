import { Types } from 'mongoose';

import { eachDay } from '../lib/day.ts';
import { Task, type TaskDocument, type TaskStatus } from '../models/task.model.ts';
import { activeItemsOn, getRoutine } from './routine.service.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export interface ExpandFilters {
  tagIds?: string[];
  priorities?: number[];
}

/** A task as it appears on one calendar day — stored or synthetic. */
export interface TaskView {
  /** Unique per (task, day): `<id>::<day>`. Use as the React key. */
  viewKey: string;
  /** Underlying id — a real Task id, or `routine:<itemId>` / `range:<taskId>`. */
  id: string;
  /** The calendar day this occurrence belongs to (`YYYY-MM-DD`). */
  date: string;
  /** Alias of `date` — kept so callers can group interchangeably. */
  day: string;
  virtual: boolean;
  content: string;
  status: TaskStatus;
  completedAt: string | null;
  priority: number;
  tagIds: string[];
  kind: 'single' | 'range';
  startDate: string | null;
  endDate: string | null;
  rangeMode: 'once' | 'daily' | null;
  routineItemId: string | null;
  rangeTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

const passes = (
  filters: ExpandFilters,
  priority: number,
  tagIds: readonly (string | Types.ObjectId)[],
): boolean => {
  if (filters.priorities?.length && !filters.priorities.includes(priority)) {
    return false;
  }
  if (filters.tagIds?.length) {
    const set = new Set(filters.tagIds);
    if (!tagIds.some((t) => set.has(String(t)))) return false;
  }
  return true;
};

const storedView = (row: TaskDocument, day: string): TaskView => ({
  viewKey: `${String(row._id)}::${day}`,
  id: String(row._id),
  date: day,
  day,
  virtual: false,
  content: row.content,
  status: row.status,
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  priority: row.priority,
  tagIds: row.tagIds.map(String),
  kind: row.kind,
  startDate: row.startDate,
  endDate: row.endDate,
  rangeMode: row.rangeMode,
  routineItemId: row.routineItemId ? String(row.routineItemId) : null,
  rangeTaskId: row.rangeTaskId ? String(row.rangeTaskId) : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const expandRange = async (
  ownerId: string,
  opts: { from: string; to: string; today: string } & ExpandFilters,
): Promise<TaskView[]> => {
  const { from, to, today } = opts;
  const oid = owner(ownerId);

  const [singles, ranges, routine] = await Promise.all([
    Task.find({ ownerId: oid, kind: 'single', date: { $gte: from, $lte: to } }),
    Task.find({
      ownerId: oid,
      kind: 'range',
      startDate: { $lte: to },
      endDate: { $gte: from },
    }),
    getRoutine(ownerId),
  ]);

  const routineShadow = new Set<string>();
  const rangeShadow = new Set<string>();
  for (const s of singles) {
    if (s.routineItemId) routineShadow.add(`${String(s.routineItemId)}::${s.date ?? ''}`);
    if (s.rangeTaskId) rangeShadow.add(`${String(s.rangeTaskId)}::${s.date ?? ''}`);
  }

  const out: TaskView[] = [];

  for (const s of singles) {
    if (s.status === 'skipped') continue; // shadows, but not shown
    if (!passes(opts, s.priority, s.tagIds)) continue;
    out.push(storedView(s, s.date ?? from));
  }

  const dailyRanges = ranges.filter((r) => r.rangeMode === 'daily');
  const onceRanges = ranges.filter((r) => r.rangeMode === 'once');

  for (const day of eachDay(from, to)) {
    const future = day >= today;

    // Routine items are a strictly "today" thing: a missed day stays missed and
    // you can't tick one off ahead of time. So they only ever surface on
    // `today` — never on past or future dates — which keeps every future
    // calendar cell from carrying a phantom backlog badge.
    if (day === today) {
      for (const item of activeItemsOn(routine, day)) {
        if (routineShadow.has(`${String(item._id)}::${day}`)) continue;
        if (!passes(opts, item.priority, item.tagIds)) continue;
        out.push(
          virtualView('routine', String(item._id), day, {
            content: item.content,
            priority: item.priority,
            tagIds: item.tagIds.map(String),
            kind: 'single',
            startDate: null,
            endDate: null,
            rangeMode: null,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          }),
        );
      }
    }

    if (future) {
      for (const r of dailyRanges) {
        if (!(r.startDate! <= day && day <= r.endDate!)) continue;
        if (rangeShadow.has(`${String(r._id)}::${day}`)) continue;
        if (!passes(opts, r.priority, r.tagIds)) continue;
        out.push(
          virtualView('range', String(r._id), day, {
            content: r.content,
            priority: r.priority,
            tagIds: r.tagIds.map(String),
            kind: 'range',
            startDate: r.startDate,
            endDate: r.endDate,
            rangeMode: 'daily',
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          }),
        );
      }
    }

    for (const r of onceRanges) {
      if (!(r.startDate! <= day && day <= r.endDate!)) continue;
      if (!passes(opts, r.priority, r.tagIds)) continue;
      const doneDay = r.completedAt ? r.completedAt.toISOString().slice(0, 10) : null;
      if (r.status === 'done') {
        if (doneDay === day) out.push(storedView(r, day));
      } else if (future) {
        out.push(storedView(r, day));
      }
    }
  }

  out.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.priority - b.priority ||
      a.createdAt.localeCompare(b.createdAt),
  );
  return out;
};

const virtualView = (
  prefix: 'routine' | 'range',
  sourceId: string,
  day: string,
  base: Pick<
    TaskView,
    | 'content'
    | 'priority'
    | 'tagIds'
    | 'kind'
    | 'startDate'
    | 'endDate'
    | 'rangeMode'
    | 'createdAt'
    | 'updatedAt'
  >,
): TaskView => ({
  ...base,
  viewKey: `${prefix}:${sourceId}::${day}`,
  id: `${prefix}:${sourceId}`,
  date: day,
  day,
  virtual: true,
  status: 'pending',
  completedAt: null,
  routineItemId: prefix === 'routine' ? sourceId : null,
  rangeTaskId: prefix === 'range' ? sourceId : null,
});

export const calendarCounts = async (
  ownerId: string,
  opts: { from: string; to: string; today: string } & ExpandFilters,
): Promise<Record<string, { pending: number; done: number }>> => {
  const views = await expandRange(ownerId, opts);
  const counts: Record<string, { pending: number; done: number }> = {};
  for (const v of views) {
    if (v.status === 'skipped') continue;
    const bucket = (counts[v.day] ??= { pending: 0, done: 0 });
    if (v.status === 'done') bucket.done += 1;
    else bucket.pending += 1;
  }
  return counts;
};
