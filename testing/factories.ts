import type { Types } from 'mongoose';

import { Entry, type EntryDocument, type EntryKind } from '../src/models/entry.model.ts';
import {
  Thought,
  type ThoughtDocument,
  type ThoughtStatus,
} from '../src/models/thought.model.ts';

interface ThoughtOverrides {
  title?: string;
  description?: string;
  status?: ThoughtStatus;
  tags?: { name: string; color?: string }[];
}

export const seedThought = (overrides: ThoughtOverrides = {}): Promise<ThoughtDocument> =>
  Thought.create({
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
  overrides: EntryOverrides = {},
): Promise<EntryDocument> =>
  Entry.create({
    thoughtId,
    kind: 'note',
    body: 'seeded entry',
    starred: false,
    tagIds: [],
    ...overrides,
  });
