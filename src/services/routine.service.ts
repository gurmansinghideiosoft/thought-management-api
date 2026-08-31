import { Types } from 'mongoose';

import { badRequest, notFoundError } from '../errors.ts';
import { addDays, todayUtc } from '../lib/day.ts';
import {
  FOREVER,
  Routine,
  type RoutineDocument,
  type RoutineItem,
} from '../models/routine.model.ts';
import { assertTaskTagsExist } from './taskTag.service.ts';

const owner = (ownerId: string): Types.ObjectId => new Types.ObjectId(ownerId);

/** The user's routine, created empty on first access. Atomic upsert so two
 * concurrent first reads can't race on the unique `ownerId` index. */
export const getRoutine = async (ownerId: string): Promise<RoutineDocument> => {
  const oid = owner(ownerId);
  const routine = await Routine.findOneAndUpdate(
    { ownerId: oid },
    { $setOnInsert: { ownerId: oid, items: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return routine as RoutineDocument;
};

/** Items applying on a given `YYYY-MM-DD`, ordered by position. */
export const activeItemsOn = (routine: RoutineDocument, day: string): RoutineItem[] =>
  routine.items
    .filter((item) => item.activeFrom <= day && day <= (item.activeTo ?? FOREVER))
    .sort((a, b) => a.position - b.position);

const findItem = (routine: RoutineDocument, itemId: string): RoutineItem => {
  const item = routine.items.find((i) => String(i._id) === itemId);
  if (!item) throw notFoundError('Routine item not found');
  return item;
};

export const addRoutineItem = async (
  ownerId: string,
  input: { content: string; priority?: number; tagIds?: string[] },
): Promise<RoutineItem> => {
  const routine = await getRoutine(ownerId);
  const tagIds = await assertTaskTagsExist(ownerId, input.tagIds);
  const position = routine.items.reduce((max, i) => Math.max(max, i.position), -1) + 1;

  const item: RoutineItem = {
    _id: new Types.ObjectId(),
    content: input.content,
    priority: input.priority ?? 3,
    tagIds,
    position,
    activeFrom: todayUtc(),
    activeTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  routine.items.push(item);
  await routine.save();
  return findItem(routine, String(item._id));
};

export const updateRoutineItem = async (
  ownerId: string,
  itemId: string,
  patch: { content?: string; priority?: number; tagIds?: string[] },
): Promise<RoutineItem> => {
  const routine = await getRoutine(ownerId);
  const item = findItem(routine, itemId);
  if (patch.content !== undefined) item.content = patch.content;
  if (patch.priority !== undefined) item.priority = patch.priority;
  if (patch.tagIds !== undefined) {
    item.tagIds = await assertTaskTagsExist(ownerId, patch.tagIds);
  }
  routine.markModified('items');
  await routine.save();
  return findItem(routine, itemId);
};

/** Retire an item from today on; hard-delete if it was only added today. */
export const removeRoutineItem = async (
  ownerId: string,
  itemId: string,
): Promise<void> => {
  const routine = await getRoutine(ownerId);
  const item = findItem(routine, itemId);
  const today = todayUtc();

  if (item.activeFrom >= today) {
    routine.set(
      'items',
      routine.items.filter((i) => String(i._id) !== itemId),
    );
  } else {
    item.activeTo = addDays(today, -1);
    routine.markModified('items');
  }
  await routine.save();
};

/**
 * Set item order from `itemIds`. Callers only ever see the active items (`GET
 * /api/routine`), so this accepts any distinct subset of known ids rather than
 * the full list; listed items take positions `0..n-1`, retired ones keep theirs.
 */
export const reorderRoutineItems = async (
  ownerId: string,
  itemIds: string[],
): Promise<RoutineDocument> => {
  const routine = await getRoutine(ownerId);
  const known = new Set(routine.items.map((i) => String(i._id)));
  const seen = new Set<string>();
  for (const id of itemIds) {
    if (!known.has(id)) throw notFoundError('Routine item not found');
    if (seen.has(id)) throw badRequest('itemIds must not repeat an id');
    seen.add(id);
  }
  const rank = new Map(itemIds.map((id, i) => [id, i]));
  for (const item of routine.items) {
    const r = rank.get(String(item._id));
    if (r !== undefined) item.position = r;
  }
  routine.markModified('items');
  await routine.save();
  return routine;
};
