import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedCapture } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';
import { Capture } from '../models/capture.model.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Cap {
  id: string;
  text: string;
  status: 'open' | 'archived';
}

test('capture just needs text; it lands open, newest first', async () => {
  const a = await api().post<Cap>('/api/captures', { text: '  buy milk  ' });
  assert.equal(a.status, 201);
  assert.equal(a.body.text, 'buy milk');
  assert.equal(a.body.status, 'open');

  await api().post('/api/captures', { text: 'call the dentist' });

  const list = await api().get<{ items: Cap[] }>('/api/captures');
  assert.deepEqual(
    list.body.items.map((c) => c.text),
    ['call the dentist', 'buy milk'],
  );
});

test('empty / oversized text is rejected', async () => {
  assert.equal((await api().post('/api/captures', { text: '   ' })).status, 400);
  assert.equal(
    (await api().post('/api/captures', { text: 'x'.repeat(5001) })).status,
    400,
  );
});

test('editing text and archiving; archived items drop off the default list', async () => {
  const c = await seedCapture(auth.userId, { text: 'draft' });
  const id = String(c._id);

  const edited = await api().patch<Cap>(`/api/captures/${id}`, { text: 'final' });
  assert.equal(edited.body.text, 'final');

  await api().patch(`/api/captures/${id}`, { status: 'archived' });

  const open = await api().get<{ items: Cap[] }>('/api/captures');
  assert.deepEqual(open.body.items, []);

  const archived = await api().get<{ items: Cap[] }>('/api/captures?status=archived');
  assert.deepEqual(
    archived.body.items.map((x) => x.text),
    ['final'],
  );
});

test('an empty patch is 400', async () => {
  const c = await seedCapture(auth.userId);
  assert.equal((await api().patch(`/api/captures/${String(c._id)}`, {})).status, 400);
});

test('delete removes it', async () => {
  const c = await seedCapture(auth.userId);
  assert.equal((await api().del(`/api/captures/${String(c._id)}`)).status, 204);
  assert.equal(await Capture.countDocuments({ ownerId: auth.userId }), 0);
});

test('one user cannot see or touch another user’s captures', async () => {
  const mine = await seedCapture(auth.userId, { text: 'mine' });
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Cap[] }>('/api/captures')).body.items,
    [],
  );
  assert.equal(
    (await other.api.patch(`/api/captures/${String(mine._id)}`, { text: 'x' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/captures/${String(mine._id)}`)).status, 404);
});
