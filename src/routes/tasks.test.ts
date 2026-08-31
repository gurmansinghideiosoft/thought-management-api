import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedRoutine, seedTaskTag } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { addDays, todayUtc } from '../lib/day.ts';

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

// --- routine + range expansion -------------------------------------------

interface TaskView extends Task {
  virtual: boolean;
  day: string;
  kind: 'single' | 'range';
  routineItemId: string | null;
  rangeTaskId: string | null;
}
const list = (qs: string) => api().get<{ items: TaskView[] }>(`/api/tasks?${qs}`);

const TODAY = '2026-09-15';

const addRoutineItem = (content: string, priority?: number) =>
  api().post<{ id: string }>('/api/routine/items', { content, priority });

test('routine items appear as virtual tasks on today + future, not the past', async () => {
  await addRoutineItem('stretch', 2);
  await addRoutineItem('journal');

  const future = await list(`from=${TODAY}&to=2026-09-17&today=${TODAY}`);
  const days = future.body.items.filter((t) => t.virtual);
  assert.equal(days.length, 6); // 2 items x 3 days
  assert.ok(days.every((t) => t.routineItemId && t.status === 'pending'));
  // sorted by priority within a day: stretch (p2) before journal (p3)
  assert.equal(future.body.items.filter((t) => t.day === TODAY)[0]?.content, 'stretch');

  const past = await list(`from=2026-09-14&to=2026-09-14&today=${TODAY}`);
  assert.deepEqual(past.body.items, []);
});

test('a routine item honours its active window (retired item stops appearing)', async () => {
  await seedRoutine(auth.userId, [
    { content: 'long-standing', activeFrom: '2026-08-01', activeTo: null },
    { content: 'retired', activeFrom: '2026-08-01', activeTo: '2026-09-10' },
  ]);

  const today = await list(`from=${TODAY}&to=${TODAY}&today=${TODAY}`);
  assert.deepEqual(
    today.body.items.map((t) => t.content),
    ['long-standing'],
  );
});

test('completing a virtual routine task materialises a real row and hides the virtual', async () => {
  const item = (await addRoutineItem('meditate')).body;

  const done = await api().put<TaskView>('/api/tasks/virtual/status', {
    date: TODAY,
    routineItemId: item.id,
    status: 'done',
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.virtual, undefined); // it's a stored row now
  assert.ok(done.body.completedAt);

  const day = await list(`from=${TODAY}&to=${TODAY}&today=${TODAY}`);
  const meditate = day.body.items.filter((t) => t.content === 'meditate');
  assert.equal(meditate.length, 1);
  assert.equal(meditate[0]?.virtual, false);
  assert.equal(meditate[0]?.status, 'done');

  // still virtual on tomorrow
  const tomorrow = await list('from=2026-09-16&to=2026-09-16&today=' + TODAY);
  assert.equal(tomorrow.body.items.find((t) => t.content === 'meditate')?.virtual, true);
});

test('removing a routine item stops it from future days but keeps materialised past ones', async () => {
  const item = (await addRoutineItem('walk')).body;
  // materialise + complete it "today"
  await api().put('/api/tasks/virtual/status', {
    date: TODAY,
    routineItemId: item.id,
    status: 'done',
  });
  // remove the item (today) -> activeTo = yesterday, so today no longer virtual,
  // but the completed instance stays
  await api().del(`/api/routine/items/${item.id}`);

  const today = await list(`from=${TODAY}&to=${TODAY}&today=${TODAY}`);
  const walk = today.body.items.filter((t) => t.content === 'walk');
  assert.equal(walk.length, 1);
  assert.equal(walk[0]?.status, 'done'); // the materialised row survives

  const tomorrow = await list('from=2026-09-16&to=2026-09-16&today=' + TODAY);
  assert.equal(
    tomorrow.body.items.some((t) => t.content === 'walk'),
    false,
  );
});

test('range/once shows across its window and vanishes from later days once done', async () => {
  // Anchor on the real server day so `completedAt` lands inside the window.
  const t0 = todayUtc();
  const t4 = addDays(t0, 4);
  const range = await api().post<Task>('/api/tasks', {
    kind: 'range',
    content: 'file the report',
    startDate: t0,
    endDate: t4,
    rangeMode: 'once',
  });
  assert.equal(range.status, 201);

  const before = await list(`from=${t0}&to=${t4}&today=${t0}`);
  assert.equal(
    before.body.items.filter((t) => t.content === 'file the report').length,
    5,
  );

  await api().put(`/api/tasks/${range.body.id}/status`, { status: 'done' });

  const after = await list(`from=${t0}&to=${t4}&today=${t0}`);
  const occ = after.body.items.filter((t) => t.content === 'file the report');
  assert.equal(occ.length, 1);
  assert.equal(occ[0]?.day, t0); // only on the day it was completed
  assert.equal(occ[0]?.status, 'done');
});

test('range/daily is an independent checkbox on each day of the window', async () => {
  const range = await api().post<Task>('/api/tasks', {
    kind: 'range',
    content: 'take pills',
    startDate: '2026-09-15',
    endDate: '2026-09-18',
    rangeMode: 'daily',
  });

  const all = await list(`from=2026-09-15&to=2026-09-18&today=${TODAY}`);
  assert.equal(all.body.items.filter((t) => t.content === 'take pills').length, 4);

  // complete just Sep 16
  await api().put('/api/tasks/virtual/status', {
    date: '2026-09-16',
    rangeTaskId: range.body.id,
    status: 'done',
  });

  const again = await list(`from=2026-09-15&to=2026-09-18&today=${TODAY}`);
  const pills = again.body.items.filter((t) => t.content === 'take pills');
  assert.equal(pills.length, 4);
  assert.equal(pills.find((t) => t.day === '2026-09-16')?.status, 'done');
  assert.equal(pills.find((t) => t.day === '2026-09-17')?.status, 'pending');
});

test('POST /api/tasks rejects a bad range', async () => {
  assert.equal(
    (
      await api().post('/api/tasks', {
        kind: 'range',
        content: 'x',
        startDate: '2026-09-20',
        endDate: '2026-09-10',
        rangeMode: 'once',
      })
    ).status,
    400,
  );
});

test('calendar counts include virtual routine tasks on future days only', async () => {
  await addRoutineItem('a');
  await addRoutineItem('b');
  await makeTask({ date: '2026-09-15' }); // one stored task today

  const cal = await api().get<CalendarBody>(
    `/api/tasks/calendar?month=2026-09&today=${TODAY}`,
  );
  assert.equal(cal.body.counts['2026-09-15']?.pending, 3); // 2 routine + 1 stored
  assert.equal(cal.body.counts['2026-09-16']?.pending, 2); // routine only
  assert.equal(cal.body.counts['2026-09-14'], undefined); // past: nothing
});
