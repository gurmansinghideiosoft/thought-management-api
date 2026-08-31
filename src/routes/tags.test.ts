import assert from 'node:assert/strict';
import test from 'node:test';

import { makeClient } from '../../testing/api.ts';
import { useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
const api = () => makeClient(app.url);

interface Tag {
  id: string;
  name: string;
  color?: string;
  entryCount: number;
}

const newThought = async (): Promise<string> => {
  const res = await api().post<{ id: string }>('/api/thoughts', { title: 'T' });
  return res.body.id;
};

test('POST /tags creates a tag; duplicate name (case-insensitive) is 409', async () => {
  const tid = await newThought();

  const created = await api().post<Tag>(`/api/thoughts/${tid}/tags`, {
    name: 'credentials',
    color: '#ff0000',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'credentials');
  assert.equal(created.body.color, '#ff0000');

  const dup = await api().post(`/api/thoughts/${tid}/tags`, { name: 'Credentials' });
  assert.equal(dup.status, 409);
});

test('GET /tags lists tags with per-tag message counts', async () => {
  const created = await api().post<{ id: string; tags: { id: string; name: string }[] }>(
    '/api/thoughts',
    { title: 'Tagged', tags: [{ name: 'creds' }, { name: 'design' }] },
  );
  const tid = created.body.id;
  const credsId = created.body.tags.find((t) => t.name === 'creds')?.id ?? '';

  await api().post(`/api/thoughts/${tid}/entries`, {
    kind: 'note',
    body: 'has creds',
    tagIds: [credsId],
  });

  const list = await api().get<{ items: Tag[] }>(`/api/thoughts/${tid}/tags`);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.items.find((t) => t.name === 'creds')?.entryCount, 1);
  assert.equal(list.body.items.find((t) => t.name === 'design')?.entryCount, 0);
});

test('PATCH /tags/:id renames and recolors', async () => {
  const tid = await newThought();
  const tag = (await api().post<Tag>(`/api/thoughts/${tid}/tags`, { name: 'old' })).body;

  const res = await api().patch<Tag>(`/api/thoughts/${tid}/tags/${tag.id}`, {
    name: 'new',
    color: '#123456',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'new');
  assert.equal(res.body.color, '#123456');
});

test('DELETE /tags/:id removes it from the thought and from every entry', async () => {
  const created = await api().post<{ id: string; tags: { id: string }[] }>(
    '/api/thoughts',
    { title: 'X', tags: [{ name: 'temp' }] },
  );
  const tid = created.body.id;
  const tagId = created.body.tags[0]?.id ?? '';

  const entry = (
    await api().post<{ id: string; tagIds: string[] }>(`/api/thoughts/${tid}/entries`, {
      kind: 'note',
      body: 'x',
      tagIds: [tagId],
    })
  ).body;
  assert.deepEqual(entry.tagIds, [tagId]);

  const del = await api().del(`/api/thoughts/${tid}/tags/${tagId}`);
  assert.equal(del.status, 204);

  const list = await api().get<{ items: Tag[] }>(`/api/thoughts/${tid}/tags`);
  assert.equal(list.body.items.length, 0);

  const after = await api().get<{ tagIds: string[] }>(
    `/api/thoughts/${tid}/entries/${entry.id}`,
  );
  assert.deepEqual(after.body.tagIds, []);
});

test('creating an entry with an unknown tag id is 400', async () => {
  const tid = await newThought();
  const res = await api().post(`/api/thoughts/${tid}/entries`, {
    kind: 'note',
    body: 'x',
    tagIds: ['65b0c0ffee0c0ffee0c0ffee'],
  });
  assert.equal(res.status, 400);
});
