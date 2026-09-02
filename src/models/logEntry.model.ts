import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { DAY_RE } from '../lib/day.ts';
import { withJsonId } from './plugins/serialization.ts';

export interface LogEntryAttrs {
  ownerId: Types.ObjectId;
  /** A quick note jotted while working. */
  text: string;
  /** The day it belongs to (`YYYY-MM-DD`, client-local). */
  date: string;
  createdAt: Date;
  updatedAt: Date;
}

export type LogEntryDocument = HydratedDocument<LogEntryAttrs>;

const logEntrySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    date: { type: String, required: true, match: DAY_RE },
  },
  { timestamps: true },
);

withJsonId(logEntrySchema);

// The only query: one owner's notes for one day, in the order they were written.
logEntrySchema.index({ ownerId: 1, date: -1, createdAt: 1 });

export const LogEntry = model<LogEntryAttrs>('LogEntry', logEntrySchema);
