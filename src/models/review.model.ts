import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const REVIEW_PERIODS = ['week', 'month'] as const;
export type ReviewPeriod = (typeof REVIEW_PERIODS)[number];

export interface ReviewAttrs {
  ownerId: Types.ObjectId;
  period: ReviewPeriod;
  /** `GGGG-'W'WW` for a week (`2026-W36`) or `YYYY-MM` for a month (`2026-09`). */
  periodKey: string;
  /** What the user wants to focus on next period. */
  intentions: string;
  /** How the period went. */
  reflection: string;
  /** Optional 1–5 gut feel for the period. */
  rating: number | null;
  /** Set when the user deliberately marks the review done. */
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<ReviewAttrs>;

const reviewSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, enum: REVIEW_PERIODS, required: true },
    periodKey: { type: String, required: true },
    intentions: { type: String, maxlength: 5000, default: '' },
    reflection: { type: String, maxlength: 5000, default: '' },
    rating: { type: Number, min: 1, max: 5, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

withJsonId(reviewSchema);

// One review per user per period.
reviewSchema.index({ ownerId: 1, period: 1, periodKey: 1 }, { unique: true });
// The history list ("what I've reviewed").
reviewSchema.index({ ownerId: 1, period: 1, completedAt: -1 });

export const Review = model<ReviewAttrs>('Review', reviewSchema);
