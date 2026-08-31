import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStorage } from './memory.storage.ts';

test('put then head reports size and content type', async () => {
  const storage = new MemoryStorage();
  await storage.put({
    key: 'a/b.txt',
    body: Buffer.from('hello world'),
    contentType: 'text/plain',
  });

  assert.deepEqual(await storage.head('a/b.txt'), {
    size: 11,
    contentType: 'text/plain',
  });
});

test('head returns null for a missing key', async () => {
  const storage = new MemoryStorage();
  assert.equal(await storage.head('missing'), null);
});

test('delete removes the object', async () => {
  const storage = new MemoryStorage();
  await storage.put({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' });
  await storage.delete('k');
  assert.equal(await storage.head('k'), null);
});

test('getDownloadUrl embeds the key and filename', async () => {
  const storage = new MemoryStorage();
  const url = await storage.getDownloadUrl('folder/file.pdf', {
    filename: 'report.pdf',
    ttlSeconds: 60,
  });
  assert.match(url, /^http:\/\/memory-storage\.local\/folder\/file\.pdf\?/);
  assert.match(url, /filename=report\.pdf/);
});

test('clear empties the store', async () => {
  const storage = new MemoryStorage();
  await storage.put({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' });
  storage.clear();
  assert.equal(storage.size, 0);
});
