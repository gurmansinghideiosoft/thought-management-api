import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import * as conversations from '../services/conversation.service.ts';
import * as messages from '../services/message.service.ts';
import {
  backgroundBody,
  conversationIdParams,
  dmBody,
  messageParams,
  messagesQuery,
  sendMessageBody,
} from './conversations.schema.ts';

const router = Router();

router.get('/', async (req, res) => {
  const { userId } = getAuth(req);
  res.json({ items: await conversations.listConversations(userId) });
});

router.post('/dm', async (req, res) => {
  const { userId } = getAuth(req);
  const { username } = dmBody.parse(req.body);
  const conv = await conversations.getOrCreateDm(userId, username);
  res.status(201).json(conversations.toConversationView(conv, userId));
});

router.get('/:id/messages', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = conversationIdParams.parse(req.params);
  const query = messagesQuery.parse(req.query);
  const page = await messages.listMessages(id, userId, query);
  res.json({ items: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor });
});

router.post('/:id/messages', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = conversationIdParams.parse(req.params);
  const { body } = sendMessageBody.parse(req.body);
  res.status(201).json(await messages.sendMessage(id, userId, body));
});

router.post('/:id/read', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = conversationIdParams.parse(req.params);
  await conversations.markRead(id, userId);
  res.status(204).end();
});

router.put('/:id/background', async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = conversationIdParams.parse(req.params);
  const { banner } = backgroundBody.parse(req.body);
  await conversations.setBackground(id, userId, banner);
  res.status(204).end();
});

router.delete('/:id/messages/:msgId', async (req, res) => {
  const { userId } = getAuth(req);
  const { id, msgId } = messageParams.parse(req.params);
  await messages.deleteMessage(id, userId, msgId);
  res.status(204).end();
});

export default router;
