import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { seedLogEntry } from '../../testing/factories.ts';
import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

interface Entry {
  id: string;
  text: string;
  date: string;
  createdAt: string;
}
interface DayLog {
  date: string;
  items: Entry[];
}

test('POST /api/log creates an entry for the given day', async () => {
  const res = await api().post<Entry>('/api/log', {
    text: '  fixed the export bug  ',
    date: '2026-09-15',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.text, 'fixed the export bug'); // trimmed
  assert.equal(res.body.date, '2026-09-15');
});

test('POST /api/log defaults the day to today', async () => {
  const res = await api().post<Entry>('/api/log', { text: 'no date given' });
  assert.equal(res.status, 201);
  assert.match(res.body.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('GET /api/log?date= returns that day only, oldest first', async () => {
  await seedLogEntry(auth.userId, { text: 'first', date: '2026-09-15' });
  await seedLogEntry(auth.userId, { text: 'second', date: '2026-09-15' });
  await seedLogEntry(auth.userId, { text: 'other day', date: '2026-09-14' });

  const res = await api().get<DayLog>('/api/log?date=2026-09-15');
  assert.equal(res.status, 200);
  assert.equal(res.body.date, '2026-09-15');
  assert.deepEqual(
    res.body.items.map((i) => i.text),
    ['first', 'second'],
  );
});

test('GET /api/log with no date uses the server today', async () => {
  const res = await api().get<DayLog>('/api/log');
  assert.equal(res.status, 200);
  assert.match(res.body.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(res.body.items, []);
});

test('PATCH /api/log/:id edits the text', async () => {
  const seeded = await seedLogEntry(auth.userId, { text: 'typoo', date: '2026-09-15' });
  const res = await api().patch<Entry>(`/api/log/${String(seeded._id)}`, {
    text: 'typo fixed',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.text, 'typo fixed');
});

test('PATCH /api/log/:id can move an entry to another day', async () => {
  const seeded = await seedLogEntry(auth.userId, {
    text: 'wrong day',
    date: '2026-09-15',
  });
  await api().patch(`/api/log/${String(seeded._id)}`, { date: '2026-09-16' });

  assert.deepEqual((await api().get<DayLog>('/api/log?date=2026-09-15')).body.items, []);
  assert.equal(
    (await api().get<DayLog>('/api/log?date=2026-09-16')).body.items[0]?.text,
    'wrong day',
  );
});

test('DELETE /api/log/:id removes the entry', async () => {
  const seeded = await seedLogEntry(auth.userId, { date: '2026-09-15' });
  assert.equal((await api().del(`/api/log/${String(seeded._id)}`)).status, 204);
  assert.deepEqual((await api().get<DayLog>('/api/log?date=2026-09-15')).body.items, []);
});

test('log entries are private to their owner', async () => {
  const mine = await seedLogEntry(auth.userId, { text: 'mine', date: '2026-09-15' });

  const other = await app.registerAndClient();
  assert.equal(
    (await other.api.get<DayLog>('/api/log?date=2026-09-15')).body.items.length,
    0,
  );
  assert.equal(
    (await other.api.patch(`/api/log/${String(mine._id)}`, { text: 'hijack' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/log/${String(mine._id)}`)).status, 404);
});

test('validation: bad text or date is 400', async () => {
  assert.equal((await api().post('/api/log', { text: '' })).status, 400);
  assert.equal((await api().post('/api/log', { text: 'x'.repeat(2001) })).status, 400);
  assert.equal(
    (await api().post('/api/log', { text: 'ok', date: 'not-a-date' })).status,
    400,
  );
  const seeded = await seedLogEntry(auth.userId, { date: '2026-09-15' });
  assert.equal((await api().patch(`/api/log/${String(seeded._id)}`, {})).status, 400);
});
