import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export interface MessageAttrs {
  conversationId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  /** Soft delete — the author can remove their own message. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<MessageAttrs>;

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

withJsonId(messageSchema);

// Keyset transcript order within a conversation.
messageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });

export const Message = model<MessageAttrs>('Message', messageSchema);
