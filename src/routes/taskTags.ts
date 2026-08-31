import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as taskTags from '../services/taskTag.service.ts';
import { createTaskTagBody, idParams, updateTaskTagBody } from './taskTags.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ items: await taskTags.listTaskTags(userId) });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createTaskTagBody.parse(req.body);
  res.status(201).json(await taskTags.createTaskTag(userId, body));
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateTaskTagBody.parse(req.body);
  res.json(await taskTags.updateTaskTag(userId, id, patch));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await taskTags.deleteTaskTag(userId, id);
  res.status(204).end();
});

export default router;
