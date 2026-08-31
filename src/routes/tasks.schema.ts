import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const monthOnly = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');
export const priority = z.coerce.number().int().min(1).max(5);

const splitCsv = (value: string | undefined): string[] =>
  value
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

/** `?tags=a,b` → `string[]` of valid ObjectIds (issue raised for any bad id). */
const tagIdList = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const ids = splitCsv(value);
    for (const id of ids) {
      if (!objectId.safeParse(id).success) {
        ctx.addIssue({ code: 'custom', message: `Invalid tag id: ${id}` });
      }
    }
    return ids;
  });

/** `?priority=1,3` → `number[]` in 1..5. */
const priorityList = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const nums = splitCsv(value).map(Number);
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        ctx.addIssue({ code: 'custom', message: `Invalid priority: ${String(n)}` });
      }
    }
    return nums;
  });

export const idParams = z.object({ id: objectId });

export const listTasksQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  today: dateOnly.optional(),
  status: z.enum(['pending', 'done', 'skipped']).optional(),
  tags: tagIdList,
  priority: priorityList,
  q: z.string().trim().optional(),
});

export const calendarQuery = z.object({
  month: monthOnly,
  today: dateOnly.optional(),
  tags: tagIdList,
  priority: priorityList,
});

const contentField = z.string().trim().min(1).max(500);
const tagIdsField = z.array(objectId).max(20).optional();

export const createTaskBody = z.union([
  z.object({
    kind: z.literal('range'),
    content: contentField,
    startDate: dateOnly,
    endDate: dateOnly,
    rangeMode: z.enum(['once', 'daily']),
    priority: priority.optional(),
    tagIds: tagIdsField,
  }),
  z.object({
    kind: z.literal('single').optional(),
    content: contentField,
    date: dateOnly,
    priority: priority.optional(),
    tagIds: tagIdsField,
  }),
]);

export const updateTaskBody = z
  .object({
    content: z.string().trim().min(1).max(500).optional(),
    date: dateOnly.optional(),
    priority: priority.optional(),
    tagIds: z.array(objectId).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const statusBody = z.object({ status: z.enum(['pending', 'done']) });

export const virtualStatusBody = z
  .object({
    date: dateOnly,
    routineItemId: objectId.optional(),
    rangeTaskId: objectId.optional(),
    status: z.enum(['pending', 'done', 'skipped']),
  })
  .refine((v) => !v.routineItemId !== !v.rangeTaskId, {
    message: 'Provide exactly one of routineItemId or rangeTaskId',
  });
