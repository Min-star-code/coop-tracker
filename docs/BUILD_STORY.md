# Build Story

A running log of real design decisions, problems and fixes while building coop-tracker.
Written for interview prep: each entry says what I chose, what I rejected, and why.

## Step 1 — Database design (2026-11-13)

**Tables:** `users`, `sessions`, `applications`, `status_events`, plus `schema_migrations`.

- **One `applications` table for WaterlooWorks and external jobs, with a `source` column.**
  Rejected: two tables. Both kinds have the same lifecycle and the same screens, so two tables
  would mean every query, filter and the deadline view written twice. The WaterlooWorks-only field
  (`ww_job_id`) is nullable, and a `CHECK (source = 'waterlooworks' OR ww_job_id IS NULL)` stops a
  LinkedIn row from carrying a WaterlooWorks id.
- **`ww_job_id` is `UNIQUE`.** Importing `applications.json` twice must not create duplicates.
  PostgreSQL treats NULLs as distinct, so external rows (NULL id) never clash with each other.
- **Status is a `CHECK` constraint, not free text.** The workflow is
  Saved → Applied → Interview → Offer / Ranked / Rejected, plus Skipped. Bad values are rejected
  by the database even if an API bug lets them through (defence in depth).
- **`status_events` keeps history.** Overwriting `status` loses *when* I moved to Interview.
  A separate append-only table gives a timeline; `ON DELETE CASCADE` removes it with its application.
- **Sessions stored server-side, token hashed.** The browser cookie holds a random token; the
  database stores only its SHA-256. If the sessions table leaked, the hashes could not be used as
  cookies. Server-side sessions (vs. a JWT) also make logout and "revoke a viewer" instant.
- **Single workspace, two roles.** There is one owner (me) and read-only viewers (a mentor).
  Rejected: per-user data (`owner_id` on every row) — no real need for multiple owners yet.
- **Dates:** `deadline` / `applied_on` are `DATE` (a day, no time zone); audit columns are `TIMESTAMPTZ`.

**Tooling decision — PGlite for dev and tests.** Production uses real PostgreSQL. Locally I had no
Docker or Postgres installed. Instead of switching to SQLite for dev (different SQL dialect, so bugs
could hide until production), I used PGlite: PostgreSQL compiled to WebAssembly, running in-process.
The same migration SQL runs in tests, dev and prod. Each test opens a fresh in-memory database, so
tests never share state. The app talks to both through one small `Db` interface (`query`, `close`).

**Migrations:** plain numbered `.sql` files, run in order by a ~40-line runner that records what ran
in `schema_migrations` and wraps each file in a transaction (all-or-nothing). Safe to run on every boot.

**Tests (Vitest, 6):** migrations are idempotent; external rows need no job id; invalid status is
rejected; a WaterlooWorks id on a LinkedIn row is rejected; duplicate WaterlooWorks id is rejected;
deleting an application cascades to its history.

## Step 2 — REST API (2026-11-13)

**Endpoints** (Express 5, JSON):

| Method | Path | What |
|---|---|---|
| GET | `/api/applications?status=&source=&q=&sort=&limit=&offset=` | filtered, paginated list + total |
| GET | `/api/applications/deadlines?days=14` | Saved jobs due today … N days, soonest first |
| GET | `/api/applications/:id` | one application + its status timeline |
| POST | `/api/applications` | create (WaterlooWorks or external) |
| PATCH | `/api/applications/:id` | partial update; status change adds a timeline event |
| DELETE | `/api/applications/:id` | delete (timeline cascades) |
| GET | `/api/stats` | counts by status and by source |

**Decisions**
- **`createApp(db)` separate from `listen()`.** Tests build the app around an in-memory database and
  call it through supertest without opening a port.
- **Validate at the edge with zod.** Every body and query string is parsed by a schema. Unknown fields
  (e.g. a client sending `id` or `created_at`) are dropped, not trusted. Errors come back as `400` with
  a list of bad fields so the frontend can show them next to the inputs.
- **One error handler.** Maps zod errors → 400, Postgres unique violation (23505) → 409,
  check violation (23514) → 400, everything else → 500 with details only in the server log.
- **SQL injection.** Values always go in as `$1, $2…` parameters. The two places that build SQL text
  use whitelists: `sort` picks one of three fixed `ORDER BY` strings, and PATCH column names come from
  the zod schema's keys, never from the request. A test sends `sort=id;DROP TABLE users` and expects 400.
- **LIKE wildcards escaped.** Searching `100%` must find the literal text, so `%`, `_` and `\` are
  escaped before building the `ILIKE` pattern.
- **PATCH in a transaction with `SELECT … FOR UPDATE`.** Read old status → update → insert event must
  be atomic; the row lock stops two simultaneous edits from both logging the same change.
- **Auto `applied_on`.** Moving to Applied fills today's date if it was empty.

**Problems I hit**
1. *Transactions on a connection pool.* My first migration runner sent `BEGIN`, the statements and
   `COMMIT` as separate `db.query()` calls. That works on PGlite (one connection) but is wrong on a
   `pg.Pool`: each call can go to a different connection, so the "transaction" isn't one. Fix: a
   `db.transaction(fn)` helper that checks out one client, runs BEGIN/COMMIT/ROLLBACK on it, and
   releases it in `finally`. PGlite uses its own `transaction()` behind the same interface.
   (Caught while writing PATCH, before it ever ran on a real pool. The `pg` path is not exercised by
   local tests yet; CI will run the suite against a real PostgreSQL service to cover it.)
2. *Dates shifted by time zone.* Postgres `DATE` came back as a JS `Date` at UTC midnight
   (`2026-11-13T00:00:00.000Z`), which in Toronto displays as Nov 12. Fix: a type parser for
   DATE (oid 1082) that keeps the `YYYY-MM-DD` string. The PGlite version still failed — two tests
   caught it — because `new PGlite(undefined, options)` silently ignores `options`. Passing one
   object `new PGlite({ dataDir, parsers })` fixed it.
3. *"Today" in which time zone?* `CURRENT_DATE` in the database is UTC on most hosts, so after ~7 pm
   Eastern the deadline view would think it's tomorrow. The server computes today in
   America/Toronto and passes it as a parameter; a test checks today/yesterday/+5/+30 days.

**Tests:** 21 API tests with supertest (27 total with the schema tests), all on a fresh in-memory
PostgreSQL per test.

## Step 3 — Change of scope: the AI agent feeds the site (2026-11-13)

After steps 1–2 I re-checked what the site is *for*. My applications are submitted by an AI agent
(Claude Code) that already records every job in `applications.json`. Typing them in again by hand
would be wasted work. So I removed manual create/delete and made the site a **read-mostly view fed
by the agent**:

```
AI agent applies on WaterlooWorks → updates applications.json → npm run sync → POST /api/sync → PostgreSQL
                                                                              people (owner / viewer) ← browser
```

- **`POST /api/sync` takes the whole file and upserts it in one transaction.** Key = `ww_job_id` for
  WaterlooWorks, `external_id` for anything else. Rows missing from the file are never deleted.
- **All-or-nothing validation.** Every record is checked first; if any is bad (unknown status,
  duplicate id, both/neither id) the response lists the problems and nothing is written.
- **Who wins when both sides edit? Content fingerprint.** Each row stores `sync_hash`, the SHA-256 of
  the JSON record it was last synced from. Same record again → skipped, so a status I changed on the
  website (e.g. "Interview") survives the next sync. When the agent's record really changes, its new
  hash differs and the agent's version is applied. I first thought of comparing `updated_at`, but the
  file only stores a *date*, so two changes on the same day would be missed. The hash has no such gap.
- **Legacy statuses.** The file uses 5 statuses that aren't in the site's workflow. They are folded in
  (Not Selected → Rejected; Needs Information / Cover Letter Required / Application Failed /
  Submission Uncertain → Saved) and the original word is kept as a note prefix, e.g. `[WW: Not Selected]`.

## Step 4 — Login, roles and the agent's API token (2026-11-13)

Two kinds of caller, two kinds of credential:

| Caller | Credential | Can do |
|---|---|---|
| Owner (me) | email + password → session cookie | read everything, change status / note / dates |
| Viewer (mentor) | email + password → session cookie | read only (PATCH → 403) |
| Sync agent | `Authorization: Bearer ct_…` API token | only `POST /api/sync`; cannot read the site |

- **Passwords: scrypt** (Node built-in, memory-hard, random 16-byte salt per user), compared with
  `timingSafeEqual`. Stored as `scrypt$N$r$p$salt$hash` so parameters can be raised later.
- **Login gives no hints.** Wrong email and wrong password return the same message, and an unknown
  email still runs a real scrypt check, so response time doesn't reveal which emails exist.
- **Brute force:** 5 failed logins per IP in 15 minutes → 429. In-memory, which is fine for one
  instance (a multi-instance deploy would need a shared store).
- **Session cookie:** 32 random bytes, `HttpOnly` (page JS can't read it), `SameSite=Lax`, `Secure`
  in production, 14 days. Only its SHA-256 is in the database; logout deletes the row, so it is dead
  immediately (a JWT would stay valid until it expires).
- **CSRF:** cookie-authenticated writes must send `X-Requested-With: coop-tracker`. Another site can
  make the browser send our cookie, but can't add a custom header without a CORS preflight, which
  this server never approves.
- **API tokens** are hashed the same way and shown once at creation (`npm run cli -- token:create`).
  A person's cookie can't call the sync endpoint and a token can't read data: least privilege.
- **No sign-up page.** Accounts are made with `npm run cli -- user:create <email> <owner|viewer>`.

**Problems found by importing the real file (1,014 records)**
1. 31 records had `updated_at` as a full timestamp (`2026-10-19T14:43:18-04:00`) instead of a date —
   one batch was written by a different script. The validator now accepts both and keeps the local date.
2. 7 Skipped records had empty company and title. They are kept, labelled `(not recorded)`.
3. Without the all-or-nothing rule, the first attempt would have half-imported the file. Instead it
   wrote nothing and listed the bad rows, which is how I found 1 and 2.

Result on a local database: first sync created 1,014 rows (Skipped 553, Applied 363, Saved 89,
Rejected 9; 30 with a legacy-status note); a second sync reported 1,014 unchanged.

**Tests:** 45 in total (schema 6, applications 16, auth 13, sync 10).

## Step 5 — LLM job classifier with Gemini (2026-11-13)

`POST /api/classify` (owner only) takes a pasted posting and returns
`{category, reason, model}`, category ∈ `citizen_pr | portfolio_design | waterloo | other`.

- **Rules are the ones I already sort by by hand** (workspace `AGENTS.md`, cycle 3): check in order,
  first match wins — citizenship/PR requirement (incl. SWPP, CSJ, security clearance) → portfolio-style
  design/marketing/content → Waterloo/Kitchener/Cambridge/campus/remote → other.
- **Provider behind an interface.** `LlmClient` has one method, `generateJson(system, user, schema)`.
  `GeminiClient` implements it with the `@google/genai` SDK; tests use a `FakeLlm` that returns canned
  answers and records the prompts. No API key is needed to run the test suite or CI.
- **Why Gemini:** the Google AI Studio free tier covers the Flash models, enough for a personal tool.
  The model name is configurable (`GEMINI_MODEL`, default alias `gemini-flash-latest`) because
  model versions change faster than code.
- **Structured output + temperature 0.** The request asks for JSON matching a schema, so the answer is
  machine-readable and repeatable.
- **Never trust model output.** The JSON is parsed and validated with zod like any user input. An
  invalid answer (bad JSON, unknown category) gets one retry, then a `502`.
- **Prompt injection.** A posting is untrusted text. It is wrapped in `<posting>` tags, the system
  prompt says to treat it as data, and any `</posting>` inside it is removed so it can't close the
  fence early. The worst a malicious posting can do is pick a wrong category: the output is limited
  to four values and a short sentence, it triggers no actions, and React escapes it when shown.
- **Cost control:** owner only (viewers get 403), posting length 50–20,000 characters, checked before
  the model is called.

**Tests (7, all with the fake client):** happy path and prompt fencing; fence break-out attempt;
retry after invalid JSON; 502 after two invalid answers; 503 with no key; 400 for too-short input
without calling the model; viewer 403. Total suite: 52.

**Not done yet:** I have not run it against the real Gemini API. Next: a small labelled set of real
postings to measure how often it agrees with my manual sorting.
