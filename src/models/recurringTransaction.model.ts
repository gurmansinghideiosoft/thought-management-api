import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';
import { TRANSACTION_KINDS, type TransactionKind } from './transaction.model.ts';

export interface RecurringTransactionAttrs {
  ownerId: Types.ObjectId;
  title: string;
  amount: number;
  kind: TransactionKind;
  tagId: Types.ObjectId | null;
  /** Day of the month it posts (1–31; clamped to the month's last day). */
  dayOfMonth: number;
  active: boolean;
  /** Highest `YYYY-MM` already posted; `null` = nothing posted yet. */
  lastPostedMonth: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RecurringTransactionDocument = HydratedDocument<RecurringTransactionAttrs>;

const recurringSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    amount: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: TRANSACTION_KINDS, default: 'spending' },
    tagId: { type: Schema.Types.ObjectId, ref: 'FinanceTag', default: null },
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    active: { type: Boolean, default: true },
    lastPostedMonth: { type: String, match: /^\d{4}-\d{2}$/, default: null },
  },
  { timestamps: true },
);

withJsonId(recurringSchema);

recurringSchema.index({ ownerId: 1, active: 1 });

export const RecurringTransaction = model<RecurringTransactionAttrs>(
  'RecurringTransaction',
  recurringSchema,
);
