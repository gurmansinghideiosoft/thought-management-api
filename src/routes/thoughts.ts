import { Router } from 'express';

import * as thoughts from '../services/thought.service.ts';
import entriesRouter from './entries.ts';
import tagsRouter from './tags.ts';
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
  const body = createThoughtBody.parse(req.body);
  const thought = await thoughts.createThought(body);
  res.status(201).json(thought);
});

router.get('/', async (req, res) => {
  const query = listThoughtsQuery.parse(req.query);
  const result = await thoughts.listThoughts(query);
  res.json({ items: result.items, pagination: pagination(result) });
});

// Must be declared before `/:id` so "trash" isn't parsed as an id.
router.get('/trash', async (req, res) => {
  const query = pageQuery.parse(req.query);
  const result = await thoughts.listTrashedThoughts(query);
  res.json({ items: result.items, pagination: pagination(result) });
});

router.get('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.getThoughtOrThrow(id));
});

router.get('/:id/stats', async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.getThoughtStats(id));
});

router.patch('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const patch = updateThoughtBody.parse(req.body);
  res.json(await thoughts.updateThought(id, patch));
});

router.post('/:id/archive', async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.setThoughtStatus(id, 'archived'));
});

router.post('/:id/unarchive', async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.setThoughtStatus(id, 'active'));
});

router.delete('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  await thoughts.softDeleteThought(id);
  res.status(204).end();
});

router.post('/:id/restore', async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await thoughts.restoreThought(id));
});

// Sub-resources scoped to a thought.
router.use('/:thoughtId/entries', entriesRouter);
router.use('/:thoughtId/tags', tagsRouter);

export default router;
