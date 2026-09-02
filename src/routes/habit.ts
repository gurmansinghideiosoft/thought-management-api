import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as habits from '../services/habit.service.ts';
import {
  createHabitBody,
  entryParams,
  idParams,
  listHabitsQuery,
  monthQuery,
  reorderBody,
  setEntryBody,
  updateHabitBody,
} from './habit.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { date, includeArchived } = listHabitsQuery.parse(req.query);
  res.json({ items: await habits.listHabits(userId, { date, includeArchived }) });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createHabitBody.parse(req.body);
  res.status(201).json(await habits.createHabit(userId, body));
});

// Before `/:id` so "reorder" isn't read as an id.
router.put('/reorder', async (req, res) => {
  const { userId } = getAuth(req);
  const { ids } = reorderBody.parse(req.body);
  await habits.reorderHabits(userId, ids);
  res.status(204).end();
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateHabitBody.parse(req.body);
  res.json(await habits.updateHabit(userId, id, patch));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await habits.deleteHabit(userId, id);
  res.status(204).end();
});

router.get('/:id/month', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const { month } = monthQuery.parse(req.query);
  res.json(await habits.getHabitMonth(userId, id, month));
});

router.put('/:id/entries/:date', async (req, res) => {
  const { userId } = getAuth(req);
  const { id, date } = entryParams.parse(req.params);
  const { value } = setEntryBody.parse(req.body);
  res.json({ entry: await habits.setEntry(userId, id, date, value) });
});

export default router;
