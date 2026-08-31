import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import { getActivityFeed } from '../services/activity.service.ts';
import { activityQuery } from './activity.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const query = activityQuery.parse(req.query);
  const page = await getActivityFeed(userId, query);
  res.json({ items: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor });
});

export default router;
