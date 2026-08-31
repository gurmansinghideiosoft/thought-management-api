import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';
import { softDeletePlugin } from './plugins/softDelete.ts';
import type { DeletedReason } from './thought.model.ts';

/** The editor document (Tiptap / ProseMirror JSON). Shape isn't enforced here. */
export type JournalContent = Record<string, unknown>;

const EMPTY_DOC: JournalContent = { type: 'doc', content: [] };

export interface JournalEntryAttrs {
  ownerId: Types.ObjectId;
  /** The day being journalled: `YYYY-MM-DD`. Unique per user. */
  date: string;
  title: string;
  content: JournalContent;
  /** Plain-text preview, supplied by the client. */
  excerpt: string;
  wordCount: number;
  deletedAt: Date | null;
  deletedReason: DeletedReason | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JournalEntryDocument = HydratedDocument<JournalEntryAttrs>;

const journalSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    content: { type: Schema.Types.Mixed, default: () => ({ ...EMPTY_DOC }) },
    excerpt: { type: String, maxlength: 600, default: '' },
    wordCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, minimize: false },
);

journalSchema.plugin(softDeletePlugin);
withJsonId(journalSchema);

// One *live* entry per day (a soft-deleted day can be re-journalled), and the
// browse order.
journalSchema.index(
  { ownerId: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
journalSchema.index({ ownerId: 1, date: -1, _id: -1 });

export const JournalEntry = model<JournalEntryAttrs>('JournalEntry', journalSchema);
