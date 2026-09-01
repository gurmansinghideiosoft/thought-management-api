import { z } from 'zod';

import { objectId } from '../schemas/common.ts';

export const thoughtScopedParams = z.object({ thoughtId: objectId });

export const inviteParams = z.object({
  thoughtId: objectId,
  inviteId: objectId,
});

export const memberParams = z.object({
  thoughtId: objectId,
  userId: objectId,
});

export const inviteBody = z.object({
  emails: z.array(z.email().max(254)).min(1).max(50),
});

export const inviteIdParams = z.object({ id: objectId });
