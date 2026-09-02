import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test, { beforeEach } from 'node:test';

import { seedJournalEntry, seedTransaction } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

test('GET /api/export/archive streams a zip attachment', async () => {
  await seedJournalEntry(auth.userId, { date: '2026-09-01', wordCount: 1 });

  const res = await auth.api.raw('/api/export/archive');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /zip/);
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /attachment; filename="margin-backup-\d{4}-\d{2}-\d{2}\.zip"/,
  );

  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
  assert.ok(buf.length > 100);
});

test('GET /api/export/journal.md returns markdown', async () => {
  await seedJournalEntry(auth.userId, {
    date: '2026-09-01',
    title: 'Hi',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello there' }] }],
    },
  });

  const res = await auth.api.raw('/api/export/journal.md');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/markdown/);
  assert.match(await res.text(), /hello there/);
});

test('GET /api/export/transactions.csv returns csv with a header row', async () => {
  await seedTransaction(auth.userId, { date: '2026-09-01', amount: 9 });

  const res = await auth.api.raw('/api/export/transactions.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(await res.text(), /^date,title,amount,kind,tag,recurring,createdAt/);
});

test('GET /api/export/data.json returns the structured dump', async () => {
  const res = await auth.api.raw('/api/export/data.json');
  assert.equal(res.status, 200);
  const data = JSON.parse(await res.text());
  assert.equal(typeof data.profile.email, 'string');
  assert.ok(Array.isArray(data.thoughts));
});

test('the export endpoints require auth', async () => {
  const res = await fetch(`${app.url}/api/export/archive`);
  assert.equal(res.status, 401);
});
