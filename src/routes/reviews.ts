import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as reviews from '../services/review.service.ts';
import { keyParams, listQuery, saveBody, summaryQuery } from './reviews.schema.ts';

const router = Router();

router.get('/summary', async (req, res) => {
  const { userId } = getAuth(req);
  const { period, anchor, today } = summaryQuery.parse(req.query);
  res.json(await reviews.getReviewSummary(userId, { period, anchor, today }));
});

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { period, limit } = listQuery.parse(req.query);
  res.json({ items: await reviews.listReviews(userId, period, limit) });
});

router.put('/:period/:periodKey', async (req, res) => {
  const { userId } = getAuth(req);
  const { period, periodKey } = keyParams.parse(req.params);
  const patch = saveBody.parse(req.body ?? {});
  res.json(await reviews.saveReview(userId, period, periodKey, patch));
});

export default router;
