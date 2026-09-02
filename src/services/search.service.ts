import { Types } from 'mongoose';

import { Capture } from '../models/capture.model.ts';
import { Entry } from '../models/entry.model.ts';
import { JournalEntry } from '../models/journal.model.ts';
import { Task } from '../models/task.model.ts';
import { Thought } from '../models/thought.model.ts';
import { Transaction } from '../models/transaction.model.ts';
import { escapeRegExp } from '../schemas/common.ts';

const owner = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** A short window of `text` around the first case-insensitive match of `q`. */
const snippet = (text: string, q: string, radius = 70): string => {
  if (!text) return '';
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

export interface SearchGroups {
  thoughts: { id: string; title: string; snippet: string }[];
  entries: {
    id: string;
    thoughtId: string;
    thoughtTitle: string;
    kind: string;
    snippet: string;
    createdAt: Date;
  }[];
  journal: { id: string; date: string; title: string; snippet: string }[];
  tasks: { id: string; content: string; date: string | null; status: string }[];
  transactions: {
    id: string;
    title: string;
    amount: number;
    kind: string;
    date: string;
  }[];
  captures: { id: string; text: string; status: string; createdAt: Date }[];
}

export const globalSearch = async (
  ownerId: string,
  q: string,
  limit: number,
): Promise<{ query: string; groups: SearchGroups }> => {
  const rx = { $regex: escapeRegExp(q), $options: 'i' };
  const oid = owner(ownerId);

  const [thoughts, entries, journal, tasks, transactions, captures] = await Promise.all([
    Thought.find({ ownerId: oid, $or: [{ title: rx }, { description: rx }] })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('title description'),
    Entry.find({ ownerId: oid, body: rx })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('thoughtId kind body createdAt'),
    JournalEntry.find({ ownerId: oid, $or: [{ title: rx }, { excerpt: rx }] })
      .sort({ date: -1 })
      .limit(limit)
      .select('date title excerpt'),
    Task.find({ ownerId: oid, content: rx })
      .sort({ date: -1 })
      .limit(limit)
      .select('content date status'),
    Transaction.find({ ownerId: oid, title: rx })
      .sort({ date: -1 })
      .limit(limit)
      .select('title amount kind date'),
    Capture.find({ ownerId: oid, text: rx })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('text status createdAt'),
  ]);

  const thoughtIds = [...new Set(entries.map((e) => String(e.thoughtId)))];
  const titleById = new Map(
    (
      await Thought.find({ _id: { $in: thoughtIds } })
        .setOptions({ withDeleted: true })
        .select('title')
    ).map((t) => [String(t._id), t.title]),
  );

  return {
    query: q,
    groups: {
      thoughts: thoughts.map((t) => ({
        id: String(t._id),
        title: t.title,
        snippet: snippet(t.description ?? '', q),
      })),
      entries: entries.map((e) => ({
        id: String(e._id),
        thoughtId: String(e.thoughtId),
        thoughtTitle: titleById.get(String(e.thoughtId)) ?? 'Untitled',
        kind: e.kind,
        snippet: snippet(e.body ?? '', q),
        createdAt: e.createdAt,
      })),
      journal: journal.map((j) => ({
        id: String(j._id),
        date: j.date,
        title: j.title,
        snippet: snippet(j.excerpt ?? '', q),
      })),
      tasks: tasks.map((t) => ({
        id: String(t._id),
        content: t.content,
        date: t.date,
        status: t.status,
      })),
      transactions: transactions.map((t) => ({
        id: String(t._id),
        title: t.title,
        amount: t.amount,
        kind: t.kind,
        date: t.date,
      })),
      captures: captures.map((c) => ({
        id: String(c._id),
        text: c.text,
        status: c.status,
        createdAt: c.createdAt,
      })),
    },
  };
};
