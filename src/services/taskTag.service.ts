import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { Task } from '../models/task.model.ts';
import { TaskTag, type TaskTagDocument } from '../models/taskTag.model.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

export const listTaskTags = (ownerId: string): Promise<TaskTagDocument[]> =>
  TaskTag.find({ ownerId: owner(ownerId) }).sort({ name: 1 });

export const createTaskTag = (
  ownerId: string,
  input: { name: string; color?: string },
): Promise<TaskTagDocument> =>
  TaskTag.create({
    ownerId: owner(ownerId),
    name: input.name.trim(),
    ...(input.color ? { color: input.color } : {}),
  });

export const getTaskTagOrThrow = async (
  ownerId: string,
  id: string,
): Promise<TaskTagDocument> => {
  const tag = await TaskTag.findOne({ _id: id, ownerId: owner(ownerId) });
  if (!tag) throw notFoundError('Tag not found');
  return tag;
};

export const updateTaskTag = async (
  ownerId: string,
  id: string,
  patch: { name?: string; color?: string },
): Promise<TaskTagDocument> => {
  const tag = await getTaskTagOrThrow(ownerId, id);
  if (patch.name !== undefined) tag.name = patch.name.trim();
  if (patch.color !== undefined) tag.color = patch.color;
  await tag.save();
  return tag;
};

export const deleteTaskTag = async (ownerId: string, id: string): Promise<void> => {
  const tag = await getTaskTagOrThrow(ownerId, id);
  await Task.updateMany(
    { ownerId: owner(ownerId), tagIds: tag._id },
    { $pull: { tagIds: tag._id } },
  );
  await tag.deleteOne();
};

/** Resolve tag-id strings, rejecting any that don't belong to the user. */
export const assertTaskTagsExist = async (
  ownerId: string,
  ids: string[] | undefined,
): Promise<Types.ObjectId[]> => {
  if (!ids || ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const found = await TaskTag.countDocuments({
    _id: { $in: unique },
    ownerId: owner(ownerId),
  });
  if (found !== unique.length) {
    throw notFoundError('One or more tags do not exist');
  }
  return unique.map((id) => new Types.ObjectId(id));
};
