import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';
import { softDeletePlugin } from './plugins/softDelete.ts';

export const THOUGHT_STATUSES = ['active', 'archived'] as const;
export type ThoughtStatus = (typeof THOUGHT_STATUSES)[number];

export type DeletedReason = 'direct' | 'cascade';

/** A tag definition — scoped to one thought. Entries reference these by `_id`. */
export interface ThoughtTag {
  _id: Types.ObjectId;
  name: string;
  color?: string;
  createdAt: Date;
}

export interface ThoughtAttrs {
  /** The user who owns this thought. Every query is scoped by it. */
  ownerId: Types.ObjectId;
  title: string;
  description: string;
  status: ThoughtStatus;
  tags: ThoughtTag[];
  /** Denormalized count of non-deleted entries. */
  entryCount: number;
  /** Timestamp of the most recent entry — drives the "latest activity" sort. */
  lastEntryAt: Date | null;
  deletedAt: Date | null;
  deletedReason: DeletedReason | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ThoughtDocument = HydratedDocument<ThoughtAttrs>;

const tagSchema = new Schema<ThoughtTag>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);
withJsonId(tagSchema);

const thoughtSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    description: { type: String, default: '', maxlength: 20_000 },
    status: { type: String, enum: THOUGHT_STATUSES, default: 'active' },
    tags: { type: [tagSchema], default: [] },
    entryCount: { type: Number, default: 0, min: 0 },
    lastEntryAt: { type: Date, default: null },
  },
  { timestamps: true },
);

thoughtSchema.plugin(softDeletePlugin);
withJsonId(thoughtSchema);

// Per-owner list, the two sorts, and trash lookups.
thoughtSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
thoughtSchema.index({ ownerId: 1, status: 1, lastEntryAt: -1 });
thoughtSchema.index({ ownerId: 1, deletedAt: 1 });
// Name / description search (combined with an ownerId filter at query time).
thoughtSchema.index({ title: 'text', description: 'text' });

export const Thought = model<ThoughtAttrs>('Thought', thoughtSchema);
