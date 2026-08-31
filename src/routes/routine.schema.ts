import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const priority = z.coerce.number().int().min(1).max(5);

export const itemParams = z.object({ itemId: objectId });

export const addItemBody = z.object({
  content: z.string().trim().min(1).max(500),
  priority: priority.optional(),
  tagIds: z.array(objectId).max(20).optional(),
});

export const updateItemBody = z
  .object({
    content: z.string().trim().min(1).max(500).optional(),
    priority: priority.optional(),
    tagIds: z.array(objectId).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export const reorderBody = z.object({
  itemIds: z.array(objectId).min(1),
});
