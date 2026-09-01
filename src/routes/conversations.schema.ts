import { z } from 'zod';

import { limitParam, objectId } from '../schemas/common.ts';
import { username } from './auth.schema.ts';

export const conversationIdParams = z.object({ id: objectId });
export const messageParams = z.object({ id: objectId, msgId: objectId });

export const dmBody = z.object({ username });

export const messagesQuery = z.object({
  before: z.string().optional(),
  limit: limitParam,
});

export const sendMessageBody = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const backgroundBody = z.object({
  banner: z.string().trim().max(64).nullable(),
});
