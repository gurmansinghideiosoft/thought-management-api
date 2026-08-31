import { randomUUID } from 'node:crypto';

import type { Types } from 'mongoose';

import { Entry, type EntryDocument, type EntryKind } from '../src/models/entry.model.ts';
import { JournalEntry } from '../src/models/journal.model.ts';
import { Task, type TaskDocument, type TaskStatus } from '../src/models/task.model.ts';
import { TaskTag, type TaskTagDocument } from '../src/models/taskTag.model.ts';
import {
  Thought,
  type ThoughtDocument,
  type ThoughtStatus,
} from '../src/models/thought.model.ts';
import { User, type UserDocument } from '../src/models/user.model.ts';

export const createUser = (
  overrides: { email?: string; name?: string } = {},
): Promise<UserDocument> =>
  User.create({
    email: overrides.email ?? `user-${randomUUID()}@test.dev`,
    // not a real argon2 hash — fine for tests that never log in
    passwordHash: 'seeded',
    name: overrides.name ?? '',
  });

interface ThoughtOverrides {
  title?: string;
  description?: string;
  status?: ThoughtStatus;
  tags?: { name: string; color?: string }[];
}

export const seedThought = (
  ownerId: Types.ObjectId | string,
  overrides: ThoughtOverrides = {},
): Promise<ThoughtDocument> =>
  Thought.create({
    ownerId,
    title: 'Seed thought',
    description: '',
    ...overrides,
  });

interface EntryOverrides {
  kind?: EntryKind;
  body?: string;
  starred?: boolean;
  tagIds?: Types.ObjectId[];
  createdAt?: Date;
}

/**
 * Insert an entry directly (bypasses the service, so it does NOT bump the
 * thought's `entryCount` / `lastEntryAt` — tests that assert on counters should
 * go through the API instead).
 */
export const seedEntry = (
  thoughtId: Types.ObjectId | string,
  ownerId: Types.ObjectId | string,
  overrides: EntryOverrides = {},
): Promise<EntryDocument> =>
  Entry.create({
    thoughtId,
    ownerId,
    kind: 'note',
    body: 'seeded entry',
    starred: false,
    tagIds: [],
    ...overrides,
  });

interface TaskTagOverrides {
  name?: string;
  color?: string;
}

export const seedTaskTag = (
  ownerId: Types.ObjectId | string,
  overrides: TaskTagOverrides = {},
): Promise<TaskTagDocument> =>
  TaskTag.create({
    ownerId,
    name: overrides.name ?? `tag-${randomUUID().slice(0, 8)}`,
    ...(overrides.color ? { color: overrides.color } : {}),
  });

interface TaskOverrides {
  content?: string;
  date?: string;
  status?: TaskStatus;
  priority?: number;
  tagIds?: Types.ObjectId[];
  completedAt?: Date | null;
}

export const seedTask = (
  ownerId: Types.ObjectId | string,
  overrides: TaskOverrides = {},
): Promise<TaskDocument> =>
  Task.create({
    ownerId,
    content: 'seeded task',
    date: '2026-09-15',
    priority: 3,
    tagIds: [],
    ...overrides,
  });

interface JournalOverrides {
  date?: string;
  title?: string;
  content?: Record<string, unknown>;
  excerpt?: string;
  wordCount?: number;
}

export const seedJournalEntry = (
  ownerId: Types.ObjectId | string,
  overrides: JournalOverrides = {},
) =>
  JournalEntry.create({
    ownerId,
    date: overrides.date ?? '2026-09-15',
    title: overrides.title ?? '',
    content: overrides.content ?? { type: 'doc', content: [] },
    excerpt: overrides.excerpt ?? '',
    wordCount: overrides.wordCount ?? 0,
  });
