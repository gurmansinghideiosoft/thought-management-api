import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { DAY_RE } from '../lib/day.ts';
import { PRIORITIES } from '../lib/priority.ts';
import { withJsonId } from './plugins/serialization.ts';

export const TASK_STATUSES = ['pending', 'done', 'skipped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ['single', 'range'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const RANGE_MODES = ['once', 'daily'] as const;
export type RangeMode = (typeof RANGE_MODES)[number];

const stripNewlines = (value: string): string => value.replace(/\s*[\r\n]+\s*/g, ' ');

export interface TaskAttrs {
  ownerId: Types.ObjectId;
  /** Single line — newlines are stripped on save. */
  content: string;
  kind: TaskKind;
  /** Canonical day for `single` tasks: `YYYY-MM-DD`. Unset for `range`. */
  date: string | null;
  /** `range` tasks only. */
  startDate: string | null;
  endDate: string | null;
  rangeMode: RangeMode | null;
  status: TaskStatus;
  completedAt: Date | null;
  /** 1 (most urgent) … 5 (least). */
  priority: number;
  tagIds: Types.ObjectId[];
  /** Set on a materialized instance of a routine item (a `single` row). */
  routineItemId: Types.ObjectId | null;
  /** Set on a materialized instance of a `range/daily` task (a `single` row). */
  rangeTaskId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TaskDocument = HydratedDocument<TaskAttrs>;

const taskSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
      set: stripNewlines,
    },
    kind: { type: String, enum: TASK_KINDS, default: 'single' },
    date: { type: String, match: DAY_RE, default: null },
    startDate: { type: String, match: DAY_RE, default: null },
    endDate: { type: String, match: DAY_RE, default: null },
    rangeMode: { type: String, enum: RANGE_MODES, default: null },
    status: { type: String, enum: TASK_STATUSES, default: 'pending' },
    completedAt: { type: Date, default: null },
    priority: { type: Number, enum: [...PRIORITIES], default: 3 },
    tagIds: { type: [Schema.Types.ObjectId], ref: 'TaskTag', default: [] },
    routineItemId: { type: Schema.Types.ObjectId, default: null },
    rangeTaskId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

withJsonId(taskSchema);

// Day view + list range, ordered by priority within a day.
taskSchema.index({ ownerId: 1, date: 1, status: 1, priority: 1 });
// Completed-task history.
taskSchema.index({ ownerId: 1, status: 1, completedAt: -1 });
// Tag and priority filters.
taskSchema.index({ ownerId: 1, tagIds: 1 });
taskSchema.index({ ownerId: 1, priority: 1, date: 1 });
// Shadow lookups for materialized virtual instances.
taskSchema.index(
  { ownerId: 1, date: 1, routineItemId: 1 },
  { partialFilterExpression: { routineItemId: { $type: 'objectId' } } },
);
taskSchema.index(
  { ownerId: 1, date: 1, rangeTaskId: 1 },
  { partialFilterExpression: { rangeTaskId: { $type: 'objectId' } } },
);
// Range-task overlap scans.
taskSchema.index({ ownerId: 1, kind: 1, startDate: 1, endDate: 1 });

export const Task = model<TaskAttrs>('Task', taskSchema);
