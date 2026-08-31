import { Router } from 'express';

import * as tags from '../services/tag.service.ts';
import {
  createTagBody,
  tagParams,
  tagScopedParams,
  updateTagBody,
} from './tags.schema.ts';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const { thoughtId } = tagScopedParams.parse(req.params);
  res.json({ items: await tags.listTags(thoughtId) });
});

router.post('/', async (req, res) => {
  const { thoughtId } = tagScopedParams.parse(req.params);
  const body = createTagBody.parse(req.body);
  res.status(201).json(await tags.createTag(thoughtId, body));
});

router.patch('/:tagId', async (req, res) => {
  const { thoughtId, tagId } = tagParams.parse(req.params);
  const patch = updateTagBody.parse(req.body);
  res.json(await tags.updateTag(thoughtId, tagId, patch));
});

router.delete('/:tagId', async (req, res) => {
  const { thoughtId, tagId } = tagParams.parse(req.params);
  await tags.deleteTag(thoughtId, tagId);
  res.status(204).end();
});

export default router;
