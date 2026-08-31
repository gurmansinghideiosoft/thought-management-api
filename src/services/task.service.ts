import { Types } from 'mongoose';

import { badRequest, notFoundError } from '../errors.ts';
import { addDays, monthBounds, todayUtc } from '../lib/day.ts';
import {
  type RangeMode,
  Task,
  type TaskDocument,
  type TaskStatus,
} from '../models/task.model.ts';
import { getRoutine } from './routine.service.ts';
import { assertTaskTagsExist } from './taskTag.service.ts';
import {
  calendarCounts,
  expandRange,
  type ExpandFilters,
  type TaskView,
} from './taskExpansion.service.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export interface ListTasksParams extends ExpandFilters {
  from?: string;
  to?: string;
  today?: string;
  status?: TaskStatus;
  q?: string;
}

/** Merged, day-by-day view: stored rows + virtual routine / range occurrences. */
export const listTasks = async (
  ownerId: string,
  params: ListTasksParams,
): Promise<TaskView[]> => {
  const today = params.today ?? todayUtc();
  // No explicit window → a generous default around "today".
  const from = params.from ?? addDays(today, -30);
  const to = params.to ?? addDays(today, 180);
  const views = await expandRange(ownerId, {
    from,
    to,
    today,
    tagIds: params.tagIds,
    priorities: params.priorities,
  });

  let result = views;
  if (params.status) result = result.filter((v) => v.status === params.status);
  if (params.q && params.q.trim() !== '') {
    const q = params.q.trim().toLowerCase();
    result = result.filter((v) => v.content.toLowerCase().includes(q));
  }
  return result;
};

export const taskCalendar = (
  ownerId: string,
  params: {
    month: string;
    today?: string;
    tagIds?: string[];
    priorities?: number[];
  },
): Promise<Record<string, { pending: number; done: number }>> => {
  const { from, to } = monthBounds(params.month);
  return calendarCounts(ownerId, {
    from,
    to,
    today: params.today ?? todayUtc(),
    tagIds: params.tagIds,
    priorities: params.priorities,
  });
};

export const getTaskOrThrow = async (
  ownerId: string,
  id: string,
): Promise<TaskDocument> => {
  const task = await Task.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!task) throw notFoundError('Task not found');
  return task;
};

export interface CreateTaskInput {
  content: string;
  priority?: number;
  tagIds?: string[];
  /** `single` (default): needs `date`. `range`: needs start/end + rangeMode. */
  kind?: 'single' | 'range';
  date?: string;
  startDate?: string;
  endDate?: string;
  rangeMode?: RangeMode;
}

export const createTask = async (
  ownerId: string,
  input: CreateTaskInput,
): Promise<TaskDocument> => {
  const tagIds = await assertTaskTagsExist(ownerId, input.tagIds);
  const kind = input.kind ?? 'single';

  if (kind === 'single') {
    if (!input.date) throw badRequest('date is required for a single task');
    return Task.create({
      ownerId: owner(ownerId),
      kind: 'single',
      content: input.content,
      date: input.date,
      priority: input.priority ?? 3,
      tagIds,
    });
  }

  if (!input.startDate || !input.endDate) {
    throw badRequest('startDate and endDate are required for a range task');
  }
  if (input.startDate > input.endDate) {
    throw badRequest('startDate must be on or before endDate');
  }
  if (!input.rangeMode) throw badRequest('rangeMode is required for a range task');

  return Task.create({
    ownerId: owner(ownerId),
    kind: 'range',
    content: input.content,
    startDate: input.startDate,
    endDate: input.endDate,
    rangeMode: input.rangeMode,
    priority: input.priority ?? 3,
    tagIds,
  });
};

export const updateTask = async (
  ownerId: string,
  id: string,
  patch: { content?: string; date?: string; priority?: number; tagIds?: string[] },
): Promise<TaskDocument> => {
  const task = await getTaskOrThrow(ownerId, id);
  if (patch.content !== undefined) task.content = patch.content;
  if (patch.date !== undefined && task.kind === 'single') task.date = patch.date;
  if (patch.priority !== undefined) task.priority = patch.priority;
  if (patch.tagIds !== undefined) {
    task.tagIds = await assertTaskTagsExist(ownerId, patch.tagIds);
  }
  await task.save();
  return task;
};

export const setTaskStatus = async (
  ownerId: string,
  id: string,
  status: TaskStatus,
): Promise<TaskDocument> => {
  const task = await getTaskOrThrow(ownerId, id);
  task.status = status;
  task.completedAt = status === 'done' ? new Date() : null;
  await task.save();
  return task;
};

export const deleteTask = async (ownerId: string, id: string): Promise<void> => {
  const task = await getTaskOrThrow(ownerId, id);
  await task.deleteOne();
};

/**
 * Materialize a virtual routine / range-daily occurrence for one day and set its
 * status. First call copies the template's fields into a real `single` row; later
 * calls update it. That stored row then shadows the virtual occurrence.
 */
export const setVirtualTaskStatus = async (
  ownerId: string,
  input: {
    date: string;
    routineItemId?: string;
    rangeTaskId?: string;
    status: TaskStatus;
  },
): Promise<TaskDocument> => {
  const oid = owner(ownerId);
  if (!input.routineItemId === !input.rangeTaskId) {
    throw badRequest('Provide exactly one of routineItemId or rangeTaskId');
  }

  let template: { content: string; priority: number; tagIds: Types.ObjectId[] };
  const link: Record<string, unknown> = {};

  if (input.routineItemId) {
    const routine = await getRoutine(ownerId);
    const item = routine.items.find((i) => String(i._id) === input.routineItemId);
    if (!item) throw notFoundError('Routine item not found');
    template = { content: item.content, priority: item.priority, tagIds: item.tagIds };
    link.routineItemId = new Types.ObjectId(input.routineItemId);
  } else {
    const range = await Task.findOne({
      _id: input.rangeTaskId,
      ownerId: oid,
      kind: 'range',
      rangeMode: 'daily',
    });
    if (!range) throw notFoundError('Range task not found');
    if (!(range.startDate! <= input.date && input.date <= range.endDate!)) {
      throw badRequest('date is outside the range');
    }
    template = {
      content: range.content,
      priority: range.priority,
      tagIds: range.tagIds,
    };
    link.rangeTaskId = new Types.ObjectId(input.rangeTaskId);
  }

  const completedAt = input.status === 'done' ? new Date() : null;

  const doc = await Task.findOneAndUpdate(
    { ownerId: oid, date: input.date, ...link },
    {
      $set: { status: input.status, completedAt },
      $setOnInsert: {
        ownerId: oid,
        kind: 'single',
        date: input.date,
        content: template.content,
        priority: template.priority,
        tagIds: template.tagIds,
        ...link,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc as TaskDocument;
};
