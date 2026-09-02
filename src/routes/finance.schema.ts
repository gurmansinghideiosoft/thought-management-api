import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb hex color');
const amount = z.number().positive().finite().max(1e12);
const kind = z.enum(['spending', 'earning']);
const title = z.string().trim().min(1).max(120);

export const idParams = z.object({ id: objectId });

export const rangeQuery = z
  .object({ from: dayKey, to: dayKey })
  .refine((v) => v.from <= v.to, { message: '`from` must be on or before `to`' });

// --- tags ---------------------------------------------------------------

export const createTagBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.optional(),
});

export const updateTagBody = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: hexColor.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

// --- transactions -----------------------------------------------------

const transactionItem = z.object({
  title,
  amount,
  kind: kind.default('spending'),
  date: dayKey,
  tagId: objectId.nullish(),
});

export const createTransactionsBody = z.object({
  transactions: z.array(transactionItem).min(1).max(100),
});

export const updateTransactionBody = z
  .object({
    title: title.optional(),
    amount: amount.optional(),
    kind: kind.optional(),
    date: dayKey.optional(),
    tagId: objectId.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });
