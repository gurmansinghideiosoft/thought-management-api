import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

import { PRIORITIES } from '../lib/priority.ts';
import { withJsonId } from './plugins/serialization.ts';

export const TASK_STATUSES = ['pending', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskAttrs {
  ownerId: Types.ObjectId;
  /** Single line — newlines are stripped on save. */
  content: string;
  /** The day this task is for: `YYYY-MM-DD`. Stored as a string, no timezone. */
  date: string;
  status: TaskStatus;
  completedAt: Date | null;
  /** 1 (most urgent) … 5 (least). */
  priority: number;
  tagIds: Types.ObjectId[];
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
      set: (value: string) => value.replace(/\s*[\r\n]+\s*/g, ' '),
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: { type: String, enum: TASK_STATUSES, default: 'pending' },
    completedAt: { type: Date, default: null },
    priority: {
      type: Number,
      enum: [...PRIORITIES],
      default: 3,
    },
    tagIds: { type: [Schema.Types.ObjectId], ref: 'TaskTag', default: [] },
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

export const Task = model<TaskAttrs>('Task', taskSchema);
