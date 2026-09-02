import { Router } from 'express';

import { todayUtc } from '../lib/day.ts';
import { getAuth } from '../middleware/auth.ts';
import * as log from '../services/log.service.ts';
import { createBody, idParams, listQuery, updateBody } from './log.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { date = todayUtc() } = listQuery.parse(req.query);
  res.json({ date, items: await log.listLog(userId, date) });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { text, date } = createBody.parse(req.body);
  res.status(201).json(await log.createLog(userId, text, date));
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateBody.parse(req.body);
  res.json(await log.updateLog(userId, id, patch));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await log.deleteLog(userId, id);
  res.status(204).end();
});

export default router;
