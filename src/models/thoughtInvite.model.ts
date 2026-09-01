import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const INVITE_STATUSES = ['pending', 'accepted', 'declined', 'revoked'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface ThoughtInviteAttrs {
  thoughtId: Types.ObjectId;
  inviterId: Types.ObjectId;
  /** Lowercased invitee email — the identity even before they have an account. */
  email: string;
  /** Filled once a user with this email exists (at invite time or on signup). */
  inviteeUserId: Types.ObjectId | null;
  status: InviteStatus;
  createdAt: Date;
  updatedAt: Date;
  respondedAt: Date | null;
}

export type ThoughtInviteDocument = HydratedDocument<ThoughtInviteAttrs>;

const thoughtInviteSchema = new Schema(
  {
    thoughtId: { type: Schema.Types.ObjectId, ref: 'Thought', required: true },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    inviteeUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: INVITE_STATUSES, default: 'pending' },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

withJsonId(thoughtInviteSchema);

// At most one *open* invite per (thought, email).
thoughtInviteSchema.index(
  { thoughtId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
// "My invitations" and "who is on this thought".
thoughtInviteSchema.index({ inviteeUserId: 1, status: 1 });
thoughtInviteSchema.index({ thoughtId: 1, status: 1 });
// Bind-on-signup lookup.
thoughtInviteSchema.index({ email: 1, status: 1 });

export const ThoughtInvite = model<ThoughtInviteAttrs>(
  'ThoughtInvite',
  thoughtInviteSchema,
);
