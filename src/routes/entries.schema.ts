import { z } from 'zod';

import { booleanParam, limitParam, objectId } from '../schemas/common.ts';

const kindEnum = z.enum(['note', 'link', 'file']);
const tagIds = z.array(objectId).max(50).optional();
const linkShape = z.object({
  url: z.url().max(2048),
  title: z.string().trim().max(300).optional(),
});

export const thoughtScopedParams = z.object({ thoughtId: objectId });
export const entryParams = z.object({ thoughtId: objectId, entryId: objectId });
export const entryTagParams = z.object({
  thoughtId: objectId,
  entryId: objectId,
  tagId: objectId,
});

export const timelineQuery = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: limitParam,
  tagId: objectId.optional(),
  starred: booleanParam.optional(),
  kind: kindEnum.optional(),
  q: z.string().trim().optional(),
});

/** JSON body for note / link entries. File entries use the multipart route. */
export const addEntryBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('note'),
    body: z.string().trim().min(1).max(20_000),
    tagIds,
    starred: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('link'),
    link: linkShape,
    body: z.string().max(20_000).optional(),
    tagIds,
    starred: z.boolean().optional(),
  }),
]);

/** Multipart form fields for a file entry (the file itself is `req.file`). */
export const fileEntryForm = z.object({
  body: z.string().max(20_000).optional(),
  starred: z
    .preprocess((value) => value === 'true' || value === true, z.boolean())
    .optional(),
  tagIds: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : value,
    z.array(objectId).max(50).optional(),
  ),
});

export const updateEntryBody = z
  .object({
    body: z.string().max(20_000).optional(),
    link: linkShape.optional(),
    tagIds: z.array(objectId).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const starBody = z.object({ starred: z.boolean() });
export const attachTagBody = z.object({ tagId: objectId });
