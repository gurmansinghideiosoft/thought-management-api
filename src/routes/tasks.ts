import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as tasks from '../services/task.service.ts';
import {
  calendarQuery,
  createTaskBody,
  idParams,
  listTasksQuery,
  statusBody,
  updateTaskBody,
} from './tasks.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const query = listTasksQuery.parse(req.query);
  const items = await tasks.listTasks(userId, {
    from: query.from,
    to: query.to,
    status: query.status,
    tagIds: query.tags,
    priorities: query.priority,
    q: query.q,
  });
  res.json({ items });
});

// Declared before `/:id`-style routes (there are none, but keep it explicit).
router.get('/calendar', async (req, res) => {
  const { userId } = getAuth(req);
  const query = calendarQuery.parse(req.query);
  const counts = await tasks.taskCalendar(userId, {
    month: query.month,
    status: query.status,
    tagIds: query.tags,
    priorities: query.priority,
  });
  res.json({ month: query.month, counts });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createTaskBody.parse(req.body);
  const task = await tasks.createTask(userId, body);
  res.status(201).json(task);
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateTaskBody.parse(req.body);
  res.json(await tasks.updateTask(userId, id, patch));
});

router.put('/:id/status', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const { status } = statusBody.parse(req.body);
  res.json(await tasks.setTaskStatus(userId, id, status));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await tasks.deleteTask(userId, id);
  res.status(204).end();
});

export default router;
