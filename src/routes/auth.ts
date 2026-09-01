import { Router } from 'express';

import { getAuth, requireAuth } from '../middleware/auth.ts';
import * as auth from '../services/auth.service.ts';
import {
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  updateMeBody,
} from './auth.schema.ts';

const router = Router();

router.post('/register', async (req, res) => {
  const body = registerBody.parse(req.body);
  const { user, accessToken, refreshToken } = await auth.register(body);
  res.status(201).json({ user, accessToken, refreshToken });
});

router.post('/login', async (req, res) => {
  const body = loginBody.parse(req.body);
  const { user, accessToken, refreshToken } = await auth.login(body);
  res.json({ user, accessToken, refreshToken });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = refreshBody.parse(req.body);
  res.json(await auth.refresh(refreshToken));
});

router.post('/logout', requireAuth, async (req, res) => {
  const { jti, exp } = getAuth(req);
  const { refreshToken } = logoutBody.parse(req.body);
  await auth.logout({ accessJti: jti, accessExp: exp, refreshToken });
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await auth.getMe(getAuth(req).userId);
  res.json({ user });
});

router.patch('/me', requireAuth, async (req, res) => {
  const patch = updateMeBody.parse(req.body);
  const user = await auth.updateProfile(getAuth(req).userId, patch);
  res.json({ user });
});

export default router;
