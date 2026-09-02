import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const text = z.string().trim().min(1).max(2000);

export const idParams = z.object({ id: objectId });

export const listQuery = z.object({ date: dayKey.optional() });

export const createBody = z.object({ text, date: dayKey.optional() });

export const updateBody = z
  .object({ text: text.optional(), date: dayKey.optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });
