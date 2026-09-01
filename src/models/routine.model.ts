import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { DAY_RE } from '../lib/day.ts';
import { PRIORITIES } from '../lib/priority.ts';
import { withJsonId } from './plugins/serialization.ts';

/** A far-future sentinel for "still active". */
export const FOREVER = '9999-12-31';

export interface RoutineItem {
  _id: Types.ObjectId;
  content: string;
  priority: number;
  tagIds: Types.ObjectId[];
  position: number;
  /** Inclusive `YYYY-MM-DD` the item started applying. */
  activeFrom: string;
  /** Inclusive last day it applies, or `null` while still active. */
  activeTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoutineAttrs {
  ownerId: Types.ObjectId;
  items: RoutineItem[];
  createdAt: Date;
  updatedAt: Date;
}

export type RoutineDocument = HydratedDocument<RoutineAttrs>;

const routineItemSchema = new Schema<RoutineItem>(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
      set: (v: string) => v.replace(/\s*[\r\n]+\s*/g, ' '),
    },
    priority: { type: Number, enum: [...PRIORITIES], default: 3 },
    tagIds: { type: [Schema.Types.ObjectId], ref: 'TaskTag', default: [] },
    position: { type: Number, default: 0 },
    activeFrom: { type: String, required: true, match: DAY_RE },
    activeTo: { type: String, match: DAY_RE, default: null },
  },
  { timestamps: true, _id: true },
);
withJsonId(routineItemSchema);

const routineSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [routineItemSchema], default: [] },
  },
  { timestamps: true, minimize: false },
);
withJsonId(routineSchema);

export const Routine = model<RoutineAttrs>('Routine', routineSchema);
