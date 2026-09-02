import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as capture from '../services/capture.service.ts';
import {
  createCaptureBody,
  idParams,
  listQuery,
  updateCaptureBody,
} from './capture.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { status } = listQuery.parse(req.query);
  res.json({ items: await capture.listCaptures(userId, status) });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { text } = createCaptureBody.parse(req.body);
  res.status(201).json(await capture.createCapture(userId, text));
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateCaptureBody.parse(req.body);
  res.json(await capture.updateCapture(userId, id, patch));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await capture.deleteCapture(userId, id);
  res.status(204).end();
});

export default router;
