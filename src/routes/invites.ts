import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as share from '../services/thoughtShare.service.ts';
import { inviteIdParams } from './thoughtShare.schema.ts';

/** Mounted at `/api/invites` — the invitee's side. */
const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ items: await share.listMyInvites(userId) });
});

router.post('/:id/accept', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = inviteIdParams.parse(req.params);
  res.json(await share.respondToInvite(userId, id, 'accept'));
});

router.post('/:id/decline', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = inviteIdParams.parse(req.params);
  res.json(await share.respondToInvite(userId, id, 'decline'));
});

export default router;
