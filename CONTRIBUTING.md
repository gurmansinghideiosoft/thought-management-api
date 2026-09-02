# Development Workflow

This is the process for every change to this codebase. Follow it top to bottom.

## Prerequisites

- Node.js **>= 22** (`node --version`) — the project runs TypeScript natively, no build step for local dev.
- Install dependencies once: `npm install`
- A MongoDB instance. Set `MONGODB_URI` in `.env` (copy `.env.example`). Local:
  `mongodb://127.0.0.1:27017/thought-management`, or an Atlas connection string.
  The test suite does **not** need this — it starts its own in-memory mongod.

## Project layout

```
src/
  server.ts          entry point — connects the DB, opens the HTTP port, graceful shutdown
  app.ts             the Express app: middleware + route wiring (no port)
  config/index.ts    env parsing + validation — the ONLY place process.env is read
  errors.ts          AppError + badRequest()/notFoundError()/conflict() helpers
  db/mongoose.ts     connect / disconnect lifecycle
  models/            Mongoose schemas + inferred types; plugins/ = softDelete, serialization
  services/          business logic + every Mongoose query lives here
  routes/            thin HTTP handlers; <name>.schema.ts = its Zod schemas; <name>.test.ts alongside
  middleware/         error handler, multipart upload, requireAuth
  realtime/          Socket.IO push layer — initRealtime(server), getIo() (server.ts only)
  storage/           StoragePort abstraction — S3Storage (prod) / MemoryStorage (dev + tests)
  lib/               cursor (keyset pagination), mime (upload allow-list), jwt, password, day, publicUser
  schemas/common.ts  shared Zod pieces (objectId, dateString, paging)
testing/             integration harness (in-memory DB + server), factories, api client
dist/                compiled output from `npm run build` (git-ignored)
```

**Layering rule:** `routes` parse input (Zod) and call `services`; `services` own
all DB access and business rules; `models` only define shape + indexes. A route
never touches a Mongoose model directly; a service never reads `req`.

**Auth & ownership:** `/api/auth/*` is public except `me` (`GET` / `PATCH`,
behind `requireAuth`); the rest are `register`, `login`, `refresh`, `logout`,
`username-available` (a `GET` for the sign-up form's live check — usernames are
public here, so nothing leaks). `register` requires a unique `username`
(`a-z0-9_`, 3–30); `PATCH /api/auth/me`
sets or renames it (accounts created before usernames existed carry `null` until
the client walks them through picking one) and also carries `homeBanner` /
`journalBanner` — opaque ids from the frontend's fixed hero-image list, `null` =
default. Everything under `/api/thoughts`,
`/api/activity`, `/api/tasks`, `/api/task-tags`, `/api/routine`,
`/api/journal`, `/api/reviews`, `/api/habits`, `/api/captures`, `/api/finance`,
`/api/export` and `/api/vault` sits behind
`requireAuth`, which verifies the `Bearer` access JWT, rejects blacklisted `jti`s
(`TokenDenylist`, a TTL collection), and sets `req.auth`. Handlers read the user
with `getAuth(req)` and pass `userId` into every service call. Writes to a thought
and its entries stay filtered by `ownerId`; a thought that exists but isn't yours
returns **404**, never 403. Refresh tokens rotate — using an old one 401s. In
tests, `useTestApp().registerAndClient()` returns an authed `api` client;
`seedThought(ownerId, …)` / `seedEntry(thoughtId, ownerId, …)` need the owner.

**Sharing a thought:** the owner invites emails via `POST
/api/thoughts/:id/invites`; a `ThoughtInvite` row (`pending` → `accepted` /
`declined` / `revoked`) is the record. An invite to an unknown email is stored
and bound to the account when it registers (`bindPendingInvites`, called from
`register`). **Participants = the owner + every user with an `accepted`
invite.** `assertParticipant(thoughtId, userId)` in
`src/services/thoughtShare.service.ts` is the read gate — it returns
`{ thought, role: 'owner' | 'collaborator' }` or 404. Read paths
(`GET /api/thoughts/:id`, `/stats`, `/entries*`) use it; **all write paths keep
`getThoughtOrThrow` (owner-only)** — collaborators are view + discuss only.
`GET /api/thoughts` and `GET /api/thoughts/:id` return `role` (and `sharedBy`
for shared rows). Invitee side: `GET /api/invites`, `POST
/api/invites/:id/accept | decline`.

**Messaging:** a `Conversation` is either `kind: 'dm'` (keyed by `dmKey` = the
two sorted user ids) or `kind: 'thought'` (keyed by `thoughtId`, its members
kept in sync with the thought's participants). Both are created lazily —
`POST /api/conversations/dm { username }` and `GET
/api/thoughts/:id/conversation`. `Message` rows are keyset-paginated
oldest-first exactly like the entry timeline (`src/lib/cursor.ts`), fetched
`?before=<cursor>` for older history. Per-member `reads[]` on the conversation
drives `unreadCount` in `GET /api/conversations`; `POST
/api/conversations/:id/read` stamps it. A parallel per-member `backgrounds[]`
holds each user's chat-wallpaper choice — `PUT /api/conversations/:id/background
{ banner }` (`null` clears) — surfaced as `background` on every conversation the
caller receives. `assertMember(conversationId, userId)` is the gate (404
otherwise); an author can soft-delete their own message.

**Realtime (`src/realtime/index.ts`):** `initRealtime(httpServer)` attaches a
Socket.IO server (`src/server.ts` only — never in tests). REST is the source of
truth for every write; the socket layer only **pushes** (`message:new`,
`message:removed`, `conversation:bump`) and relays ephemeral `typing` /
`presence`. Services emit through `getIo()?.…`, which is `null` under the test
harness, so every REST path stays fully functional and testable without a
socket. Handshake auth reuses `verifyAccess` + `isBlacklisted`; clients
`conversation:join` a thread room after an `assertMember` check. Presence is an
in-process map (single-process only — multi-process would need the socket.io
Redis adapter). `src/realtime/realtime.test.ts` runs its own
`http.createServer(app)` + `socket.io-client`.

**Journal:** one entry per `date` (`YYYY-MM-DD`), soft-deleted, keyset-paged
newest-first. `GET /api/journal/streak?today=` returns
`{ current, longest, writtenToday }` — `current` counts back from `today` (or
yesterday if today isn't written yet), so a streak isn't "lost" until a whole
day is missed; pass the client-local `today` so time zones line up.
`GET /api/journal/calendar?month=YYYY-MM` → `{ month, dates: [] }` of the days
that have an entry, for the picker grid.

**Search (`/api/search?q=&limit=`):** one call fans out case-insensitive
`$regex` queries (`escapeRegExp`) across thoughts (title/description), entries
(body), journal (title/excerpt), tasks (content), transactions (title) and
captures (text), owner-scoped, `limit` (default 6) per group. Returns
`{ query, groups: { thoughts, entries, journal, tasks, transactions, captures } }`
where each hit carries a `snippet` (window around the match) and what the
client needs to link to it. `q` must be ≥ 2 chars. No index changes — fine at
personal scale; swap to `$text` if it ever isn't.

**Reviews (`/api/reviews`):** a weekly / monthly synthesis. Almost pure
aggregation over data that already exists; the only stored thing is a `Review`
`{ period: week|month, periodKey (2026-W38 | 2026-09), intentions, reflection,
rating 1–5|null, completedAt }` (unique per `{ owner, period, periodKey }`).
`GET /summary?period=&anchor=&today=` builds the period + the one before it
(`weekBounds` is Monday-first; `isoWeekKey` / `monthKey` in `src/lib/day.ts`) and
returns per-section counts with `*Prev` deltas — tasks done/open, journal
entries + words + `getStreak`, `financeService.getSummary` twice, entries grouped
by thought, habit done/possible rates, capture counts — plus this period's own
`saved` review, the prior period's `prevReview` (the carry-forward loop), and
`completedStreak` (consecutive completed periods, grace on the current one).
`PUT /:period/:periodKey` upserts the review (`completed: true` stamps
`completedAt` once; `false` clears it). `GET /?period=&limit=` lists completed
reviews, newest first. `anchor` / `today` are `YYYY-MM-DD` test hooks like
`/journal/streak`.

**Export (`/api/export`):** a full backup of the caller's **solo** data — no
messages (collaborative), no vault (its own client-side plaintext export is a
separate concern). `src/services/export.service.ts` `buildExport(ownerId)` reads
every owner-scoped collection and returns `{ data, files }`: `data` is one JSON
object (the canonical dump a future import restores from), `files` is a list of
`{ path, content }` — `data.json`, `README.md`, `journal/<day>.md` (ProseMirror →
Markdown via `src/lib/markdown.ts`), `thoughts/<n>-<slug>.md`, and CSVs for
tasks / finance / habits / captures (`src/lib/csv.ts`). `GET /archive` zips the
files with `archiver` (v8, ESM — `new ZipArchive(...)`, not the old default
call) and streams them as `margin-backup-<date>.zip`; `GET /data.json`,
`/journal.md`, `/transactions.csv` are single-file conveniences. All GET, no
inputs, no schema file.

**Habits (`/api/habits`):** daily `binary` (yes/no) or `count` (toward a
`target`) habits. A `HabitEntry` is `{ habitId, date (YYYY-MM-DD), value }` and
only exists when `value >= 1` — `PUT /:id/entries/:date { value }` upserts, or
deletes the row when `value <= 0`. `GET /api/habits?date=&includeArchived=`
returns each habit enriched with `todayValue`, `doneToday`, `currentStreak`,
`longestStreak` (streak logic mirrors the Journal — today or grace-yesterday
anchors `current`; a `count` day counts once `value >= target`).
`GET /:id/month?month=YYYY-MM` feeds the heatmap. `PUT /reorder { ids }` sets
`position`. Deleting a habit drops its entries.

**Inbox (`/api/captures`):** friction-free quick capture. A `Capture` is just
`{ text (1–5000), status: open|archived }` — no title, tag, or date. `GET
/?status=` (default `open`, newest first), `POST /` (text only), `PATCH /:id`
(edit text or flip status), `DELETE /:id`. "Convert to task / thought" is done
client-side (create the task/thought, then archive the capture) — the server
keeps no cross-links.

**Finance (`/api/finance`):** day-scoped money tracking. A `Transaction` is
`{ title, amount (>0, 2dp), kind: spending|earning, date (YYYY-MM-DD),
tagId|null }`; `FinanceTag` mirrors `TaskTag` (owner-scoped, unique
case-insensitive name, `#rrggbb` colour). `POST /transactions` takes a batch
(`{ transactions: [...] }`, ≤100) so a day's entries save in one call.
`GET /transactions?from=&to=` and `GET /summary?from=&to=` are range-scoped
(`from ≤ to`); the summary aggregates `{ totalSpending, totalEarning, net,
count, byTag }` where `byTag` is spending-only, sorted desc, with an `Untagged`
bucket and each row's `budget`. Deleting a tag nulls `tagId` on its
transactions. `User.currency` (ISO 4217, default `USD`, set via
`PATCH /api/auth/me`) is display-only.

`FinanceTag.monthlyBudget` (nullable) is the per-category monthly target, set
via the tag PATCH. **Recurring rules** (`RecurringTransaction`: `{ title,
amount, kind, tagId, dayOfMonth 1–31, active, lastPostedMonth }`) are managed at
`/recurring` (GET / POST / PATCH / DELETE). There is no scheduler: every finance
_read_ lazily calls `materializeRecurring` — for each active rule it posts a
`Transaction` (marked `recurringId`) for each month in
`(lastPostedMonth, thisMonth]` whose day has passed, then bumps
`lastPostedMonth`. Deleting a posted row does not bring it back; deleting a rule
keeps its rows but nulls their `recurringId`. Both range endpoints accept
`?today=` (test hook, like `/journal/streak`).

**Vault (`/api/vault`):** a **zero-knowledge** credential store. The client
derives a key from a master password (Argon2id) and encrypts everything in the
browser; the server holds only opaque base64 — never a key, never plaintext, no
new server secret. A per-user `VaultKeystore` (`kdfSalt`, `kdfParams`,
`protectedKey`, `verifier`) is created once via `POST /setup`, replaced by
`PUT /rekey` on a master-password change, and blown away by `DELETE /api/vault`
(the forgot-password escape hatch — wipes every `Credential` too). A
`Credential` keeps `name` / `category` / `tags` in plaintext (list + filter
without unlocking) and the rest inside `cipher`. Routes validate `cipher` is
base64 within a size cap and otherwise treat every blob as opaque.

**Task shapes & the day view:** a `Task` is either `kind: 'single'` (one
`date`) or `kind: 'range'` (`startDate…endDate`). A range runs in one of two
modes: `once` (one task shown across the whole window, completed once) or
`daily` (a separate checkbox on each day). A **routine** (`src/models/routine.model.ts`,
one document per user) is an evolving list of daily task templates; each item
carries an `activeFrom` / `activeTo` window so edits apply from today forward
without rewriting the past. `src/services/taskExpansion.service.ts` merges these
into a per-day `TaskView[]`: stored rows plus **virtual** occurrences of routine
items and `range/daily` days, generated for **today + future only** (the
past/future boundary is `?today=YYYY-MM-DD`, default server UTC date). Acting on
a virtual occurrence (`PUT /api/tasks/virtual/status`) materialises it into a
real `single` row carrying `routineItemId` / `rangeTaskId`, which then shadows
the virtual one. `GET /api/tasks` and `/api/tasks/calendar` both run through the
expansion, so their counts already include virtual items.

## Scripts

| Command                                   | When you use it                                                    |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                             | Local run with auto-restart on save (`node --watch src/server.ts`) |
| `npm run test:watch`                      | Re-run tests on save while developing                              |
| `npm test`                                | Run the whole test suite once                                      |
| `npm run test:coverage`                   | Test suite + coverage report                                       |
| `npm run typecheck`                       | Full TypeScript check (no output, just errors)                     |
| `npm run lint` / `npm run lint:fix`       | ESLint — report / auto-fix                                         |
| `npm run format` / `npm run format:check` | Prettier — write / verify                                          |
| `npm run fix`                             | `format` + `lint:fix` in one go                                    |
| `npm run check`                           | **The gate.** format:check → lint → typecheck → test → build       |
| `npm run build`                           | Compile `src/` to `dist/`                                          |
| `npm start`                               | Run the compiled build (production)                                |

---

## What runs automatically

You do not have to remember every check — three layers enforce them:

| Layer                                                         | Trigger             | Runs                                                                         | Bypass (emergencies only) |
| ------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| **pre-commit** hook                                           | `git commit`        | `lint-staged` — `eslint --fix` + `prettier --write` on **staged** files only | `git commit --no-verify`  |
| **pre-push** hook                                             | `git push`          | `npm run check` — the full gate                                              | `git push --no-verify`    |
| **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) | push / PR to `main` | `npm run check` on a clean `npm ci` install                                  | — (must pass to merge)    |

Hooks are installed automatically by `npm install` (via husky's `prepare` script). If they ever stop firing, run `npm run prepare`.

A bypassed hook still has to face CI — `--no-verify` buys you minutes, not a merge.

---

## The flow for any change

### 1. Sync `main`

```bash
git checkout main
git pull                # once a remote exists
```

### 2. Branch

Name it `<type>/<short-kebab-description>`:

| Prefix      | For                                   |
| ----------- | ------------------------------------- |
| `feat/`     | a new feature                         |
| `fix/`      | a bug fix                             |
| `refactor/` | restructuring with no behavior change |
| `test/`     | tests only                            |
| `chore/`    | tooling, dependencies, config         |
| `docs/`     | documentation only                    |

```bash
git checkout -b feat/thoughts-crud
```

### 3. Make the change — in small commits

- Write or update the test **alongside** the code (`src/routes/thoughts.test.ts` next to `src/routes/thoughts.ts`).
- Keep `npm run test:watch` running for fast feedback.
- Each commit should be one focused step and should leave the suite green.
- If you add a config variable, change **three** places: `src/config/index.ts` (parse + validate), `.env.example`, `.env`.

**Commit messages** — [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <imperative summary>

feat: add POST /api/thoughts
fix: reject empty thought body with 400
test: cover the 404 fallthrough
chore: bump eslint to 10.9
refactor: extract statusOf() from the error handler
```

Rules: lowercase, imperative mood ("add", not "added"), no trailing period, summary ≤ ~72 chars. Body (optional, after a blank line) explains _why_, not _what_.

### 4. Run the gate

```bash
npm run check
```

It runs, stopping at the first failure:

1. **`format:check`** — code matches Prettier style
2. **`lint`** — no ESLint errors
3. **`typecheck`** — no TypeScript errors
4. **`test`** — every test passes
5. **`build`** — the production compile succeeds

If step 1 or 2 fails, auto-fix and re-run:

```bash
npm run fix
npm run check
```

Do **not** proceed until `npm run check` exits cleanly.

### 5. Push the branch

First time only, add a remote:

```bash
git remote add origin <url>
```

Then:

```bash
git push -u origin feat/thoughts-crud
```

### 6. Merge into `main`

**With a GitHub PR (preferred):**

- Open a PR against `main`.
- CI runs `npm run check` (see [.github/workflows](.github/workflows) once added).
- Review your own diff line by line before requesting/approving.
- Merge with **Squash and merge** so `main` gets one clean commit per change.

**Locally (solo, no PR):**

```bash
git checkout main
git pull
git merge --no-ff feat/thoughts-crud
npm run check          # re-verify the merged result
git push
```

`--no-ff` keeps the branch visible as a group of commits in history.

### 7. Delete the branch

```bash
git branch -d feat/thoughts-crud
git push origin --delete feat/thoughts-crud   # if it was pushed
```

---

## Testing flow in detail

- **Location:** tests are colocated — `foo.ts` is tested by `foo.test.ts` in the same folder. Shared setup goes in `testing/`.
- **Stack:** Node's built-in runner (`node:test`) + `node:assert/strict`. No Jest, no Vitest, no extra dependency.
- **Integration tests boot the real app:** call `useTestApp()` from `testing/harness.ts` at the top of the file. It starts an in-memory MongoDB and the Express app once, and wipes the DB + file store before each test. Hit the app with the `makeClient(app.url)` helper from `testing/api.ts`; seed with `testing/factories.ts`. Nothing is mocked — a real mongod, a real HTTP round-trip.
- **`NODE_ENV=test`** is set by the `test` script — config validates it, forces the in-memory storage driver, caps upload size at 64 KiB, and silences request logging.
- **Soft delete:** every read query auto-excludes `deletedAt != null`. To see deleted rows in a test, query the model with `.setOptions({ withDeleted: true })`. Deleting a thought cascades to its entries (`deletedReason: 'cascade'`); restoring it brings those back but not entries deleted on their own.
- **What to cover per endpoint:**
  - happy path — status code **and** response body shape
  - each validation failure — `400` with a useful message
  - not found — `404`
  - (later) unauthorized / forbidden — `401` / `403`
- **Coverage:** `npm run test:coverage`. Aim to cover branches, not just lines — every `if` in a handler is a case worth a test.

---

## Non-negotiables

- Never commit directly to `main`.
- Never merge a branch where `npm run check` fails.
- `.env` is never committed. Adding a variable means updating `.env.example` too.
- One logical change per branch. If the diff is hard to describe in one sentence, split it.
