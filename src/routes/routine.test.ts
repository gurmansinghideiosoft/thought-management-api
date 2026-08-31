import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { todayUtc } from '../lib/day.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Item {
  id: string;
  content: string;
  priority: number;
  position: number;
  activeFrom: string;
  activeTo: string | null;
}

test('GET /api/routine returns an empty routine on first read', async () => {
  const res = await api().get<{ items: Item[] }>('/api/routine');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
});

test('add / edit / reorder routine items', async () => {
  const a = await api().post<Item>('/api/routine/items', { content: 'stretch' });
  const b = await api().post<Item>('/api/routine/items', {
    content: 'read',
    priority: 2,
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.activeFrom, todayUtc());
  assert.equal(a.body.activeTo, null);

  const edited = await api().patch<Item>(`/api/routine/items/${a.body.id}`, {
    content: 'stretch 10 min',
  });
  assert.equal(edited.body.content, 'stretch 10 min');

  const reordered = await api().put<{ items: Item[] }>('/api/routine/items/order', {
    itemIds: [b.body.id, a.body.id],
  });
  assert.deepEqual(
    reordered.body.items.map((i) => i.content),
    ['read', 'stretch 10 min'],
  );
});

test('removing an item added today hard-deletes it', async () => {
  const item = await api().post<Item>('/api/routine/items', { content: 'temp' });
  assert.equal((await api().del(`/api/routine/items/${item.body.id}`)).status, 204);

  const withRetired = await api().get<{ items: Item[] }>(
    '/api/routine?includeRetired=true',
  );
  assert.deepEqual(withRetired.body.items, []);
});

test('creating an item with an unknown tag id is rejected', async () => {
  const res = await api().post('/api/routine/items', {
    content: 'x',
    tagIds: ['65b0c0ffee0c0ffee0c0ffee'],
  });
  assert.equal(res.status, 404);
});

test('routines are isolated per user', async () => {
  const mine = await api().post<Item>('/api/routine/items', { content: 'mine' });
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Item[] }>('/api/routine')).body.items,
    [],
  );
  assert.equal(
    (await other.api.patch(`/api/routine/items/${mine.body.id}`, { content: 'x' }))
      .status,
    404,
  );
});
