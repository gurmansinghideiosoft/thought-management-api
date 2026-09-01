import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as journal from '../services/journal.service.ts';
import {
  dateParams,
  idParams,
  journalPatchBody,
  journalUpsertBody,
  listQuery,
} from './journal.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  const query = listQuery.parse(req.query);
  const page = await journal.listJournal(userId, query);
  res.json({ items: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor });
});

// `/by-date/...` before `/:id`.
router.get('/by-date/:date', async (req, res) => {
  const { userId } = getAuth(req);
  const { date } = dateParams.parse(req.params);
  res.json(await journal.getJournalByDate(userId, date));
});

router.put('/by-date/:date', async (req, res) => {
  const { userId } = getAuth(req);
  const { date } = dateParams.parse(req.params);
  const patch = journalUpsertBody.parse(req.body ?? {});
  res.json(await journal.upsertJournalByDate(userId, date, patch));
});

router.get('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  res.json(await journal.getJournalByIdOrThrow(userId, id));
});

router.patch('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = journalPatchBody.parse(req.body);
  res.json(await journal.updateJournal(userId, id, patch));
});

router.delete('/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await journal.deleteJournal(userId, id);
  res.status(204).end();
});

export default router;
