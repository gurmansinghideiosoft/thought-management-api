import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const HABIT_TYPES = ['binary', 'count'] as const;
export type HabitType = (typeof HABIT_TYPES)[number];

export interface HabitAttrs {
  ownerId: Types.ObjectId;
  name: string;
  type: HabitType;
  /** Daily goal for `count` habits; `1` for `binary`. */
  target: number;
  /** Display-only label for `count` habits ("glasses", "pages", "min"). */
  unit: string;
  color: string;
  archived: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export type HabitDocument = HydratedDocument<HabitAttrs>;

const habitSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    type: { type: String, enum: HABIT_TYPES, default: 'binary' },
    target: { type: Number, min: 1, default: 1 },
    unit: { type: String, trim: true, maxlength: 16, default: '' },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#3f7d58' },
    archived: { type: Boolean, default: false },
    position: { type: Number, default: 0 },
  },
  { timestamps: true },
);

withJsonId(habitSchema);

habitSchema.index({ ownerId: 1, archived: 1, position: 1 });

export const Habit = model<HabitAttrs>('Habit', habitSchema);
