import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as tags from '../services/tag.service.ts';
import {
  createTagBody,
  tagParams,
  tagScopedParams,
  updateTagBody,
} from './tags.schema.ts';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = tagScopedParams.parse(req.params);
  res.json({ items: await tags.listTags(thoughtId, userId) });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = tagScopedParams.parse(req.params);
  const body = createTagBody.parse(req.body);
  res.status(201).json(await tags.createTag(thoughtId, userId, body));
});

router.patch('/:tagId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, tagId } = tagParams.parse(req.params);
  const patch = updateTagBody.parse(req.body);
  res.json(await tags.updateTag(thoughtId, userId, tagId, patch));
});

router.delete('/:tagId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, tagId } = tagParams.parse(req.params);
  await tags.deleteTag(thoughtId, userId, tagId);
  res.status(204).end();
});

export default router;
