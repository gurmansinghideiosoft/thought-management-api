import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedHabit, seedHabitEntry } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Habit } from '../models/habit.model.ts';
import { HabitEntry } from '../models/habitEntry.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface HabitView {
  id: string;
  name: string;
  type: 'binary' | 'count';
  target: number;
  archived: boolean;
  position: number;
  todayValue: number;
  doneToday: boolean;
  currentStreak: number;
  longestStreak: number;
}
interface EntryRes {
  entry: { date: string; value: number } | null;
}

const seedRun = (habitId: string, dates: string[], value = 1) =>
  Promise.all(dates.map((d) => seedHabitEntry(auth.userId, habitId, d, value)));

test('a habit needs only a name; type/target default', async () => {
  const created = await api().post<HabitView>('/api/habits', { name: 'Meditate' });
  assert.equal(created.status, 201);
  assert.equal(created.body.type, 'binary');
  assert.equal(created.body.target, 1);

  const list = await api().get<{ items: HabitView[] }>('/api/habits');
  assert.deepEqual(
    list.body.items.map((h) => h.name),
    ['Meditate'],
  );
});

test('setting an entry: binary toggles, and value 0 clears it', async () => {
  const habit = await seedHabit(auth.userId, { name: 'Read' });
  const id = String(habit._id);

  const on = await api().put<EntryRes>(`/api/habits/${id}/entries/2026-09-15`, {
    value: 1,
  });
  assert.equal(on.body.entry?.value, 1);
  assert.equal(await HabitEntry.countDocuments({ habitId: habit._id }), 1);

  const off = await api().put<EntryRes>(`/api/habits/${id}/entries/2026-09-15`, {
    value: 0,
  });
  assert.equal(off.body.entry, null);
  assert.equal(await HabitEntry.countDocuments({ habitId: habit._id }), 0);
});

test('count habit is only "done" once it hits its target', async () => {
  const habit = await seedHabit(auth.userId, {
    name: 'Water',
    type: 'count',
    target: 8,
  });
  const id = String(habit._id);
  await api().put(`/api/habits/${id}/entries/2026-09-15`, { value: 5 });

  const partial = await api().get<{ items: HabitView[] }>('/api/habits?date=2026-09-15');
  assert.equal(partial.body.items[0]!.todayValue, 5);
  assert.equal(partial.body.items[0]!.doneToday, false);

  await api().put(`/api/habits/${id}/entries/2026-09-15`, { value: 8 });
  const full = await api().get<{ items: HabitView[] }>('/api/habits?date=2026-09-15');
  assert.equal(full.body.items[0]!.doneToday, true);
  assert.equal(full.body.items[0]!.currentStreak, 1);
});

test('current streak counts consecutive done days back from the given date', async () => {
  const habit = await seedHabit(auth.userId, { name: 'Stretch' });
  const id = String(habit._id);
  await seedRun(id, ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  // a gap, then an older run
  await seedRun(id, ['2026-09-09', '2026-09-10']);

  const res = await api().get<{ items: HabitView[] }>('/api/habits?date=2026-09-16');
  assert.equal(res.body.items[0]!.currentStreak, 4);
  assert.equal(res.body.items[0]!.longestStreak, 4);

  // Nothing yesterday/today → current resets, longest stays.
  const later = await api().get<{ items: HabitView[] }>('/api/habits?date=2026-09-20');
  assert.equal(later.body.items[0]!.currentStreak, 0);
  assert.equal(later.body.items[0]!.longestStreak, 4);
});

test('month heatmap returns that month’s entries', async () => {
  const habit = await seedHabit(auth.userId);
  const id = String(habit._id);
  await seedRun(id, ['2026-09-02', '2026-09-20']);
  await seedHabitEntry(auth.userId, id, '2026-08-31');
  await seedHabitEntry(auth.userId, id, '2026-10-01');

  const res = await api().get<{ month: string; days: { date: string }[] }>(
    `/api/habits/${id}/month?month=2026-09`,
  );
  assert.deepEqual(
    res.body.days.map((d) => d.date),
    ['2026-09-02', '2026-09-20'],
  );
});

test('reorder sets positions; delete removes the habit and its entries', async () => {
  const a = await seedHabit(auth.userId, { name: 'A' });
  const b = await seedHabit(auth.userId, { name: 'B' });
  await seedHabitEntry(auth.userId, String(a._id), '2026-09-10');

  await api().put('/api/habits/reorder', {
    ids: [String(b._id), String(a._id)],
  });
  const list = await api().get<{ items: HabitView[] }>('/api/habits');
  assert.deepEqual(
    list.body.items.map((h) => h.name),
    ['B', 'A'],
  );

  const del = await api().del(`/api/habits/${String(a._id)}`);
  assert.equal(del.status, 204);
  assert.equal(await Habit.countDocuments({ ownerId: auth.userId }), 1);
  assert.equal(await HabitEntry.countDocuments({ ownerId: auth.userId }), 0);
});

test('archived habits are hidden unless asked for', async () => {
  await seedHabit(auth.userId, { name: 'live' });
  await seedHabit(auth.userId, { name: 'gone', archived: true });

  const active = await api().get<{ items: HabitView[] }>('/api/habits');
  assert.deepEqual(
    active.body.items.map((h) => h.name),
    ['live'],
  );

  const all = await api().get<{ items: HabitView[] }>('/api/habits?includeArchived=true');
  assert.equal(all.body.items.length, 2);
});

test('one user cannot touch another user’s habit', async () => {
  const habit = await seedHabit(auth.userId);
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: HabitView[] }>('/api/habits')).body.items,
    [],
  );
  assert.equal(
    (await other.api.patch(`/api/habits/${String(habit._id)}`, { name: 'x' })).status,
    404,
  );
  assert.equal(
    (
      await other.api.put(`/api/habits/${String(habit._id)}/entries/2026-09-15`, {
        value: 1,
      })
    ).status,
    404,
  );
});
