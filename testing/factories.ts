import { randomUUID } from 'node:crypto';

import { Types } from 'mongoose';

import {
  Conversation,
  type ConversationDocument,
  type ConversationKind,
} from '../src/models/conversation.model.ts';
import {
  Credential,
  type CredentialCategory,
  type CredentialDocument,
} from '../src/models/credential.model.ts';
import { Entry, type EntryDocument, type EntryKind } from '../src/models/entry.model.ts';
import { JournalEntry } from '../src/models/journal.model.ts';
import { Message, type MessageDocument } from '../src/models/message.model.ts';
import { Routine } from '../src/models/routine.model.ts';
import { Task, type TaskDocument, type TaskStatus } from '../src/models/task.model.ts';
import { TaskTag, type TaskTagDocument } from '../src/models/taskTag.model.ts';
import {
  Thought,
  type ThoughtDocument,
  type ThoughtStatus,
} from '../src/models/thought.model.ts';
import {
  ThoughtInvite,
  type ThoughtInviteDocument,
  type InviteStatus,
} from '../src/models/thoughtInvite.model.ts';
import { User, type UserDocument } from '../src/models/user.model.ts';

export const createUser = (
  overrides: { email?: string; name?: string; username?: string | null } = {},
): Promise<UserDocument> =>
  User.create({
    email: overrides.email ?? `user-${randomUUID()}@test.dev`,
    // not a real argon2 hash — fine for tests that never log in
    passwordHash: 'seeded',
    name: overrides.name ?? '',
    username:
      overrides.username === undefined
        ? `u${randomUUID().replace(/-/g, '').slice(0, 12)}`
        : overrides.username,
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

interface InviteOverrides {
  email?: string;
  inviteeUserId?: Types.ObjectId | string | null;
  status?: InviteStatus;
}

export const seedInvite = (
  thoughtId: Types.ObjectId | string,
  inviterId: Types.ObjectId | string,
  overrides: InviteOverrides = {},
): Promise<ThoughtInviteDocument> =>
  ThoughtInvite.create({
    thoughtId,
    inviterId,
    email: overrides.email ?? `invitee-${randomUUID()}@test.dev`,
    inviteeUserId: overrides.inviteeUserId ?? null,
    status: overrides.status ?? 'pending',
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

interface RoutineItemSeed {
  content?: string;
  priority?: number;
  tagIds?: Types.ObjectId[];
  activeFrom?: string;
  activeTo?: string | null;
  position?: number;
}

export const seedRoutine = (
  ownerId: Types.ObjectId | string,
  items: RoutineItemSeed[] = [],
) =>
  Routine.create({
    ownerId,
    items: items.map((it, i) => ({
      _id: new Types.ObjectId(),
      content: it.content ?? `routine ${String(i)}`,
      priority: it.priority ?? 3,
      tagIds: it.tagIds ?? [],
      position: it.position ?? i,
      activeFrom: it.activeFrom ?? '2026-08-01',
      activeTo: it.activeTo ?? null,
    })),
  });

interface ConversationOverrides {
  kind?: ConversationKind;
  thoughtId?: Types.ObjectId | string | null;
  dmKey?: string | null;
}

export const seedConversation = (
  memberIds: (Types.ObjectId | string)[],
  overrides: ConversationOverrides = {},
): Promise<ConversationDocument> =>
  Conversation.create({
    kind: overrides.kind ?? 'dm',
    thoughtId: overrides.thoughtId ?? null,
    dmKey:
      overrides.dmKey ??
      (overrides.kind === 'thought' ? null : memberIds.map(String).sort().join(':')),
    memberIds,
  });

export const seedMessage = (
  conversationId: Types.ObjectId | string,
  authorId: Types.ObjectId | string,
  body = 'seeded message',
): Promise<MessageDocument> => Message.create({ conversationId, authorId, body });

interface CredentialOverrides {
  name?: string;
  category?: CredentialCategory;
  tags?: string[];
  cipher?: string;
}

export const seedCredential = (
  ownerId: Types.ObjectId | string,
  overrides: CredentialOverrides = {},
): Promise<CredentialDocument> =>
  Credential.create({
    ownerId,
    name: overrides.name ?? 'Seed service',
    category: overrides.category ?? 'login',
    tags: overrides.tags ?? [],
    // any non-empty base64 — the server treats it as opaque
    cipher: overrides.cipher ?? Buffer.from('seeded-cipher').toString('base64'),
  });
