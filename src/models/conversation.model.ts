import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const CONVERSATION_KINDS = ['thought', 'dm'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export interface ConversationRead {
  userId: Types.ObjectId;
  lastReadAt: Date;
}

/** A member's personal choice of chat wallpaper for this conversation. */
export interface ConversationBackground {
  userId: Types.ObjectId;
  banner: string;
}

export interface LastMessagePreview {
  body: string;
  authorId: Types.ObjectId;
  at: Date;
}

export interface ConversationAttrs {
  kind: ConversationKind;
  /** `kind: 'thought'` — the thread attached to a thought's discussion panel. */
  thoughtId: Types.ObjectId | null;
  /** `kind: 'dm'` — the two member ids, sorted and joined: `a:b`. */
  dmKey: string | null;
  memberIds: Types.ObjectId[];
  lastMessageAt: Date;
  lastMessage: LastMessagePreview | null;
  reads: ConversationRead[];
  backgrounds: ConversationBackground[];
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<ConversationAttrs>;

const readSchema = new Schema<ConversationRead>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { _id: false },
);

const backgroundSchema = new Schema<ConversationBackground>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    banner: { type: String, required: true, maxlength: 64 },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    kind: { type: String, enum: CONVERSATION_KINDS, required: true },
    thoughtId: { type: Schema.Types.ObjectId, ref: 'Thought', default: null },
    dmKey: { type: String, default: null },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    lastMessageAt: { type: Date, default: () => new Date() },
    lastMessage: {
      type: new Schema<LastMessagePreview>(
        {
          body: { type: String, required: true },
          authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    reads: { type: [readSchema], default: [] },
    backgrounds: { type: [backgroundSchema], default: [] },
  },
  { timestamps: true },
);

withJsonId(conversationSchema);

// One conversation per thought, one per DM pair.
conversationSchema.index(
  { thoughtId: 1 },
  { unique: true, partialFilterExpression: { kind: 'thought' } },
);
conversationSchema.index(
  { dmKey: 1 },
  { unique: true, partialFilterExpression: { kind: 'dm' } },
);
// "My conversations, most recent first."
conversationSchema.index({ memberIds: 1, lastMessageAt: -1 });

export const Conversation = model<ConversationAttrs>('Conversation', conversationSchema);
