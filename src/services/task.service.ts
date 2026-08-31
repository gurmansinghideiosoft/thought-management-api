import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { Task, type TaskDocument, type TaskStatus } from '../models/task.model.ts';
import { escapeRegExp } from '../schemas/common.ts';
import { assertTaskTagsExist } from './taskTag.service.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export interface ListTasksParams {
  from?: string;
  to?: string;
  status?: TaskStatus;
  tagIds?: string[];
  priorities?: number[];
  q?: string;
}

const buildFilter = (
  ownerId: string,
  params: Omit<ListTasksParams, 'from' | 'to'> & { from?: string; to?: string },
): Record<string, unknown> => {
  const filter: Record<string, unknown> = { ownerId: owner(ownerId) };

  if (params.from || params.to) {
    filter.date = {
      ...(params.from ? { $gte: params.from } : {}),
      ...(params.to ? { $lte: params.to } : {}),
    };
  }
  if (params.status) filter.status = params.status;
  if (params.priorities && params.priorities.length > 0) {
    filter.priority = { $in: params.priorities };
  }
  if (params.tagIds && params.tagIds.length > 0) {
    filter.tagIds = { $in: params.tagIds.map((id) => new Types.ObjectId(id)) };
  }
  if (params.q && params.q.trim() !== '') {
    filter.content = { $regex: escapeRegExp(params.q.trim()), $options: 'i' };
  }
  return filter;
};

export const listTasks = (
  ownerId: string,
  params: ListTasksParams,
): Promise<TaskDocument[]> =>
  Task.find(buildFilter(ownerId, params)).sort({
    date: 1,
    priority: 1,
    createdAt: 1,
  });

export interface CalendarCounts {
  [date: string]: { pending: number; done: number };
}

export const taskCalendar = async (
  ownerId: string,
  params: {
    month: string;
    status?: TaskStatus;
    tagIds?: string[];
    priorities?: number[];
  },
): Promise<CalendarCounts> => {
  const filter = buildFilter(ownerId, {
    ...params,
    from: `${params.month}-01`,
    to: `${params.month}-31`,
  });

  const rows = (await Task.aggregate([
    { $match: filter },
    { $group: { _id: { date: '$date', status: '$status' }, count: { $sum: 1 } } },
  ])) as { _id: { date: string; status: TaskStatus }; count: number }[];

  const counts: CalendarCounts = {};
  for (const row of rows) {
    const bucket = (counts[row._id.date] ??= { pending: 0, done: 0 });
    bucket[row._id.status] = row.count;
  }
  return counts;
};

export const getTaskOrThrow = async (
  ownerId: string,
  id: string,
): Promise<TaskDocument> => {
  const task = await Task.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!task) throw notFoundError('Task not found');
  return task;
};

export const createTask = async (
  ownerId: string,
  input: { content: string; date: string; priority?: number; tagIds?: string[] },
): Promise<TaskDocument> => {
  const tagIds = await assertTaskTagsExist(ownerId, input.tagIds);
  return Task.create({
    ownerId: owner(ownerId),
    content: input.content,
    date: input.date,
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
  if (patch.date !== undefined) task.date = patch.date;
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
