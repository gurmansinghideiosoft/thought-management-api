import { Types } from 'mongoose';

import { notFoundError } from '../errors.ts';
import { decodeCursor, encodeCursor, keysetClause, keysetSort } from '../lib/cursor.ts';
import { type PublicUser, toPublicUser } from '../lib/publicUser.ts';
import { Conversation } from '../models/conversation.model.ts';
import { Message, type MessageDocument } from '../models/message.model.ts';
import { User } from '../models/user.model.ts';
import { assertMember } from './conversation.service.ts';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export interface MessageView {
  id: string;
  conversationId: string;
  body: string;
  author: PublicUser;
  createdAt: string;
}

const toView = (msg: MessageDocument, author: PublicUser): MessageView => ({
  id: String(msg._id),
  conversationId: String(msg.conversationId),
  body: msg.body,
  author,
  createdAt: msg.createdAt.toISOString(),
});

export interface MessagePage {
  /** Oldest-first, like a chat transcript. */
  items: MessageView[];
  hasMore: boolean;
  /** Pass back as `before` to load older messages. */
  nextCursor: string | null;
}

export const listMessages = async (
  conversationId: string,
  userId: string,
  params: { before?: string; limit: number },
): Promise<MessagePage> => {
  await assertMember(conversationId, userId);

  const base: Record<string, unknown> = {
    conversationId: oid(conversationId),
    deletedAt: null,
  };

  let filter: Record<string, unknown> = base;
  if (params.before) {
    const pos = decodeCursor(params.before);
    filter = {
      $and: [
        base,
        keysetClause('before', {
          createdAt: pos.createdAt,
          id: new Types.ObjectId(pos.id),
        }),
      ],
    };
  }

  const docs = await Message.find(filter)
    .sort(keysetSort('before'))
    .limit(params.limit + 1);

  const hasMore = docs.length > params.limit;
  const page = hasMore ? docs.slice(0, params.limit) : docs;
  const items = [...page].reverse(); // -> oldest first

  const authors = await User.find({
    _id: { $in: [...new Set(items.map((m) => String(m.authorId)))] },
  });
  const authorById = new Map(authors.map((u) => [String(u._id), u]));
  const fallback: PublicUser = { id: '', username: null, name: '' };

  let nextCursor: string | null = null;
  if (hasMore) {
    const boundary = items.at(0);
    if (boundary) nextCursor = encodeCursor(boundary.createdAt, String(boundary._id));
  }

  return {
    items: items.map((m) => {
      const author = authorById.get(String(m.authorId));
      return toView(
        m,
        author ? toPublicUser(author) : { ...fallback, id: String(m.authorId) },
      );
    }),
    hasMore,
    nextCursor,
  };
};

export const sendMessage = async (
  conversationId: string,
  userId: string,
  body: string,
): Promise<MessageView> => {
  await assertMember(conversationId, userId);

  const msg = await Message.create({
    conversationId: oid(conversationId),
    authorId: oid(userId),
    body,
  });

  await Conversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessageAt: msg.createdAt,
        lastMessage: { body: msg.body, authorId: msg.authorId, at: msg.createdAt },
      },
    },
  );

  const author = await User.findById(userId);
  return toView(
    msg,
    author ? toPublicUser(author) : { id: userId, username: null, name: '' },
  );
};

export const deleteMessage = async (
  conversationId: string,
  userId: string,
  messageId: string,
): Promise<void> => {
  await assertMember(conversationId, userId);
  const msg = await Message.findOne({
    _id: messageId,
    conversationId: oid(conversationId),
    authorId: oid(userId),
    deletedAt: null,
  });
  if (!msg) throw notFoundError('Message not found');
  msg.deletedAt = new Date();
  await msg.save();
};
