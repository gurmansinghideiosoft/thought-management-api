import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as finance from '../services/finance.service.ts';
import {
  createTagBody,
  createTransactionsBody,
  idParams,
  rangeQuery,
  updateTagBody,
  updateTransactionBody,
} from './finance.schema.ts';

const router = Router();

// --- tags -------------------------------------------------------------

router.get('/tags', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ items: await finance.listTags(userId) });
});

router.post('/tags', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createTagBody.parse(req.body);
  res.status(201).json(await finance.createTag(userId, body));
});

router.patch('/tags/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateTagBody.parse(req.body);
  res.json(await finance.updateTag(userId, id, patch));
});

router.delete('/tags/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await finance.deleteTag(userId, id);
  res.status(204).end();
});

// --- transactions ---------------------------------------------------

router.get('/transactions', async (req, res) => {
  const { userId } = getAuth(req);
  const range = rangeQuery.parse(req.query);
  res.json({ items: await finance.listTransactions(userId, range) });
});

router.post('/transactions', async (req, res) => {
  const { userId } = getAuth(req);
  const { transactions } = createTransactionsBody.parse(req.body);
  res.status(201).json({ items: await finance.createTransactions(userId, transactions) });
});

router.patch('/transactions/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  const patch = updateTransactionBody.parse(req.body);
  res.json(await finance.updateTransaction(userId, id, patch));
});

router.delete('/transactions/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParams.parse(req.params);
  await finance.deleteTransaction(userId, id);
  res.status(204).end();
});

// --- analytics ----------------------------------------------------

router.get('/summary', async (req, res) => {
  const { userId } = getAuth(req);
  const range = rangeQuery.parse(req.query);
  res.json(await finance.getSummary(userId, range));
});

export default router;
