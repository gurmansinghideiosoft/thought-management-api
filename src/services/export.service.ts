import { Types } from 'mongoose';

import { toCsv } from '../lib/csv.ts';
import { proseMirrorToMarkdown } from '../lib/markdown.ts';
import { Capture } from '../models/capture.model.ts';
import { Entry } from '../models/entry.model.ts';
import { FinanceTag } from '../models/financeTag.model.ts';
import { Habit } from '../models/habit.model.ts';
import { HabitEntry } from '../models/habitEntry.model.ts';
import { JournalEntry } from '../models/journal.model.ts';
import { RecurringTransaction } from '../models/recurringTransaction.model.ts';
import { Review } from '../models/review.model.ts';
import { Routine } from '../models/routine.model.ts';
import { Task } from '../models/task.model.ts';
import { TaskTag } from '../models/taskTag.model.ts';
import { Thought } from '../models/thought.model.ts';
import { Transaction } from '../models/transaction.model.ts';
import { User } from '../models/user.model.ts';

const owner = (id: string): Types.ObjectId => new Types.ObjectId(id);

export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportBundle {
  data: Record<string, unknown>;
  files: ExportFile[];
}

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';

/** A loose YAML-ish frontmatter block. Empty / nullish values are dropped. */
const frontmatter = (fields: Record<string, unknown>): string => {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : String(v)}`);
  return `---\n${lines.join('\n')}\n---`;
};

const isoMinutes = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 16);

export const buildExport = async (ownerId: string): Promise<ExportBundle> => {
  const oid = owner(ownerId);

  const [
    user,
    thoughts,
    entries,
    journal,
    tasks,
    routine,
    taskTags,
    financeTags,
    transactions,
    recurring,
    habits,
    habitEntries,
    captures,
    reviews,
  ] = await Promise.all([
    User.findById(oid),
    Thought.find({ ownerId: oid }).sort({ createdAt: 1 }),
    Entry.find({ ownerId: oid }).sort({ createdAt: 1 }),
    JournalEntry.find({ ownerId: oid }).sort({ date: 1 }),
    Task.find({ ownerId: oid }).sort({ createdAt: 1 }),
    Routine.findOne({ ownerId: oid }),
    TaskTag.find({ ownerId: oid }).sort({ name: 1 }),
    FinanceTag.find({ ownerId: oid }).sort({ name: 1 }),
    Transaction.find({ ownerId: oid }).sort({ date: 1, createdAt: 1 }),
    RecurringTransaction.find({ ownerId: oid }).sort({ title: 1 }),
    Habit.find({ ownerId: oid }).sort({ position: 1, createdAt: 1 }),
    HabitEntry.find({ ownerId: oid }).sort({ date: 1 }),
    Capture.find({ ownerId: oid }).sort({ createdAt: 1 }),
    Review.find({ ownerId: oid }).sort({ periodKey: 1 }),
  ]);

  const entriesByThought = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = String(e.thoughtId);
    const list = entriesByThought.get(key);
    if (list) list.push(e);
    else entriesByThought.set(key, [e]);
  }

  const taskTagName = new Map(taskTags.map((t) => [String(t._id), t.name]));
  const financeTagName = new Map(financeTags.map((t) => [String(t._id), t.name]));
  const habitName = new Map(habits.map((h) => [String(h._id), h.name]));
  const routineItems = routine?.items ?? [];

  const profile = user
    ? {
        id: String(user._id),
        email: user.email,
        name: user.name,
        username: user.username,
        currency: user.currency,
        homeBanner: user.homeBanner,
        journalBanner: user.journalBanner,
        createdAt: user.createdAt,
      }
    : null;

  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    app: 'Margin',
    profile,
    thoughts: thoughts.map((t) => ({
      ...t.toJSON(),
      entries: (entriesByThought.get(String(t._id)) ?? []).map((e) => e.toJSON()),
    })),
    journal: journal.map((j) => j.toJSON()),
    tasks: tasks.map((t) => t.toJSON()),
    routine: routine ? routine.toJSON() : null,
    taskTags: taskTags.map((t) => t.toJSON()),
    financeTags: financeTags.map((t) => t.toJSON()),
    transactions: transactions.map((t) => t.toJSON()),
    recurring: recurring.map((r) => r.toJSON()),
    habits: habits.map((h) => h.toJSON()),
    habitEntries: habitEntries.map((h) => h.toJSON()),
    captures: captures.map((c) => c.toJSON()),
    reviews: reviews.map((r) => r.toJSON()),
  };

  const files: ExportFile[] = [];

  files.push({ path: 'data.json', content: JSON.stringify(data, null, 2) });
  files.push({ path: 'profile.json', content: JSON.stringify(profile, null, 2) });

  // --- journal ------------------------------------------------------------
  for (const j of journal) {
    const fm = frontmatter({
      date: j.date,
      title: j.title || undefined,
      words: j.wordCount,
    });
    files.push({
      path: `journal/${j.date}.md`,
      content: `${fm}\n\n${proseMirrorToMarkdown(j.content)}\n`,
    });
  }

  // --- thoughts ---------------------------------------------------------
  thoughts.forEach((t, i) => {
    const tagById = new Map(t.tags.map((tag) => [String(tag._id), tag.name]));
    const parts = [
      frontmatter({
        title: t.title,
        created: t.createdAt.toISOString().slice(0, 10),
        status: t.status,
        tags: t.tags.length > 0 ? t.tags.map((tag) => tag.name) : undefined,
      }),
    ];
    if (t.description) parts.push(t.description);

    for (const e of entriesByThought.get(String(t._id)) ?? []) {
      const seg = [`## ${isoMinutes(e.createdAt)} · ${e.kind}`];
      if (e.body) seg.push(e.body);
      if (e.kind === 'link' && e.link) {
        seg.push(`[${e.link.title || e.link.url}](${e.link.url})`);
      }
      if (e.kind === 'file' && e.file) {
        seg.push(`_file: ${e.file.originalName} (${e.file.size} bytes)_`);
      }
      const tagNames = e.tagIds
        .map((id) => tagById.get(String(id)))
        .filter((n): n is string => Boolean(n));
      if (tagNames.length > 0) seg.push(`Tags: ${tagNames.join(', ')}`);
      parts.push(seg.join('\n\n'));
    }

    files.push({
      path: `thoughts/${String(i + 1).padStart(4, '0')}-${slugify(t.title)}.md`,
      content: `${parts.join('\n\n')}\n`,
    });
  });

  // --- tasks & routine -------------------------------------------------
  files.push({
    path: 'tasks.csv',
    content: toCsv(
      tasks.map((t) => ({
        content: t.content,
        kind: t.kind,
        date: t.date,
        startDate: t.startDate,
        endDate: t.endDate,
        rangeMode: t.rangeMode,
        status: t.status,
        priority: t.priority,
        tags: t.tagIds
          .map((id) => taskTagName.get(String(id)))
          .filter(Boolean)
          .join(' | '),
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      })),
      [
        'content',
        'kind',
        'date',
        'startDate',
        'endDate',
        'rangeMode',
        'status',
        'priority',
        'tags',
        'completedAt',
        'createdAt',
      ],
    ),
  });

  files.push({
    path: 'routine.csv',
    content: toCsv(
      routineItems.map((it) => ({
        content: it.content,
        priority: it.priority,
        tags: it.tagIds
          .map((id) => taskTagName.get(String(id)))
          .filter(Boolean)
          .join(' | '),
        activeFrom: it.activeFrom,
        activeTo: it.activeTo,
        position: it.position,
      })),
      ['content', 'priority', 'tags', 'activeFrom', 'activeTo', 'position'],
    ),
  });

  // --- finance --------------------------------------------------------
  files.push({
    path: 'finance/transactions.csv',
    content: toCsv(
      transactions.map((t) => ({
        date: t.date,
        title: t.title,
        amount: t.amount,
        kind: t.kind,
        tag: t.tagId ? (financeTagName.get(String(t.tagId)) ?? '') : '',
        recurring: t.recurringId ? 'yes' : '',
        createdAt: t.createdAt,
      })),
      ['date', 'title', 'amount', 'kind', 'tag', 'recurring', 'createdAt'],
    ),
  });

  files.push({
    path: 'finance/tags.csv',
    content: toCsv(
      financeTags.map((t) => ({
        name: t.name,
        color: t.color,
        monthlyBudget: t.monthlyBudget,
      })),
      ['name', 'color', 'monthlyBudget'],
    ),
  });

  files.push({
    path: 'finance/recurring.csv',
    content: toCsv(
      recurring.map((r) => ({
        title: r.title,
        amount: r.amount,
        kind: r.kind,
        tag: r.tagId ? (financeTagName.get(String(r.tagId)) ?? '') : '',
        dayOfMonth: r.dayOfMonth,
        active: r.active,
        lastPostedMonth: r.lastPostedMonth,
      })),
      ['title', 'amount', 'kind', 'tag', 'dayOfMonth', 'active', 'lastPostedMonth'],
    ),
  });

  // --- habits -------------------------------------------------------
  files.push({
    path: 'habits/habits.csv',
    content: toCsv(
      habits.map((h) => ({
        name: h.name,
        type: h.type,
        target: h.target,
        unit: h.unit,
        color: h.color,
        archived: h.archived,
      })),
      ['name', 'type', 'target', 'unit', 'color', 'archived'],
    ),
  });

  files.push({
    path: 'habits/entries.csv',
    content: toCsv(
      habitEntries.map((e) => ({
        habit: habitName.get(String(e.habitId)) ?? '',
        date: e.date,
        value: e.value,
      })),
      ['habit', 'date', 'value'],
    ),
  });

  // --- captures ---------------------------------------------------
  files.push({
    path: 'captures.csv',
    content: toCsv(
      captures.map((c) => ({
        createdAt: c.createdAt,
        status: c.status,
        text: c.text,
      })),
      ['createdAt', 'status', 'text'],
    ),
  });

  // --- reviews --------------------------------------------------
  for (const r of reviews) {
    const parts = [
      frontmatter({
        period: r.period,
        periodKey: r.periodKey,
        rating: r.rating ?? undefined,
        completedAt: r.completedAt ? r.completedAt.toISOString() : undefined,
      }),
    ];
    if (r.reflection) parts.push(`## How it went\n\n${r.reflection}`);
    if (r.intentions) parts.push(`## Intentions\n\n${r.intentions}`);
    files.push({ path: `reviews/${r.periodKey}.md`, content: `${parts.join('\n\n')}\n` });
  }

  // --- README ---------------------------------------------------
  const bt = '`';
  const readmeLines = [
    '# Margin export',
    '',
    `Exported: ${String(data.exportedAt)}`,
    '',
    '## Contents',
    '',
    `- ${bt}data.json${bt} — the complete machine-readable copy of everything below`,
    `- ${bt}profile.json${bt} — your account details`,
    `- ${bt}journal/${bt} — ${journal.length} ${journal.length === 1 ? 'entry' : 'entries'}, one Markdown file per day`,
    `- ${bt}thoughts/${bt} — ${thoughts.length} ${thoughts.length === 1 ? 'thought' : 'thoughts'} with their entries`,
    `- ${bt}tasks.csv${bt} — ${tasks.length} tasks; ${bt}routine.csv${bt} — ${routineItems.length} routine items`,
    `- ${bt}finance/${bt} — ${transactions.length} transactions, ${financeTags.length} tags, ${recurring.length} recurring rules`,
    `- ${bt}habits/${bt} — ${habits.length} habits, ${habitEntries.length} logged days`,
    `- ${bt}captures.csv${bt} — ${captures.length} inbox captures`,
    `- ${bt}reviews/${bt} — ${reviews.length} weekly / monthly reviews`,
    '',
    'Messages and your vault are not included in this export.',
    '',
  ];
  files.push({ path: 'README.md', content: readmeLines.join('\n') });

  return { data, files };
};
