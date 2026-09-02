import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export interface HabitEntryAttrs {
  ownerId: Types.ObjectId;
  habitId: Types.ObjectId;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `1` for a done binary habit; the logged count for a `count` habit. Always > 0
   * — the row is deleted when it would drop to zero. */
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

export type HabitEntryDocument = HydratedDocument<HabitEntryAttrs>;

const habitEntrySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    habitId: { type: Schema.Types.ObjectId, ref: 'Habit', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    value: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

withJsonId(habitEntrySchema);

habitEntrySchema.index({ ownerId: 1, habitId: 1, date: 1 }, { unique: true });

export const HabitEntry = model<HabitEntryAttrs>('HabitEntry', habitEntrySchema);
