import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb hex color');
const amount = z.number().positive().finite().max(1e12);
const budget = z.number().nonnegative().finite().max(1e12);
const kind = z.enum(['spending', 'earning']);
const title = z.string().trim().min(1).max(120);
const dayOfMonth = z.number().int().min(1).max(31);

export const idParams = z.object({ id: objectId });

export const rangeQuery = z
  .object({ from: dayKey, to: dayKey, today: dayKey.optional() })
  .refine((v) => v.from <= v.to, { message: '`from` must be on or before `to`' });

// --- tags ---------------------------------------------------------------

export const createTagBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.optional(),
  monthlyBudget: budget.nullish(),
});

export const updateTagBody = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: hexColor.optional(),
    monthlyBudget: budget.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

// --- recurring rules --------------------------------------------------

export const createRecurringBody = z.object({
  title,
  amount,
  kind: kind.default('spending'),
  tagId: objectId.nullish(),
  dayOfMonth,
  active: z.boolean().default(true),
});

export const updateRecurringBody = z
  .object({
    title: title.optional(),
    amount: amount.optional(),
    kind: kind.optional(),
    tagId: objectId.nullable().optional(),
    dayOfMonth: dayOfMonth.optional(),
    active: z.boolean().optional(),
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

// --- loans (money lent out / borrowed) ------------------------------

const counterparty = z.string().trim().min(1).max(80);
const note = z.string().trim().max(280);
const loanDirection = z.enum(['lent', 'borrowed']);

export const loansQuery = z.object({
  status: z.enum(['open', 'settled', 'all']).default('open'),
  direction: z.enum(['lent', 'borrowed', 'all']).default('all'),
});

export const createLoanBody = z.object({
  counterparty,
  direction: loanDirection.default('lent'),
  amount,
  date: dayKey,
  dueDate: dayKey.nullish(),
  note: note.nullish(),
  tagId: objectId.nullish(),
  title: title.optional(),
});

export const updateLoanBody = z
  .object({
    counterparty: counterparty.optional(),
    dueDate: dayKey.nullable().optional(),
    note: note.nullable().optional(),
    tagId: objectId.nullable().optional(),
    title: title.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });

export const repayLoanBody = z.object({
  // Omit `amount` to settle the whole outstanding balance.
  amount: amount.optional(),
  // Defaults to today (UTC) when omitted.
  date: dayKey.optional(),
});
