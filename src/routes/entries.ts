import { Router } from 'express';

import { badRequest, notFoundError } from '../errors.ts';
import { getAuth } from '../middleware/auth.ts';
import { uploadSingleFile } from '../middleware/upload.ts';
import * as entries from '../services/entry.service.ts';
import { downloadUrlFor, storeUpload } from '../services/upload.service.ts';
import {
  addEntryBody,
  attachTagBody,
  entryParams,
  entryTagParams,
  fileEntryForm,
  starBody,
  thoughtScopedParams,
  timelineQuery,
  updateEntryBody,
} from './entries.schema.ts';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = thoughtScopedParams.parse(req.params);
  const query = timelineQuery.parse(req.query);
  const page = await entries.listTimeline(thoughtId, userId, query);
  res.json({ items: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor });
});

router.post('/', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = thoughtScopedParams.parse(req.params);
  const body = addEntryBody.parse(req.body);
  const entry = await entries.addEntry(thoughtId, userId, body);
  res.status(201).json(entry);
});

router.post('/files', uploadSingleFile, async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId } = thoughtScopedParams.parse(req.params);
  const form = fileEntryForm.parse(req.body);
  if (!req.file) throw badRequest('A "file" field is required');

  const file = await storeUpload(thoughtId, {
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
  const entry = await entries.addEntry(thoughtId, userId, {
    kind: 'file',
    file,
    body: form.body,
    tagIds: form.tagIds,
    starred: form.starred,
  });
  const downloadUrl = await downloadUrlFor(file);
  res.status(201).json({ ...entry.toJSON(), downloadUrl });
});

router.get('/:entryId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  const { entry, downloadUrl } = await entries.getEntryDetail(thoughtId, userId, entryId);
  res.json({ ...entry.toJSON(), downloadUrl });
});

router.patch('/:entryId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  const patch = updateEntryBody.parse(req.body);
  res.json(await entries.updateEntry(thoughtId, userId, entryId, patch));
});

router.delete('/:entryId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  await entries.softDeleteEntry(thoughtId, userId, entryId);
  res.status(204).end();
});

router.post('/:entryId/restore', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  res.json(await entries.restoreEntry(thoughtId, userId, entryId));
});

router.put('/:entryId/star', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  const { starred } = starBody.parse(req.body);
  res.json(await entries.setEntryStarred(thoughtId, userId, entryId, starred));
});

router.post('/:entryId/tags', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  const { tagId } = attachTagBody.parse(req.body);
  res.json(await entries.attachTag(thoughtId, userId, entryId, tagId));
});

router.delete('/:entryId/tags/:tagId', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId, tagId } = entryTagParams.parse(req.params);
  res.json(await entries.detachTag(thoughtId, userId, entryId, tagId));
});

router.get('/:entryId/download', async (req, res) => {
  const { userId } = getAuth(req);
  const { thoughtId, entryId } = entryParams.parse(req.params);
  const { entry, downloadUrl } = await entries.getEntryDetail(thoughtId, userId, entryId);
  if (entry.kind !== 'file' || !downloadUrl) {
    throw notFoundError('This entry has no file to download');
  }
  res.redirect(302, downloadUrl);
});

export default router;
