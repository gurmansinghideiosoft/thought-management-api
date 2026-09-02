import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

const text = z.string().trim().min(1).max(5000);
const status = z.enum(['open', 'archived']);

export const idParams = z.object({ id: objectId });

export const listQuery = z.object({ status: status.default('open') });

export const createCaptureBody = z.object({ text });

export const updateCaptureBody = z
  .object({ text: text.optional(), status: status.optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  });
