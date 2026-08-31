import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedTask, seedTaskTag } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Task } from '../models/task.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface TaskTag {
  id: string;
  name: string;
  color: string;
}

test('CRUD a task tag', async () => {
  const created = await api().post<TaskTag>('/api/task-tags', {
    name: 'work',
    color: '#3b6ea5',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'work');
  assert.equal(created.body.color, '#3b6ea5');

  const renamed = await api().patch<TaskTag>(`/api/task-tags/${created.body.id}`, {
    name: 'office',
  });
  assert.equal(renamed.body.name, 'office');

  const list = await api().get<{ items: TaskTag[] }>('/api/task-tags');
  assert.deepEqual(
    list.body.items.map((t) => t.name),
    ['office'],
  );
});

test('duplicate tag name (case-insensitive) is 409', async () => {
  await api().post('/api/task-tags', { name: 'Home' });
  const dup = await api().post('/api/task-tags', { name: 'home' });
  assert.equal(dup.status, 409);
});

test('deleting a tag pulls it off every task', async () => {
  const tag = await seedTaskTag(auth.userId, { name: 'errand' });
  const t1 = await seedTask(auth.userId, { tagIds: [tag._id] });
  const t2 = await seedTask(auth.userId, { tagIds: [tag._id] });

  const del = await api().del(`/api/task-tags/${String(tag._id)}`);
  assert.equal(del.status, 204);

  for (const id of [t1._id, t2._id]) {
    const fresh = await Task.findById(id);
    assert.deepEqual(fresh?.tagIds, []);
  }
});

test('one user cannot touch another user’s tag', async () => {
  const mine = await api().post<TaskTag>('/api/task-tags', { name: 'mine' });
  const other = await app.registerAndClient();
  assert.equal(
    (await other.api.patch(`/api/task-tags/${mine.body.id}`, { name: 'x' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/task-tags/${mine.body.id}`)).status, 404);
});
