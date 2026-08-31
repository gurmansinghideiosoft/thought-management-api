import { Types } from 'mongoose';

import { conflict, notFoundError } from '../errors.ts';
import { Entry } from '../models/entry.model.ts';
import type { ThoughtTag } from '../models/thought.model.ts';
import { pullTagFromEntries } from './entry.service.ts';
import { getThoughtOrThrow } from './thought.service.ts';

export interface TagView {
  id: string;
  name: string;
  color?: string;
  createdAt: Date;
}

export interface TagWithCount extends TagView {
  entryCount: number;
}

const toView = (tag: ThoughtTag): TagView => ({
  id: String(tag._id),
  name: tag.name,
  ...(tag.color ? { color: tag.color } : {}),
  createdAt: tag.createdAt,
});

const assertNameFree = (tags: ThoughtTag[], name: string, exceptId?: string): void => {
  const wanted = name.trim().toLowerCase();
  const clash = tags.some(
    (tag) => String(tag._id) !== exceptId && tag.name.toLowerCase() === wanted,
  );
  if (clash) {
    throw conflict(`A tag named "${name}" already exists on this thought`);
  }
};

export const listTags = async (thoughtId: string): Promise<TagWithCount[]> => {
  const thought = await getThoughtOrThrow(thoughtId);

  const counts = (await Entry.aggregate([
    { $match: { thoughtId: thought._id, deletedAt: null } },
    { $unwind: '$tagIds' },
    { $group: { _id: '$tagIds', count: { $sum: 1 } } },
  ])) as { _id: Types.ObjectId; count: number }[];

  const countById = new Map(counts.map((row) => [String(row._id), row.count]));

  return thought.tags.map((tag) => ({
    ...toView(tag),
    entryCount: countById.get(String(tag._id)) ?? 0,
  }));
};

export const createTag = async (
  thoughtId: string,
  input: { name: string; color?: string },
): Promise<TagView> => {
  const thought = await getThoughtOrThrow(thoughtId);
  assertNameFree(thought.tags, input.name);

  const tag: ThoughtTag = {
    _id: new Types.ObjectId(),
    name: input.name.trim(),
    createdAt: new Date(),
    ...(input.color ? { color: input.color } : {}),
  };
  thought.tags.push(tag);
  await thought.save();
  return toView(tag);
};

export const updateTag = async (
  thoughtId: string,
  tagId: string,
  patch: { name?: string; color?: string },
): Promise<TagView> => {
  const thought = await getThoughtOrThrow(thoughtId);
  const tag = thought.tags.find((candidate) => String(candidate._id) === tagId);
  if (!tag) throw notFoundError('Tag not found');

  if (patch.name !== undefined) {
    assertNameFree(thought.tags, patch.name, tagId);
    tag.name = patch.name.trim();
  }
  if (patch.color !== undefined) tag.color = patch.color;

  thought.markModified('tags');
  await thought.save();
  return toView(tag);
};

export const deleteTag = async (thoughtId: string, tagId: string): Promise<void> => {
  const thought = await getThoughtOrThrow(thoughtId);
  const exists = thought.tags.some((tag) => String(tag._id) === tagId);
  if (!exists) throw notFoundError('Tag not found');

  thought.set(
    'tags',
    thought.tags.filter((tag) => String(tag._id) !== tagId),
  );
  await thought.save();
  await pullTagFromEntries(thoughtId, tagId);
};
