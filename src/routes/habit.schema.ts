import { z } from 'zod';

import { booleanParam, objectId } from '../schemas/common.ts';

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const monthKey = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb hex color');
const name = z.string().trim().min(1).max(60);
const habitType = z.enum(['binary', 'count']);
const target = z.number().int().min(1).max(100_000);
const unit = z.string().trim().max(16);

export const idParams = z.object({ id: objectId });
export const entryParams = z.object({ id: objectId, date: dayKey });

export const listHabitsQuery = z.object({
  date: dayKey.optional(),
  includeArchived: booleanParam.optional(),
});

export const monthQuery = z.object({ month: monthKey });

export const createHabitBody = z.object({
  name,
  type: habitType.default('binary'),
  target: target.optional(),
  unit: unit.optional(),
  color: hexColor.optional(),
});

export const updateHabitBody = z
  .object({
    name: name.optional(),
    type: habitType.optional(),
    target: target.optional(),
    unit: unit.optional(),
    color: hexColor.optional(),
    archived: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export const reorderBody = z.object({ ids: z.array(objectId).min(1).max(200) });

export const setEntryBody = z.object({
  value: z.number().int().min(0).max(100_000),
});
