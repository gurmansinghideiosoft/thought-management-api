import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as vault from '../services/vault.service.ts';
import {
  createCredentialBody,
  credentialParams,
  keystoreBody,
  updateCredentialBody,
} from './vault.schema.ts';

/**
 * Mounted at `/api/vault` behind `requireAuth`. Everything the server stores
 * here is opaque ciphertext (plus a public KDF salt) — it can never read a
 * credential.
 */
const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ keystore: await vault.getKeystore(userId) });
});

router.post('/setup', async (req, res) => {
  const { userId } = getAuth(req);
  const body = keystoreBody.parse(req.body);
  res.status(201).json(await vault.setupVault(userId, body));
});

router.put('/rekey', async (req, res) => {
  const { userId } = getAuth(req);
  const body = keystoreBody.parse(req.body);
  res.json(await vault.rekeyVault(userId, body));
});

router.delete('/', async (req, res) => {
  const { userId } = getAuth(req);
  await vault.resetVault(userId);
  res.status(204).end();
});

router.get('/credentials', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ items: await vault.listCredentials(userId) });
});

router.post('/credentials', async (req, res) => {
  const { userId } = getAuth(req);
  const body = createCredentialBody.parse(req.body);
  res.status(201).json(await vault.createCredential(userId, body));
});

router.get('/credentials/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = credentialParams.parse(req.params);
  res.json(await vault.getCredentialOrThrow(userId, id));
});

router.patch('/credentials/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = credentialParams.parse(req.params);
  const patch = updateCredentialBody.parse(req.body);
  res.json(await vault.updateCredential(userId, id, patch));
});

router.delete('/credentials/:id', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = credentialParams.parse(req.params);
  await vault.deleteCredential(userId, id);
  res.status(204).end();
});

export default router;
