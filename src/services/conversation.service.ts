import { Types } from 'mongoose';

import { badRequest, notFoundError } from '../errors.ts';
import { type PublicUser, toPublicUser } from '../lib/publicUser.ts';
import { Conversation, type ConversationDocument } from '../models/conversation.model.ts';
import { Message } from '../models/message.model.ts';
import { Thought } from '../models/thought.model.ts';
import { ThoughtInvite } from '../models/thoughtInvite.model.ts';
import { User } from '../models/user.model.ts';
import { assertParticipant } from './thoughtShare.service.ts';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Current members of a thought's discussion: owner + accepted collaborators. */
const thoughtMemberIds = async (
  thoughtId: Types.ObjectId,
  ownerId: Types.ObjectId,
): Promise<Types.ObjectId[]> => {
  const accepted = await ThoughtInvite.find({
    thoughtId,
    status: 'accepted',
    inviteeUserId: { $ne: null },
  }).select('inviteeUserId');
  return [ownerId, ...accepted.map((i) => i.inviteeUserId as Types.ObjectId)];
};

/** The thought's discussion conversation, created on first use. */
export const getOrCreateThoughtConversation = async (
  thoughtId: string,
  userId: string,
): Promise<ConversationDocument> => {
  const { thought } = await assertParticipant(thoughtId, userId);
  const memberIds = await thoughtMemberIds(thought._id, thought.ownerId);

  return (await Conversation.findOneAndUpdate(
    { kind: 'thought', thoughtId: thought._id },
    {
      // Kept in sync on every open so it self-heals as membership changes.
      $set: { memberIds },
      $setOnInsert: { kind: 'thought', thoughtId: thought._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )) as ConversationDocument;
};

/** The 1:1 conversation between the caller and `username`, created on first use. */
export const getOrCreateDm = async (
  userId: string,
  username: string,
): Promise<ConversationDocument> => {
  const other = await User.findOne({ username: username.toLowerCase() });
  if (!other) throw notFoundError('No user with that username');
  if (String(other._id) === userId) throw badRequest('You cannot message yourself');

  const ids = [userId, String(other._id)].sort();
  const dmKey = ids.join(':');

  return (await Conversation.findOneAndUpdate(
    { kind: 'dm', dmKey },
    {
      $setOnInsert: {
        kind: 'dm',
        dmKey,
        memberIds: ids.map((id) => oid(id)),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )) as ConversationDocument;
};

export const assertMember = async (
  conversationId: string,
  userId: string,
): Promise<ConversationDocument> => {
  const conv = await Conversation.findOne({
    _id: conversationId,
    memberIds: oid(userId),
  });
  if (!conv) throw notFoundError('Conversation not found');
  return conv;
};

const lastReadFor = (conv: ConversationDocument, userId: string): Date | null =>
  conv.reads.find((r) => String(r.userId) === userId)?.lastReadAt ?? null;

/** The caller's chosen chat wallpaper for this conversation, if any. */
const bgFor = (conv: ConversationDocument, userId: string): string | null =>
  conv.backgrounds.find((b) => String(b.userId) === userId)?.banner ?? null;

/** The shape the raw-doc endpoints (`dm`, thought conversation) return. */
export interface ConversationView {
  id: string;
  kind: 'thought' | 'dm';
  thoughtId: string | null;
  memberIds: string[];
  lastMessageAt: string;
  /** The *caller's* wallpaper choice for this conversation. */
  background: string | null;
}

export const toConversationView = (
  conv: ConversationDocument,
  userId: string,
): ConversationView => ({
  id: String(conv._id),
  kind: conv.kind,
  thoughtId: conv.thoughtId ? String(conv.thoughtId) : null,
  memberIds: conv.memberIds.map(String),
  lastMessageAt: conv.lastMessageAt.toISOString(),
  background: bgFor(conv, userId),
});

export interface ConversationSummary {
  id: string;
  kind: 'thought' | 'dm';
  /** Present for `kind: 'dm'`. */
  peer?: PublicUser;
  /** Present for `kind: 'thought'`. */
  thought?: { id: string; title: string };
  lastMessage: { body: string; authorId: string; at: string } | null;
  lastMessageAt: string;
  unreadCount: number;
  /** The caller's chat-wallpaper choice for this conversation. */
  background: string | null;
}

export const listConversations = async (
  userId: string,
): Promise<ConversationSummary[]> => {
  const convs = await Conversation.find({ memberIds: oid(userId) }).sort({
    lastMessageAt: -1,
  });

  // Batch the lookups the decoration needs.
  const peerIds = convs
    .filter((c) => c.kind === 'dm')
    .flatMap((c) => c.memberIds.filter((m) => String(m) !== userId));
  const thoughtIds = convs
    .filter((c) => c.kind === 'thought' && c.thoughtId)
    .map((c) => c.thoughtId as Types.ObjectId);

  const [peers, thoughts, unreadCounts] = await Promise.all([
    User.find({ _id: { $in: peerIds } }),
    Thought.find({ _id: { $in: thoughtIds } })
      .setOptions({ withDeleted: true })
      .select('title'),
    Promise.all(
      convs.map((c) =>
        Message.countDocuments({
          conversationId: c._id,
          authorId: { $ne: oid(userId) },
          deletedAt: null,
          createdAt: { $gt: lastReadFor(c, userId) ?? c.createdAt },
        }),
      ),
    ),
  ]);
  const peerById = new Map(peers.map((u) => [String(u._id), u]));
  const titleById = new Map(thoughts.map((t) => [String(t._id), t.title]));

  return convs.map((c, i) => {
    const base: ConversationSummary = {
      id: String(c._id),
      kind: c.kind,
      lastMessage: c.lastMessage
        ? {
            body: c.lastMessage.body,
            authorId: String(c.lastMessage.authorId),
            at: c.lastMessage.at.toISOString(),
          }
        : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unreadCount: unreadCounts[i] ?? 0,
      background: bgFor(c, userId),
    };
    if (c.kind === 'dm') {
      const peerId = c.memberIds.find((m) => String(m) !== userId);
      const peer = peerId ? peerById.get(String(peerId)) : undefined;
      if (peer) base.peer = toPublicUser(peer);
    } else if (c.thoughtId) {
      base.thought = {
        id: String(c.thoughtId),
        title: titleById.get(String(c.thoughtId)) ?? '(untitled)',
      };
    }
    return base;
  });
};

export const markRead = async (conversationId: string, userId: string): Promise<void> => {
  await assertMember(conversationId, userId);
  const now = new Date();
  const res = await Conversation.updateOne(
    { _id: conversationId, 'reads.userId': oid(userId) },
    { $set: { 'reads.$.lastReadAt': now } },
  );
  if (res.matchedCount === 0) {
    await Conversation.updateOne(
      { _id: conversationId, 'reads.userId': { $ne: oid(userId) } },
      { $push: { reads: { userId: oid(userId), lastReadAt: now } } },
    );
  }
};

/** Set (or clear, with `null`) the caller's chat wallpaper for one conversation. */
export const setBackground = async (
  conversationId: string,
  userId: string,
  banner: string | null,
): Promise<void> => {
  await assertMember(conversationId, userId);
  if (banner === null) {
    await Conversation.updateOne(
      { _id: conversationId },
      { $pull: { backgrounds: { userId: oid(userId) } } },
    );
    return;
  }
  const res = await Conversation.updateOne(
    { _id: conversationId, 'backgrounds.userId': oid(userId) },
    { $set: { 'backgrounds.$.banner': banner } },
  );
  if (res.matchedCount === 0) {
    await Conversation.updateOne(
      { _id: conversationId, 'backgrounds.userId': { $ne: oid(userId) } },
      { $push: { backgrounds: { userId: oid(userId), banner } } },
    );
  }
};
