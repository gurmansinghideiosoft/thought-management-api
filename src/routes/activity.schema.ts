import { z } from 'zod';

import { dateString, limitParam } from '../schemas/common.ts';

export const activityQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  kind: z.enum(['note', 'link', 'file']).optional(),
  cursor: z.string().optional(),
  limit: limitParam,
});
