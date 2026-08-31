import { z } from 'zod';

import { dateString, limitParam, objectId, pageParam } from '../schemas/common.ts';

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb hex color');

export const idParams = z.object({ id: objectId });

export const createThoughtBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  tags: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        color: hexColor.optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const updateThoughtBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listThoughtsQuery = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['active', 'archived']).optional(),
  createdFrom: dateString.optional(),
  createdTo: dateString.optional(),
  sort: z.enum(['recent', 'created', 'oldest', 'title']).default('recent'),
  page: pageParam,
  limit: limitParam,
});

export const pageQuery = z.object({ page: pageParam, limit: limitParam });
