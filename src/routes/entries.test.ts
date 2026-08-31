import assert from 'node:assert/strict';
import test from 'node:test';

import { makeClient } from '../../testing/api.ts';
import { useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
const api = () => makeClient(app.url);

interface Entry {
  id: string;
  kind: string;
  body: string;
  starred: boolean;
  tagIds: string[];
  link?: { url: string };
  file?: { originalName: string; category: string };
  createdAt: string;
}
interface Timeline {
  items: Entry[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Create a thought and return its id. */
const newThought = async (): Promise<string> => {
  const res = await api().post<{ id: string }>('/api/thoughts', { title: 'T' });
  return res.body.id;
};

const addNote = (tid: string, body: string) =>
  api().post<Entry>(`/api/thoughts/${tid}/entries`, { kind: 'note', body });

test('POST entries: note requires a body', async () => {
  const tid = await newThought();
  const ok = await addNote(tid, 'the basic idea');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.kind, 'note');

  const bad = await api().post(`/api/thoughts/${tid}/entries`, {
    kind: 'note',
    body: '   ',
  });
  assert.equal(bad.status, 400);
});

test('POST entries: link requires a valid url', async () => {
  const tid = await newThought();
  const ok = await api().post<Entry>(`/api/thoughts/${tid}/entries`, {
    kind: 'link',
    link: { url: 'https://example.com/relevant', title: 'Relevant site' },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.link?.url, 'https://example.com/relevant');

  const bad = await api().post(`/api/thoughts/${tid}/entries`, {
    kind: 'link',
    link: { url: 'not-a-url' },
  });
  assert.equal(bad.status, 400);
});

test('adding entries bumps the thought counters', async () => {
  const tid = await newThought();
  await addNote(tid, 'one');
  await addNote(tid, 'two');

  const thought = await api().get<{ entryCount: number; lastEntryAt: string | null }>(
    `/api/thoughts/${tid}`,
  );
  assert.equal(thought.body.entryCount, 2);
  assert.ok(thought.body.lastEntryAt);
});

test('file upload via multipart, then download', async () => {
  const tid = await newThought();

  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4 pretend pdf')], { type: 'application/pdf' }),
    'design.pdf',
  );
  form.append('body', 'a good design I found');

  const created = await api().raw(`/api/thoughts/${tid}/entries/files`, {
    method: 'POST',
    body: form,
  });
  assert.equal(created.status, 201);
  const entry = (await created.json()) as Entry & { downloadUrl: string };
  assert.equal(entry.kind, 'file');
  assert.equal(entry.file?.originalName, 'design.pdf');
  assert.equal(entry.file?.category, 'document');
  assert.match(entry.downloadUrl, /^http:\/\/memory-storage\.local\//);

  const detail = await api().get<Entry & { downloadUrl: string | null }>(
    `/api/thoughts/${tid}/entries/${entry.id}`,
  );
  assert.ok(detail.body.downloadUrl);

  const dl = await api().raw(`/api/thoughts/${tid}/entries/${entry.id}/download`, {
    method: 'GET',
    redirect: 'manual',
  });
  assert.equal(dl.status, 302);
  assert.match(dl.headers.get('location') ?? '', /memory-storage\.local/);
});

test('file upload rejects an unsupported type with 400', async () => {
  const tid = await newThought();
  const form = new FormData();
  form.append(
    'file',
    new Blob([Buffer.from('MZ...')], { type: 'application/x-msdownload' }),
    'virus.exe',
  );
  const res = await api().raw(`/api/thoughts/${tid}/entries/files`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 400);
});

test('file upload rejects an oversize file with 413', async () => {
  const tid = await newThought();
  const form = new FormData();
  // config caps test uploads at 64 KiB
  form.append(
    'file',
    new Blob([Buffer.alloc(200 * 1024, 1)], { type: 'image/png' }),
    'huge.png',
  );
  const res = await api().raw(`/api/thoughts/${tid}/entries/files`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 413);
});

test('timeline: newest page first, scroll up with `before`, forward with `after`', async () => {
  const tid = await newThought();
  const ids: string[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const res = await addNote(tid, `msg ${String(i)}`);
    ids.push(res.body.id);
  }

  const first = await api().get<Timeline>(`/api/thoughts/${tid}/entries?limit=2`);
  assert.deepEqual(
    first.body.items.map((e) => e.body),
    ['msg 4', 'msg 5'],
  );
  assert.equal(first.body.hasMore, true);
  assert.ok(first.body.nextCursor);

  const older = await api().get<Timeline>(
    `/api/thoughts/${tid}/entries?limit=2&before=${encodeURIComponent(first.body.nextCursor ?? '')}`,
  );
  assert.deepEqual(
    older.body.items.map((e) => e.body),
    ['msg 2', 'msg 3'],
  );
  assert.equal(older.body.hasMore, true);

  const oldest = await api().get<Timeline>(
    `/api/thoughts/${tid}/entries?limit=2&before=${encodeURIComponent(older.body.nextCursor ?? '')}`,
  );
  assert.deepEqual(
    oldest.body.items.map((e) => e.body),
    ['msg 1'],
  );
  assert.equal(oldest.body.hasMore, false);

  // forward from the first message
  const firstCursor = Buffer.from(
    JSON.stringify({
      t: (await api().get<Entry>(`/api/thoughts/${tid}/entries/${ids[0] ?? ''}`)).body
        .createdAt,
      i: ids[0],
    }),
  ).toString('base64url');
  const forward = await api().get<Timeline>(
    `/api/thoughts/${tid}/entries?limit=2&after=${encodeURIComponent(firstCursor)}`,
  );
  assert.deepEqual(
    forward.body.items.map((e) => e.body),
    ['msg 2', 'msg 3'],
  );
});

test('timeline filters by tag, starred, and kind', async () => {
  const created = await api().post<{ id: string; tags: { id: string; name: string }[] }>(
    '/api/thoughts',
    { title: 'Filterable', tags: [{ name: 'credentials' }] },
  );
  const tid = created.body.id;
  const tagId = created.body.tags[0]?.id ?? '';

  const tagged = await api().post<Entry>(`/api/thoughts/${tid}/entries`, {
    kind: 'note',
    body: 'api key = secret',
    tagIds: [tagId],
  });
  await api().post(`/api/thoughts/${tid}/entries`, { kind: 'note', body: 'plain' });
  const linkEntry = await api().post<Entry>(`/api/thoughts/${tid}/entries`, {
    kind: 'link',
    link: { url: 'https://example.com' },
  });
  await api().put(`/api/thoughts/${tid}/entries/${tagged.body.id}/star`, {
    starred: true,
  });

  const byTag = await api().get<Timeline>(`/api/thoughts/${tid}/entries?tagId=${tagId}`);
  assert.deepEqual(
    byTag.body.items.map((e) => e.id),
    [tagged.body.id],
  );

  const starred = await api().get<Timeline>(`/api/thoughts/${tid}/entries?starred=true`);
  assert.deepEqual(
    starred.body.items.map((e) => e.id),
    [tagged.body.id],
  );

  const links = await api().get<Timeline>(`/api/thoughts/${tid}/entries?kind=link`);
  assert.deepEqual(
    links.body.items.map((e) => e.id),
    [linkEntry.body.id],
  );
});

test('PATCH entry edits body and tags; attach/detach tag endpoints', async () => {
  const created = await api().post<{ id: string; tags: { id: string }[] }>(
    '/api/thoughts',
    { title: 'Editable', tags: [{ name: 'a' }, { name: 'b' }] },
  );
  const tid = created.body.id;
  const [tagA, tagB] = created.body.tags.map((t) => t.id);
  const entry = (await addNote(tid, 'original')).body;

  const patched = await api().patch<Entry>(`/api/thoughts/${tid}/entries/${entry.id}`, {
    body: 'edited',
    tagIds: [tagA ?? ''],
  });
  assert.equal(patched.body.body, 'edited');
  assert.deepEqual(patched.body.tagIds, [tagA]);

  const attached = await api().post<Entry>(
    `/api/thoughts/${tid}/entries/${entry.id}/tags`,
    { tagId: tagB },
  );
  assert.equal(attached.body.tagIds.length, 2);

  const detached = await api().del<Entry>(
    `/api/thoughts/${tid}/entries/${entry.id}/tags/${tagA ?? ''}`,
  );
  assert.deepEqual(detached.body.tagIds, [tagB]);

  const unknownTag = await api().patch(`/api/thoughts/${tid}/entries/${entry.id}`, {
    tagIds: ['65b0c0ffee0c0ffee0c0ffee'],
  });
  assert.equal(unknownTag.status, 400);
});

test('DELETE entry soft-deletes and adjusts counters; restore brings it back', async () => {
  const tid = await newThought();
  const a = (await addNote(tid, 'keep')).body;
  const b = (await addNote(tid, 'remove')).body;

  const del = await api().del(`/api/thoughts/${tid}/entries/${b.id}`);
  assert.equal(del.status, 204);

  const timeline = await api().get<Timeline>(`/api/thoughts/${tid}/entries`);
  assert.deepEqual(
    timeline.body.items.map((e) => e.id),
    [a.id],
  );

  const thought = await api().get<{ entryCount: number }>(`/api/thoughts/${tid}`);
  assert.equal(thought.body.entryCount, 1);

  const restored = await api().post<Entry>(
    `/api/thoughts/${tid}/entries/${b.id}/restore`,
  );
  assert.equal(restored.status, 200);

  const after = await api().get<{ entryCount: number }>(`/api/thoughts/${tid}`);
  assert.equal(after.body.entryCount, 2);
});
