import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export interface FinanceTagAttrs {
  ownerId: Types.ObjectId;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FinanceTagDocument = HydratedDocument<FinanceTagAttrs>;

const financeTagSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#6f6d65' },
  },
  { timestamps: true },
);

withJsonId(financeTagSchema);

// One tag name per user, case-insensitive.
financeTagSchema.index(
  { ownerId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

export const FinanceTag = model<FinanceTagAttrs>('FinanceTag', financeTagSchema);
