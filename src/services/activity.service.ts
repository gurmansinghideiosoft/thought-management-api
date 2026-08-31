import { Types } from 'mongoose';

import { decodeCursor, encodeCursor, keysetClause } from '../lib/cursor.ts';
import { Entry, type EntryKind } from '../models/entry.model.ts';
import { Thought } from '../models/thought.model.ts';

export interface ActivityParams {
  from?: Date;
  to?: Date;
  kind?: EntryKind;
  cursor?: string;
  limit: number;
}

export interface ActivityPage {
  /** Newest first — this is a "what did I do recently" feed, not a transcript. */
  items: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Cross-thought feed of one user's entries ordered by date. */
export const getActivityFeed = async (
  ownerId: string,
  params: ActivityParams,
): Promise<ActivityPage> => {
  const filter: Record<string, unknown> = {
    ownerId: new Types.ObjectId(ownerId),
    deletedAt: null,
  };

  if (params.from || params.to) {
    filter.createdAt = {
      ...(params.from ? { $gte: params.from } : {}),
      ...(params.to ? { $lte: params.to } : {}),
    };
  }
  if (params.kind) filter.kind = params.kind;

  let finalFilter: Record<string, unknown> = filter;
  if (params.cursor) {
    const pos = decodeCursor(params.cursor);
    finalFilter = {
      $and: [
        filter,
        keysetClause('before', {
          createdAt: pos.createdAt,
          id: new Types.ObjectId(pos.id),
        }),
      ],
    };
  }

  const docs = await Entry.find(finalFilter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(params.limit + 1);

  const hasMore = docs.length > params.limit;
  const page = hasMore ? docs.slice(0, params.limit) : docs;

  const thoughtIds = [...new Set(page.map((doc) => String(doc.thoughtId)))];
  const thoughts = await Thought.find({ _id: { $in: thoughtIds } })
    .setOptions({ withDeleted: true })
    .select('title');
  const titleById = new Map(
    thoughts.map((thought) => [String(thought._id), thought.title]),
  );

  const items = page.map((entry) => ({
    ...(entry.toJSON() as unknown as Record<string, unknown>),
    thought: {
      id: String(entry.thoughtId),
      title: titleById.get(String(entry.thoughtId)) ?? null,
    },
  }));

  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor(last.createdAt, String(last._id)) : null;

  return { items, hasMore, nextCursor };
};
