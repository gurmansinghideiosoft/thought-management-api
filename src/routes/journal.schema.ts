import { z } from 'zod';

import { limitParam, objectId } from '../schemas/common.ts';

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const idParams = z.object({ id: objectId });
export const dateParams = z.object({ date: dateOnly });

export const listQuery = z.object({
  cursor: z.string().optional(),
  limit: limitParam,
});

/** The editor document — a Tiptap/ProseMirror doc node. Shape kept loose. */
const contentDoc = z
  .object({ type: z.string() })
  .catchall(z.unknown())
  .refine((doc) => doc.type === 'doc', { message: 'content must be a doc node' });

export const journalPatchBody = z
  .object({
    title: z.string().trim().max(200).optional(),
    content: contentDoc.optional(),
    excerpt: z.string().max(600).optional(),
    wordCount: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field',
  });

/** PUT by-date may be called with an empty body to just open/create the day. */
export const journalUpsertBody = z.object({
  title: z.string().trim().max(200).optional(),
  content: contentDoc.optional(),
  excerpt: z.string().max(600).optional(),
  wordCount: z.number().int().min(0).max(1_000_000).optional(),
});
