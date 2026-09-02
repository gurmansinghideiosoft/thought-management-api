import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as search from '../services/search.service.ts';
import { searchQuery } from './search.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { q, limit } = searchQuery.parse(req.query);
  res.json(await search.globalSearch(userId, q, limit));
});

export default router;
