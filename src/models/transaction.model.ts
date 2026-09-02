import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const TRANSACTION_KINDS = ['spending', 'earning'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export interface TransactionAttrs {
  ownerId: Types.ObjectId;
  title: string;
  /** Positive, stored rounded to 2 decimal places. */
  amount: number;
  kind: TransactionKind;
  /** The day the money moved: `YYYY-MM-DD`. */
  date: string;
  /** `null` = untagged. */
  tagId: Types.ObjectId | null;
  /** Set when this row was auto-posted from a recurring rule. */
  recurringId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionDocument = HydratedDocument<TransactionAttrs>;

const transactionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    amount: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: TRANSACTION_KINDS, default: 'spending' },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    tagId: { type: Schema.Types.ObjectId, ref: 'FinanceTag', default: null },
    recurringId: {
      type: Schema.Types.ObjectId,
      ref: 'RecurringTransaction',
      default: null,
    },
  },
  { timestamps: true },
);

withJsonId(transactionSchema);

transactionSchema.index({ ownerId: 1, date: -1, _id: -1 });
transactionSchema.index({ ownerId: 1, tagId: 1 });
// One auto-posted row per rule per day — guards the materialisation race.
transactionSchema.index(
  { recurringId: 1, date: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $type: 'objectId' } } },
);

export const Transaction = model<TransactionAttrs>('Transaction', transactionSchema);
