import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as thoughts from '../services/thought.service.ts';
import entriesRouter from './entries.ts';
import tagsRouter from './tags.ts';
import { thoughtInvitesRouter, thoughtMembersRouter } from './thoughtShare.ts';
import {
  createThoughtBody,
  idParams,
  listThoughtsQuery,
  pageQuery,
  updateThoughtBody,
} from './thoughts.schema.ts';

const router = Router();

interface Paged {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
const pagination = (result: Paged) => ({
  page: result.page,
  limit: result.limit,
  total: result.total,
  totalPages: result.totalPages,
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createThoughtBody.parse(req.body);
  const thought = await thoughts.createThought(userId, body);
  res.status(201).json(thought);
});

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const query = listThoughtsQuery.parse(req.query);
  const result = await thoughts.listThoughts(userId, query);
  res.json({ items: result.items, pagination: pagination(result) });
});

// Must be declared before `/:id` so "trash" isn't parsed as an id.
router.get('/trash', async (req, res) => {
  const { userId } = getAuth(req);
  const query = pageQuery.parse(req.query);
  const result = await thoughts.listTrashedThoughts(userId, query);
  res.json({ items: result.items, pagination: pagination(result) });
});

router.get('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.getThoughtForReader(id, userId));
});

router.get('/:id/stats', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.getThoughtStats(id, userId));
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateThoughtBody.parse(req.body);
  res.json(await thoughts.updateThought(id, userId, patch));
});

router.post('/:id/archive', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.setThoughtStatus(id, userId, 'archived'));
});

router.post('/:id/unarchive', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.setThoughtStatus(id, userId, 'active'));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await thoughts.softDeleteThought(id, userId);
  res.status(204).end();
});

router.post('/:id/restore', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.restoreThought(id, userId));
});

// Sub-resources scoped to a thought.
router.use('/:thoughtId/entries', entriesRouter);
router.use('/:thoughtId/tags', tagsRouter);
router.use('/:thoughtId/invites', thoughtInvitesRouter);
router.use('/:thoughtId/members', thoughtMembersRouter);

export default router;
