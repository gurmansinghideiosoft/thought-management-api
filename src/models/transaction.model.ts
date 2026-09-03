import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { withJsonId } from './plugins/serialization.ts';

export const TRANSACTION_KINDS = ['spending', 'earning'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const LOAN_DIRECTIONS = ['lent', 'borrowed'] as const;
export type LoanDirection = (typeof LOAN_DIRECTIONS)[number];

export const LOAN_STATUSES = ['open', 'settled'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface LoanRepayment {
  /** Positive, rounded to 2dp. */
  amount: number;
  /** The day the money came back: `YYYY-MM-DD`. */
  date: string;
  /** When the repayment was recorded. */
  at: Date;
}

/**
 * Present when a transaction represents money lent out (`lent` — booked as
 * `spending`) or borrowed from someone (`borrowed` — booked as `earning`).
 * The transaction's own `amount` tracks the *current outstanding* balance;
 * `principal` keeps the original figure. When outstanding hits 0 the loan
 * auto-settles.
 */
export interface TransactionLoan {
  /** Who owes you (`lent`) or who you owe (`borrowed`). */
  counterparty: string;
  direction: LoanDirection;
  /** Original amount, rounded to 2dp; never changes. */
  principal: number;
  status: LoanStatus;
  /** `YYYY-MM-DD` the loan was fully repaid; `null` while open. */
  settledOn: string | null;
  /** Optional expected return date, `YYYY-MM-DD`. */
  dueDate: string | null;
  note: string | null;
  repayments: LoanRepayment[];
}

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
  /** Set when this row is money lent out or borrowed; `null` otherwise. */
  loan: TransactionLoan | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionDocument = HydratedDocument<TransactionAttrs>;

const repaymentSchema = new Schema<LoanRepayment>(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const loanSchema = new Schema<TransactionLoan>(
  {
    counterparty: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    direction: { type: String, enum: LOAN_DIRECTIONS, default: 'lent' },
    principal: { type: Number, required: true, min: 0 },
    status: { type: String, enum: LOAN_STATUSES, default: 'open' },
    settledOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    note: { type: String, trim: true, maxlength: 280, default: null },
    repayments: { type: [repaymentSchema], default: [] },
  },
  { _id: false },
);

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
    loan: { type: loanSchema, default: null },
  },
  { timestamps: true },
);

withJsonId(transactionSchema);

transactionSchema.index({ ownerId: 1, date: -1, _id: -1 });
transactionSchema.index({ ownerId: 1, tagId: 1 });
// The "separate space" — list a user's loans by status, newest first.
transactionSchema.index(
  { ownerId: 1, 'loan.status': 1, date: -1 },
  { partialFilterExpression: { 'loan.direction': { $type: 'string' } } },
);
// One auto-posted row per rule per day — guards the materialisation race.
transactionSchema.index(
  { recurringId: 1, date: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $type: 'objectId' } } },
);

export const Transaction = model<TransactionAttrs>('Transaction', transactionSchema);
