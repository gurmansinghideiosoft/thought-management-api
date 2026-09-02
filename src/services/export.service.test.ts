import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  seedCapture,
  seedEntry,
  seedFinanceTag,
  seedHabit,
  seedHabitEntry,
  seedJournalEntry,
  seedReview,
  seedThought,
  seedTransaction,
} from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Thought } from '../models/thought.model.ts';
import { buildExport, type ExportBundle } from './export.service.ts';

const app = useTestApp();
let auth: AuthedClient;
const uid = (): string => auth.userId;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

const paths = (b: ExportBundle): string[] => b.files.map((f) => f.path);
const content = (b: ExportBundle, path: string): string =>
  b.files.find((f) => f.path === path)?.content ?? '';

const seedAll = async (): Promise<void> => {
  const thought = await seedThought(uid(), {
    title: 'My Project',
    description: 'the goal',
    tags: [{ name: 'health' }],
  });
  await seedEntry(thought._id, uid(), { body: 'first note' });
  await seedEntry(thought._id, uid(), { body: 'second note' });

  await seedJournalEntry(uid(), {
    date: '2026-09-01',
    title: 'Monday',
    wordCount: 12,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a good day' }] }],
    },
  });
  await seedJournalEntry(uid(), { date: '2026-09-02', wordCount: 3 });

  const tag = await seedFinanceTag(uid(), { name: 'Groceries' });
  await seedTransaction(uid(), { date: '2026-09-01', amount: 10, tagId: tag._id });
  await seedTransaction(uid(), { date: '2026-09-02', amount: 20 });
  await seedTransaction(uid(), { date: '2026-09-03', amount: 5, kind: 'earning' });

  const habit = await seedHabit(uid(), { name: 'Read' });
  await seedHabitEntry(uid(), habit._id, '2026-09-01');
  await seedHabitEntry(uid(), habit._id, '2026-09-02');

  await seedCapture(uid(), { text: 'a stray idea' });

  await seedReview(uid(), {
    period: 'week',
    periodKey: '2026-W36',
    reflection: 'went well',
    intentions: 'keep going',
    completedAt: new Date(),
  });
};

test('a fresh account exports only the skeleton', async () => {
  const b = await buildExport(uid());
  const p = paths(b);
  assert.ok(p.includes('data.json'));
  assert.ok(p.includes('README.md'));
  assert.ok(p.includes('profile.json'));
  assert.ok(!p.some((x) => x.startsWith('journal/')));
  assert.ok(!p.some((x) => x.startsWith('thoughts/')));
  assert.equal(content(b, 'captures.csv'), 'createdAt,status,text');

  const data = JSON.parse(content(b, 'data.json'));
  assert.equal(data.thoughts.length, 0);
  assert.equal(data.profile.id, uid());
  assert.match(data.profile.email, /@test\.dev$/);
});

test('a populated account exports every section', async () => {
  await seedAll();
  const b = await buildExport(uid());
  const p = paths(b);

  assert.ok(p.includes('journal/2026-09-01.md'));
  assert.ok(p.includes('journal/2026-09-02.md'));
  assert.ok(p.some((x) => /^thoughts\/0001-my-project\.md$/.test(x)));
  assert.ok(p.includes('finance/transactions.csv'));
  assert.ok(p.includes('finance/tags.csv'));
  assert.ok(p.includes('habits/entries.csv'));
  assert.ok(p.includes('captures.csv'));
  assert.ok(p.includes('reviews/2026-W36.md'));

  const data = JSON.parse(content(b, 'data.json'));
  assert.equal(data.thoughts.length, 1);
  assert.equal(data.thoughts[0].entries.length, 2);
  assert.equal(data.journal.length, 2);
  assert.equal(data.transactions.length, 3);
  assert.equal(data.habitEntries.length, 2);
  assert.equal(data.reviews.length, 1);
});

test('transactions.csv has a header, one row per txn, and resolves tag names', async () => {
  await seedAll();
  const b = await buildExport(uid());
  const rows = content(b, 'finance/transactions.csv').split('\r\n');
  assert.equal(rows[0], 'date,title,amount,kind,tag,recurring,createdAt');
  assert.equal(rows.length, 4); // header + 3
  assert.ok(rows.some((r) => r.includes('Groceries')));
});

test('a journal file carries frontmatter and the serialised body', async () => {
  await seedAll();
  const b = await buildExport(uid());
  const md = content(b, 'journal/2026-09-01.md');
  assert.match(md, /^---/);
  assert.match(md, /title: Monday/);
  assert.ok(md.includes('a good day'));
});

test('a thought file lists its entries and tags', async () => {
  await seedAll();
  const b = await buildExport(uid());
  const thoughtPath = paths(b).find((x) => x.startsWith('thoughts/')) ?? '';
  const md = content(b, thoughtPath);
  assert.ok(md.includes('title: My Project'));
  assert.ok(md.includes('tags: [health]'));
  assert.ok(md.includes('the goal'));
  assert.ok(md.includes('first note'));
  assert.ok(md.includes('second note'));
});

test('a soft-deleted thought is not exported', async () => {
  await seedThought(uid(), { title: 'Keep' });
  const gone = await seedThought(uid(), { title: 'Gone' });
  await Thought.collection.updateOne(
    { _id: gone._id },
    { $set: { deletedAt: new Date() } },
  );

  const b = await buildExport(uid());
  const data = JSON.parse(content(b, 'data.json'));
  assert.equal(data.thoughts.length, 1);
  assert.equal(data.thoughts[0].title, 'Keep');
  assert.ok(!paths(b).some((x) => x.includes('gone')));
});

test('the export is scoped to one owner', async () => {
  await seedAll();
  const other = await app.registerAndClient();
  const b = await buildExport(other.userId);
  const data = JSON.parse(content(b, 'data.json'));
  assert.equal(data.thoughts.length, 0);
  assert.equal(data.transactions.length, 0);
  assert.equal(data.journal.length, 0);
  assert.ok(!paths(b).some((x) => x.startsWith('journal/')));
});
