import { z } from 'zod';

import { objectId } from '../schemas/common.ts';
import { hexColor } from './thoughts.schema.ts';

export const tagScopedParams = z.object({ thoughtId: objectId });
export const tagParams = z.object({ thoughtId: objectId, tagId: objectId });

export const createTagBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.optional(),
});

export const updateTagBody = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: hexColor.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
