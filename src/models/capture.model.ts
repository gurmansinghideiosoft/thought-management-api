import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const CAPTURE_STATUSES = ['open', 'archived'] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export interface CaptureAttrs {
  ownerId: Types.ObjectId;
  /** Whatever the user dumped — no title, no structure. */
  text: string;
  status: CaptureStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type CaptureDocument = HydratedDocument<CaptureAttrs>;

const captureSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    status: { type: String, enum: CAPTURE_STATUSES, default: 'open' },
  },
  { timestamps: true },
);

withJsonId(captureSchema);

captureSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

export const Capture = model<CaptureAttrs>('Capture', captureSchema);
