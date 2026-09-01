import { Router } from 'express';

import { todayUtc } from '../lib/day.ts';
import { getAuth } from '../middleware/auth.ts';
import * as routine from '../services/routine.service.ts';
import { activeItemsOn } from '../services/routine.service.ts';
import {
  addItemBody,
  itemParams,
  reorderBody,
  updateItemBody,
} from './routine.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const doc = await routine.getRoutine(userId);
  const includeRetired = req.query.includeRetired === 'true';
  const items = includeRetired ? doc.items : activeItemsOn(doc, todayUtc());
  res.json({ items });
});

router.post('/items', async (req, res) => {
  const { userId } = getAuth(req);
  const body = addItemBody.parse(req.body);
  res.status(201).json(await routine.addRoutineItem(userId, body));
});

router.patch('/items/:itemId', async (req, res) => {
  const { userId } = getAuth(req);
  const { itemId } = itemParams.parse(req.params);
  const patch = updateItemBody.parse(req.body);
  res.json(await routine.updateRoutineItem(userId, itemId, patch));
});

router.delete('/items/:itemId', async (req, res) => {
  const { userId } = getAuth(req);
  const { itemId } = itemParams.parse(req.params);
  await routine.removeRoutineItem(userId, itemId);
  res.status(204).end();
});

router.put('/items/order', async (req, res) => {
  const { userId } = getAuth(req);
  const { itemIds } = reorderBody.parse(req.body);
  const doc = await routine.reorderRoutineItems(userId, itemIds);
  res.json({ items: activeItemsOn(doc, todayUtc()) });
});

export default router;
