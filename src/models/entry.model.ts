import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import type { FileCategory } from '../lib/mime.ts';
import { withJsonId } from './plugins/serialization.ts';
import { softDeletePlugin } from './plugins/softDelete.ts';
import type { DeletedReason } from './thought.model.ts';

export const ENTRY_KINDS = ['note', 'link', 'file'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface EntryLink {
  url: string;
  title?: string;
}

export interface EntryFile {
  key: string;
  bucket: string;
  originalName: string;
  contentType: string;
  size: number;
  category: FileCategory;
}

export interface EntryAttrs {
  thoughtId: Types.ObjectId;
  /** Copied from the parent thought so the activity feed is one indexed query. */
  ownerId: Types.ObjectId;
  kind: EntryKind;
  /** Note text, or an optional caption for link/file entries. */
  body: string;
  link?: EntryLink;
  file?: EntryFile;
  /** Ids of tags defined on the parent thought. */
  tagIds: Types.ObjectId[];
  starred: boolean;
  deletedAt: Date | null;
  deletedReason: DeletedReason | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EntryDocument = HydratedDocument<EntryAttrs>;

const linkSchema = new Schema<EntryLink>(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    title: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const fileSchema = new Schema<EntryFile>(
  {
    key: { type: String, required: true },
    bucket: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 300 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    category: { type: String, enum: ['image', 'document'], required: true },
  },
  { _id: false },
);

const entrySchema = new Schema(
  {
    thoughtId: {
      type: Schema.Types.ObjectId,
      ref: 'Thought',
      required: true,
    },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ENTRY_KINDS, required: true },
    body: { type: String, default: '', maxlength: 20_000 },
    link: { type: linkSchema },
    file: { type: fileSchema },
    tagIds: { type: [Schema.Types.ObjectId], default: [] },
    starred: { type: Boolean, default: false },
  },
  { timestamps: true },
);

entrySchema.plugin(softDeletePlugin);
withJsonId(entrySchema);

// Timeline pagination (keyset on createdAt + _id).
entrySchema.index({ thoughtId: 1, createdAt: -1, _id: -1 });
// Filter the timeline by tag / starred / kind, still date-ordered.
entrySchema.index({ thoughtId: 1, tagIds: 1, createdAt: -1 });
entrySchema.index({ thoughtId: 1, starred: 1, createdAt: -1 });
entrySchema.index({ thoughtId: 1, kind: 1, createdAt: -1 });
// Per-owner cross-thought activity feed by date.
entrySchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

export const Entry = model<EntryAttrs>('Entry', entrySchema);
