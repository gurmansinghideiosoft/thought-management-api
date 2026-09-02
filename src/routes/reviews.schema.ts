import { z } from 'zod';

import { limitParam } from '../schemas/common.ts';

const period = z.enum(['week', 'month']);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const weekKey = /^\d{4}-W\d{2}$/;
const monthKey = /^\d{4}-\d{2}$/;

export const summaryQuery = z.object({
  period,
  anchor: dayKey.optional(),
  today: dayKey.optional(),
});

export const listQuery = z.object({ period, limit: limitParam });

export const keyParams = z
  .object({ period, periodKey: z.string() })
  .refine((k) => (k.period === 'week' ? weekKey : monthKey).test(k.periodKey), {
    message: 'periodKey does not match the period',
    path: ['periodKey'],
  });

export const saveBody = z
  .object({
    intentions: z.string().max(5000).optional(),
    reflection: z.string().max(5000).optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    completed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
