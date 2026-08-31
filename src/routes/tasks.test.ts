import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedTaskTag } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Task {
  id: string;
  content: string;
  date: string;
  status: 'pending' | 'done';
  completedAt: string | null;
  priority: number;
  tagIds: string[];
}
interface CalendarBody {
  month: string;
  counts: Record<string, { pending: number; done: number }>;
}

const makeTask = (over: Partial<Task> & { content?: string; date?: string } = {}) =>
  api().post<Task>('/api/tasks', {
    content: over.content ?? 'do the thing',
    date: over.date ?? '2026-09-10',
    priority: over.priority,
    tagIds: over.tagIds,
  });

test('POST /api/tasks creates a task with defaults', async () => {
  const res = await makeTask();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.priority, 3);
  assert.equal(res.body.completedAt, null);
});

test('POST /api/tasks validates content, date, and priority', async () => {
  assert.equal(
    (await api().post('/api/tasks', { content: '', date: '2026-09-10' })).status,
    400,
  );
  assert.equal(
    (await api().post('/api/tasks', { content: 'x', date: '10-09-2026' })).status,
    400,
  );
  assert.equal(
    (await api().post('/api/tasks', { content: 'x', date: '2026-09-10', priority: 9 }))
      .status,
    400,
  );
});

test('content is collapsed to a single line', async () => {
  const res = await makeTask({ content: 'line one\nline two' });
  assert.equal(res.body.content, 'line one line two');
});

test('GET /api/tasks filters by date range, status, priority, and tag', async () => {
  const tag = await seedTaskTag(auth.userId, { name: 'work' });
  await makeTask({ date: '2026-09-01', priority: 1 });
  await makeTask({ date: '2026-09-15', priority: 5, tagIds: [String(tag._id)] });
  await makeTask({ date: '2026-10-05', priority: 3 });

  const inSep = await api().get<{ items: Task[] }>(
    '/api/tasks?from=2026-09-01&to=2026-09-30',
  );
  assert.equal(inSep.body.items.length, 2);
  // sorted by date then priority
  assert.equal(inSep.body.items[0]?.date, '2026-09-01');

  const p1 = await api().get<{ items: Task[] }>('/api/tasks?priority=1');
  assert.deepEqual(
    p1.body.items.map((t) => t.priority),
    [1],
  );

  const tagged = await api().get<{ items: Task[] }>(`/api/tasks?tags=${String(tag._id)}`);
  assert.equal(tagged.body.items.length, 1);
  assert.equal(tagged.body.items[0]?.date, '2026-09-15');
});

test('PUT /api/tasks/:id/status toggles completedAt', async () => {
  const task = (await makeTask()).body;

  const done = await api().put<Task>(`/api/tasks/${task.id}/status`, { status: 'done' });
  assert.equal(done.body.status, 'done');
  assert.ok(done.body.completedAt);

  const back = await api().put<Task>(`/api/tasks/${task.id}/status`, {
    status: 'pending',
  });
  assert.equal(back.body.completedAt, null);
});

test('GET /api/tasks/calendar counts pending and done per day, honouring filters', async () => {
  const tag = await seedTaskTag(auth.userId, { name: 'home' });
  await makeTask({ date: '2026-09-10' });
  await makeTask({ date: '2026-09-10', tagIds: [String(tag._id)] });
  const toFinish = (await makeTask({ date: '2026-09-12' })).body;
  await api().put(`/api/tasks/${toFinish.id}/status`, { status: 'done' });
  await makeTask({ date: '2026-10-01' }); // different month

  const cal = await api().get<CalendarBody>('/api/tasks/calendar?month=2026-09');
  assert.equal(cal.body.counts['2026-09-10']?.pending, 2);
  assert.equal(cal.body.counts['2026-09-12']?.done, 1);
  assert.equal(cal.body.counts['2026-10-01'], undefined);

  const filtered = await api().get<CalendarBody>(
    `/api/tasks/calendar?month=2026-09&tags=${String(tag._id)}`,
  );
  assert.equal(filtered.body.counts['2026-09-10']?.pending, 1);
});

test('PATCH edits content / date / priority', async () => {
  const task = (await makeTask()).body;
  const res = await api().patch<Task>(`/api/tasks/${task.id}`, {
    content: 'updated',
    date: '2026-09-20',
    priority: 2,
  });
  assert.equal(res.body.content, 'updated');
  assert.equal(res.body.date, '2026-09-20');
  assert.equal(res.body.priority, 2);
});

test('DELETE removes the task', async () => {
  const task = (await makeTask()).body;
  assert.equal((await api().del(`/api/tasks/${task.id}`)).status, 204);
  assert.equal(
    (await api().get<{ items: Task[] }>('/api/tasks?from=2026-01-01&to=2026-12-31')).body
      .items.length,
    0,
  );
});

test('tasks are isolated per user', async () => {
  const mine = (await makeTask()).body;
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Task[] }>('/api/tasks?from=2026-01-01&to=2026-12-31'))
      .body.items,
    [],
  );
  assert.equal(
    (await other.api.patch(`/api/tasks/${mine.id}`, { content: 'hijack' })).status,
    404,
  );
  assert.equal(
    (await other.api.put(`/api/tasks/${mine.id}/status`, { status: 'done' })).status,
    404,
  );
});

test('creating a task with an unknown tag id is rejected', async () => {
  const res = await api().post('/api/tasks', {
    content: 'x',
    date: '2026-09-10',
    tagIds: ['65b0c0ffee0c0ffee0c0ffee'],
  });
  assert.equal(res.status, 404);
});
