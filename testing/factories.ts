import { randomUUID } from 'node:crypto';

import type { Types } from 'mongoose';

import { Entry, type EntryDocument, type EntryKind } from '../src/models/entry.model.ts';
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
