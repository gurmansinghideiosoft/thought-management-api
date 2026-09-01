import { Types } from 'mongoose';

import { badRequest, conflict, notFoundError } from '../errors.ts';
import { type PublicUser, toPublicUser } from '../lib/publicUser.ts';
import { Thought, type ThoughtDocument } from '../models/thought.model.ts';
import {
  ThoughtInvite,
  type ThoughtInviteDocument,
} from '../models/thoughtInvite.model.ts';
import { User, type UserDocument } from '../models/user.model.ts';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export type ThoughtRole = 'owner' | 'collaborator';

export interface Participation {
  thought: ThoughtDocument;
  role: ThoughtRole;
}

/**
 * Gate for reading a thought: the owner, or someone with an accepted invite.
 * Anyone else gets a 404 — never 403 — matching the rest of the codebase.
 */
export const assertParticipant = async (
  thoughtId: string,
  userId: string,
): Promise<Participation> => {
  const thought = await Thought.findById(thoughtId);
  if (!thought) throw notFoundError('Thought not found');

  if (String(thought.ownerId) === userId) return { thought, role: 'owner' };

  const accepted = await ThoughtInvite.exists({
    thoughtId: thought._id,
    inviteeUserId: oid(userId),
    status: 'accepted',
  });
  if (accepted) return { thought, role: 'collaborator' };

  throw notFoundError('Thought not found');
};

/** Thought ids the user collaborates on (accepted invites). For list queries. */
export const acceptedThoughtIdsFor = async (
  userId: string,
): Promise<Types.ObjectId[]> => {
  const rows = await ThoughtInvite.find({
    inviteeUserId: oid(userId),
    status: 'accepted',
  }).select('thoughtId');
  return rows.map((r) => r.thoughtId);
};

/** Owner-only: `Thought.findOne({ _id, ownerId })` or 404. */
const ownedThoughtOrThrow = async (
  thoughtId: string,
  ownerId: string,
): Promise<ThoughtDocument> => {
  const thought = await Thought.findOne({ _id: thoughtId, ownerId: oid(ownerId) });
  if (!thought) throw notFoundError('Thought not found');
  return thought;
};

export interface InviteResult {
  created: ThoughtInviteDocument[];
  skipped: { email: string; reason: 'already-invited' | 'already-member' | 'is-owner' }[];
}

/** Owner invites a batch of emails. Existing pending/accepted rows are skipped. */
export const inviteToThought = async (
  ownerId: string,
  thoughtId: string,
  emails: string[],
): Promise<InviteResult> => {
  const thought = await ownedThoughtOrThrow(thoughtId, ownerId);
  const owner = await User.findById(ownerId);

  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const existing = await ThoughtInvite.find({
    thoughtId: thought._id,
    email: { $in: wanted },
    status: { $in: ['pending', 'accepted'] },
  });
  const byEmail = new Map(existing.map((inv) => [inv.email, inv]));

  const created: ThoughtInviteDocument[] = [];
  const skipped: InviteResult['skipped'] = [];

  for (const email of wanted) {
    if (owner && email === owner.email) {
      skipped.push({ email, reason: 'is-owner' });
      continue;
    }
    const prior = byEmail.get(email);
    if (prior) {
      skipped.push({
        email,
        reason: prior.status === 'accepted' ? 'already-member' : 'already-invited',
      });
      continue;
    }
    const invitee = await User.findOne({ email }).select('_id');
    created.push(
      await ThoughtInvite.create({
        thoughtId: thought._id,
        inviterId: oid(ownerId),
        email,
        inviteeUserId: invitee?._id ?? null,
      }),
    );
  }

  return { created, skipped };
};

export interface ThoughtMembers {
  owner: PublicUser;
  collaborators: PublicUser[];
  pendingInvites: { id: string; email: string }[];
}

/** Any participant can see who else is on the thought. */
export const listMembers = async (
  thoughtId: string,
  userId: string,
): Promise<ThoughtMembers> => {
  const { thought } = await assertParticipant(thoughtId, userId);

  const invites = await ThoughtInvite.find({
    thoughtId: thought._id,
    status: { $in: ['accepted', 'pending'] },
  });
  const acceptedUserIds = invites
    .filter((i) => i.status === 'accepted' && i.inviteeUserId)
    .map((i) => i.inviteeUserId as Types.ObjectId);

  const [owner, collaborators] = await Promise.all([
    User.findById(thought.ownerId),
    User.find({ _id: { $in: acceptedUserIds } }),
  ]);
  if (!owner) throw notFoundError('Thought owner not found');

  return {
    owner: toPublicUser(owner),
    collaborators: collaborators.map(toPublicUser),
    pendingInvites: invites
      .filter((i) => i.status === 'pending')
      .map((i) => ({ id: String(i._id), email: i.email })),
  };
};

/** Owner removes a collaborator (or a collaborator removes themselves). */
export const removeMember = async (
  actingUserId: string,
  thoughtId: string,
  targetUserId: string,
): Promise<void> => {
  const thought = await Thought.findById(thoughtId);
  if (!thought) throw notFoundError('Thought not found');

  const isOwner = String(thought.ownerId) === actingUserId;
  if (!isOwner && actingUserId !== targetUserId) {
    // Not the owner and not removing yourself — you can't even see this.
    throw notFoundError('Thought not found');
  }
  if (String(thought.ownerId) === targetUserId) {
    throw badRequest('The owner cannot be removed');
  }

  await ThoughtInvite.updateMany(
    { thoughtId: thought._id, inviteeUserId: oid(targetUserId), status: 'accepted' },
    { $set: { status: 'revoked', respondedAt: new Date() } },
  );
};

/** Owner cancels an invite that hasn't been accepted yet. */
export const revokePendingInvite = async (
  ownerId: string,
  thoughtId: string,
  inviteId: string,
): Promise<void> => {
  const thought = await ownedThoughtOrThrow(thoughtId, ownerId);
  const invite = await ThoughtInvite.findOne({
    _id: inviteId,
    thoughtId: thought._id,
    status: 'pending',
  });
  if (!invite) throw notFoundError('Invite not found');
  invite.status = 'revoked';
  invite.respondedAt = new Date();
  await invite.save();
};

/** On registration: attach every pending invite for this email to the new user. */
export const bindPendingInvites = async (user: UserDocument): Promise<void> => {
  await ThoughtInvite.updateMany(
    { email: user.email, status: 'pending', inviteeUserId: null },
    { $set: { inviteeUserId: user._id } },
  );
};

// --- invitee side --------------------------------------------------------

export interface MyInvite {
  id: string;
  thought: { id: string; title: string };
  invitedBy: PublicUser;
  createdAt: string;
}

export const listMyInvites = async (userId: string): Promise<MyInvite[]> => {
  const invites = await ThoughtInvite.find({
    inviteeUserId: oid(userId),
    status: 'pending',
  }).sort({ createdAt: -1 });

  const thoughtIds = invites.map((i) => i.thoughtId);
  const inviterIds = invites.map((i) => i.inviterId);
  const [thoughts, inviters] = await Promise.all([
    Thought.find({ _id: { $in: thoughtIds } })
      .setOptions({ withDeleted: true })
      .select('title'),
    User.find({ _id: { $in: inviterIds } }),
  ]);
  const titleById = new Map(thoughts.map((t) => [String(t._id), t.title]));
  const inviterById = new Map(inviters.map((u) => [String(u._id), u]));

  return invites
    .filter((i) => titleById.has(String(i.thoughtId)))
    .map((i) => ({
      id: String(i._id),
      thought: {
        id: String(i.thoughtId),
        title: titleById.get(String(i.thoughtId)) ?? '(untitled)',
      },
      invitedBy: (() => {
        const u = inviterById.get(String(i.inviterId));
        return u
          ? toPublicUser(u)
          : { id: String(i.inviterId), username: null, name: '' };
      })(),
      createdAt: i.createdAt.toISOString(),
    }));
};

export const respondToInvite = async (
  userId: string,
  inviteId: string,
  action: 'accept' | 'decline',
): Promise<{ thoughtId: string; status: 'accepted' | 'declined' }> => {
  const invite = await ThoughtInvite.findOne({
    _id: inviteId,
    inviteeUserId: oid(userId),
  });
  if (!invite) throw notFoundError('Invite not found');
  if (invite.status !== 'pending') {
    throw conflict(`This invite is already ${invite.status}`);
  }

  invite.status = action === 'accept' ? 'accepted' : 'declined';
  invite.respondedAt = new Date();
  await invite.save();

  return { thoughtId: String(invite.thoughtId), status: invite.status };
};
