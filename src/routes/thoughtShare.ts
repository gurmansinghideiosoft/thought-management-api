import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as share from '../services/thoughtShare.service.ts';
import {
  inviteBody,
  inviteParams,
  memberParams,
  thoughtScopedParams,
} from './thoughtShare.schema.ts';

/** Mounted at `/api/thoughts/:thoughtId/invites`. */
export const thoughtInvitesRouter = Router({ mergeParams: true });

thoughtInvitesRouter.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = thoughtScopedParams.parse(req.params);
  const { emails } = inviteBody.parse(req.body);
  const result = await share.inviteToThought(userId, thoughtId, emails);
  res.status(201).json({
    created: result.created,
    skipped: result.skipped,
  });
});

thoughtInvitesRouter.delete('/:inviteId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, inviteId } = inviteParams.parse(req.params);
  await share.revokePendingInvite(userId, thoughtId, inviteId);
  res.status(204).end();
});

/** Mounted at `/api/thoughts/:thoughtId/members`. */
export const thoughtMembersRouter = Router({ mergeParams: true });

thoughtMembersRouter.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = thoughtScopedParams.parse(req.params);
  res.json(await share.listMembers(thoughtId, userId));
});

thoughtMembersRouter.delete('/:userId', async (req, res) => {
  const { userId: actingUserId } = getAuth(req);
  const { thoughtId, userId: targetUserId } = memberParams.parse(req.params);
  await share.removeMember(actingUserId, thoughtId, targetUserId);
  res.status(204).end();
});
