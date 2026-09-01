import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb hex color');

export const idParams = z.object({ id: objectId });

export const createTaskTagBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.optional(),
});

export const updateTaskTagBody = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: hexColor.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
