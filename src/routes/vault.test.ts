import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test, { beforeEach } from 'node:test';

import { type AuthedClient, useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
let auth: AuthedClient;
const api = () => auth.api;

beforeEach(async () => {
  auth = await app.registerAndClient();
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

const keystore = () => ({
  kdfSalt: b64('sixteen-byte-salt'),
  kdfParams: { m: 65536, t: 3, p: 1 },
  protectedKey: b64('wrapped-vault-key'),
  verifier: b64('verifier-blob'),
});

interface Keystore {
  id: string;
  kdfSalt: string;
  kdfParams: { m: number; t: number; p: number };
  protectedKey: string;
  verifier: string;
}
interface Credential {
  id: string;
  name: string;
  category: string;
  tags: string[];
  cipher?: string;
  updatedAt: string;
}

test('vault setup: once only, GET reflects it', async () => {
  const before = await api().get<{ keystore: Keystore | null }>('/api/vault');
  assert.equal(before.body.keystore, null);

  const created = await api().post<Keystore>('/api/vault/setup', keystore());
  assert.equal(created.status, 201);
  assert.equal(created.body.kdfParams.m, 65536);

  const after = await api().get<{ keystore: Keystore }>('/api/vault');
  assert.equal(after.body.keystore.protectedKey, keystore().protectedKey);

  // A second setup is rejected.
  assert.equal((await api().post('/api/vault/setup', keystore())).status, 409);
});

test('rekey replaces the wrapper without a second setup', async () => {
  await api().post('/api/vault/setup', keystore());
  const next = {
    ...keystore(),
    protectedKey: b64('rewrapped-under-new-master'),
    verifier: b64('new-verifier'),
  };
  const res = await api().put<Keystore>('/api/vault/rekey', next);
  assert.equal(res.status, 200);
  assert.equal(res.body.protectedKey, next.protectedKey);

  const check = await api().get<{ keystore: Keystore }>('/api/vault');
  assert.equal(check.body.keystore.verifier, next.verifier);
});

test('rekey before setup is 404', async () => {
  assert.equal((await api().put('/api/vault/rekey', keystore())).status, 404);
});

test('credential CRUD round-trips the cipher; list omits it', async () => {
  const cipher = b64('iv-and-ciphertext-of-the-payload');
  const created = await api().post<Credential>('/api/vault/credentials', {
    name: 'GitHub',
    category: 'login',
    tags: ['Dev', 'Personal'],
    cipher,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.category, 'login');
  assert.deepEqual(created.body.tags, ['dev', 'personal']); // lowercased

  const list = await api().get<{ items: Credential[] }>('/api/vault/credentials');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0]?.name, 'GitHub');
  assert.equal(list.body.items[0]?.cipher, undefined); // metadata only

  const full = await api().get<Credential>(`/api/vault/credentials/${created.body.id}`);
  assert.equal(full.body.cipher, cipher); // verbatim

  const patched = await api().patch<Credential>(
    `/api/vault/credentials/${created.body.id}`,
    { name: 'GitHub (work)', cipher: b64('new-cipher') },
  );
  assert.equal(patched.body.name, 'GitHub (work)');

  assert.equal(
    (await api().del(`/api/vault/credentials/${created.body.id}`)).status,
    204,
  );
  assert.equal(
    (await api().get<{ items: Credential[] }>('/api/vault/credentials')).body.items
      .length,
    0,
  );
});

test('a cipher that is not base64 or is too large is rejected', async () => {
  assert.equal(
    (
      await api().post('/api/vault/credentials', {
        name: 'x',
        cipher: 'not base64!!',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api().post('/api/vault/credentials', {
        name: 'x',
        cipher: 'A'.repeat(30_001),
      })
    ).status,
    400,
  );
});

test('credentials are isolated per user', async () => {
  const mine = (
    await api().post<Credential>('/api/vault/credentials', {
      name: 'Mine',
      cipher: b64('secret'),
    })
  ).body;
  const other = await app.registerAndClient();

  assert.deepEqual(
    (await other.api.get<{ items: Credential[] }>('/api/vault/credentials')).body.items,
    [],
  );
  assert.equal((await other.api.get(`/api/vault/credentials/${mine.id}`)).status, 404);
  assert.equal(
    (await other.api.patch(`/api/vault/credentials/${mine.id}`, { name: 'x' })).status,
    404,
  );
  assert.equal((await other.api.del(`/api/vault/credentials/${mine.id}`)).status, 404);
});

test('reset wipes the keystore and every credential', async () => {
  await api().post('/api/vault/setup', keystore());
  await api().post('/api/vault/credentials', { name: 'A', cipher: b64('a') });
  await api().post('/api/vault/credentials', { name: 'B', cipher: b64('b') });

  assert.equal((await api().del('/api/vault')).status, 204);

  assert.equal(
    (await api().get<{ keystore: Keystore | null }>('/api/vault')).body.keystore,
    null,
  );
  assert.equal(
    (await api().get<{ items: Credential[] }>('/api/vault/credentials')).body.items
      .length,
    0,
  );
});
