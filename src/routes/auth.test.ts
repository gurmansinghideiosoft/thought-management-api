import assert from 'node:assert/strict';
import test from 'node:test';

import { makeClient } from '../../testing/api.ts';
import { useTestApp } from '../../testing/harness.ts';

const app = useTestApp();
const anon = () => makeClient(app.url);

interface AuthBody {
  user: {
    id: string;
    email: string;
    name: string;
    username: string | null;
    passwordHash?: string;
  };
  accessToken: string;
  refreshToken: string;
}

/** Derive a schema-valid username from the email local part. */
const handleFor = (email: string) =>
  `${email.split('@')[0]?.replace(/[^a-z0-9_]/gi, '') ?? 'user'}_acct`.toLowerCase();

const register = (email = 'a@b.com', password = 'password123', username?: string) =>
  anon().post<AuthBody>('/api/auth/register', {
    email,
    password,
    username: username ?? handleFor(email),
  });

test('POST /register creates an account and returns tokens (no hash leaked)', async () => {
  const res = await register('new@user.com', 'sup3rsecret');
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'new@user.com');
  assert.equal(res.body.user.username, 'new_acct');
  assert.equal(res.body.user.passwordHash, undefined);
  assert.ok(res.body.accessToken && res.body.refreshToken);
});

test('POST /register is 409 on a duplicate email (case-insensitive)', async () => {
  await register('dup@user.com');
  const again = await register('DUP@user.com', 'password123', 'someone_else');
  assert.equal(again.status, 409);
});

test('POST /register is 409 on a duplicate username (case-insensitive)', async () => {
  await register('first@user.com', 'password123', 'sharedhandle');
  const again = await register('second@user.com', 'password123', 'SharedHandle');
  assert.equal(again.status, 409);
});

test('POST /register rejects a short password with 400', async () => {
  const res = await anon().post('/api/auth/register', {
    email: 'x@y.com',
    password: 'short',
    username: 'shortpw_acct',
  });
  assert.equal(res.status, 400);
});

test('POST /register requires a valid username', async () => {
  assert.equal(
    (
      await anon().post('/api/auth/register', {
        email: 'nou@user.com',
        password: 'password123',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await anon().post('/api/auth/register', {
        email: 'badu@user.com',
        password: 'password123',
        username: 'no spaces!',
      })
    ).status,
    400,
  );
});

test('GET /username-available reflects whether a handle is taken', async () => {
  const free = await anon().get<{ username: string; available: boolean }>(
    '/api/auth/username-available?username=freehandle',
  );
  assert.equal(free.status, 200);
  assert.equal(free.body.available, true);

  await register('taker@user.com', 'password123', 'freehandle');

  const taken = await anon().get<{ available: boolean }>(
    '/api/auth/username-available?username=FreeHandle',
  );
  assert.equal(taken.body.available, false); // case-insensitive

  assert.equal(
    (await anon().get('/api/auth/username-available?username=no')).status,
    400, // too short for the username rule
  );
});

test('PATCH /me sets and renames the username', async () => {
  const { body } = await register('profile@user.com', 'password123', 'profile_one');
  const authed = makeClient(app.url, body.accessToken);

  const renamed = await authed.patch<{ user: { username: string; name: string } }>(
    '/api/auth/me',
    { username: 'profile_two', name: 'Pro File' },
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.username, 'profile_two');
  assert.equal(renamed.body.user.name, 'Pro File');

  // Taking someone else's handle is a 409.
  await register('other@user.com', 'password123', 'taken_handle');
  assert.equal(
    (await authed.patch('/api/auth/me', { username: 'taken_handle' })).status,
    409,
  );
});

test('PATCH /me stores the banner choices, null resets them', async () => {
  const { body } = await register('banner@user.com', 'password123', 'banner_user');
  const authed = makeClient(app.url, body.accessToken);

  const set = await authed.patch<{ user: { homeBanner: string | null } }>(
    '/api/auth/me',
    { homeBanner: 'misty-lake', journalBanner: 'golden-field' },
  );
  assert.equal(set.body.user.homeBanner, 'misty-lake');

  const me = await authed.get<{
    user: { homeBanner: string | null; journalBanner: string | null };
  }>('/api/auth/me');
  assert.equal(me.body.user.homeBanner, 'misty-lake');
  assert.equal(me.body.user.journalBanner, 'golden-field');

  const cleared = await authed.patch<{ user: { homeBanner: string | null } }>(
    '/api/auth/me',
    { homeBanner: null },
  );
  assert.equal(cleared.body.user.homeBanner, null);
});

test('POST /login succeeds with the right password, 401 otherwise', async () => {
  await register('login@user.com', 'rightpassword');

  const ok = await anon().post<AuthBody>('/api/auth/login', {
    email: 'login@user.com',
    password: 'rightpassword',
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.accessToken);

  const wrong = await anon().post('/api/auth/login', {
    email: 'login@user.com',
    password: 'wrongpassword',
  });
  assert.equal(wrong.status, 401);

  const unknown = await anon().post('/api/auth/login', {
    email: 'nobody@user.com',
    password: 'whatever12',
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body); // identical — no user enumeration
});

test('GET /me needs a valid bearer token', async () => {
  const { body } = await register('me@user.com');
  const authed = makeClient(app.url, body.accessToken);

  const ok = await authed.get<{ user: { email: string } }>('/api/auth/me');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'me@user.com');

  assert.equal((await anon().get('/api/auth/me')).status, 401);
  assert.equal(
    (await makeClient(app.url, 'garbage.token.here').get('/api/auth/me')).status,
    401,
  );
});

test('POST /refresh rotates: the old refresh token stops working', async () => {
  const { body } = await register('rot@user.com');

  const first = await anon().post<{ accessToken: string; refreshToken: string }>(
    '/api/auth/refresh',
    { refreshToken: body.refreshToken },
  );
  assert.equal(first.status, 200);
  assert.notEqual(first.body.refreshToken, body.refreshToken);

  // Re-using the original refresh token is now rejected.
  const replay = await anon().post('/api/auth/refresh', {
    refreshToken: body.refreshToken,
  });
  assert.equal(replay.status, 401);

  // The freshly issued one works.
  const second = await anon().post('/api/auth/refresh', {
    refreshToken: first.body.refreshToken,
  });
  assert.equal(second.status, 200);
});

test('POST /logout blacklists the access token immediately', async () => {
  const { body } = await register('out@user.com');
  const authed = makeClient(app.url, body.accessToken);

  assert.equal((await authed.get('/api/auth/me')).status, 200);

  const out = await authed.post('/api/auth/logout', {
    refreshToken: body.refreshToken,
  });
  assert.equal(out.status, 204);

  // Same token, now revoked.
  assert.equal((await authed.get('/api/auth/me')).status, 401);
  assert.equal(
    (await anon().post('/api/auth/refresh', { refreshToken: body.refreshToken })).status,
    401,
  );
});

test('protected resources reject anonymous requests', async () => {
  assert.equal((await anon().get('/api/thoughts')).status, 401);
  assert.equal((await anon().get('/api/activity')).status, 401);
  assert.equal((await anon().post('/api/thoughts', { title: 'x' })).status, 401);
});
