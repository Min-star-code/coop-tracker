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
  The model name is configurable (`GEMINI_MODEL`, default chosen in Step 6) because
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

## Step 6 — Running it for real, and measuring it (2026-11-13)

**Problems on the first real calls**
1. *The model name I guessed didn't exist.* `gemini-flash-latest` returned 404 for my key. Listing the
   models through the API showed what was really available; `gemini-2.5-flash` was also 404 already.
2. *A request hung for minutes.* `gemini-3.8-flash` and `3.7-flash` were overloaded (503/504), and the
   SDK by default retries **5 times with exponential backoff up to 60 s**. A person waiting on a web
   page can't wait that long. Fix: 20 s timeout per attempt, at most 2 attempts, then a clear error
   (`429` "quota reached" or `502` "Gemini request failed (503)") instead of a hang.
3. *Free-tier quota is 20 requests per model per day.* My second eval run failed 18 times with 429.
   The error details said `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue 20`.
   Quotas are per model, so I switched the eval to `gemini-3.5-flash-lite`, which has its own quota.
   For the website (a few classifications a day) the limit is fine; for evals it's the bottleneck.

**Eval set (`eval/cases.json`, runner `scripts/eval-classifier.ts`)**
- 20 real WaterlooWorks postings I had saved, labelled by **what I actually did**: I applied to all
  of them (one skipped for paperwork), so none is "citizen_pr", even though several say "hiring
  preference for Canadian citizens", "Security Clearance Required" or "Reliability Status". These are
  exactly the hard negatives the rule has to get right.
- 4 synthetic edge cases: SWPP, SECRET clearance, Canada Summer Jobs (all citizen_pr), and a
  prompt-injection attempt that tries to force "waterloo".
- Posting texts stay out of the repo (employer content); only ids, labels and results are committed.
- One case turned out to be **ambiguous**: Manulife 486388's location field says Toronto, but its
  description says "join us in our Waterloo, Ontario office". The model said Waterloo, which is
  defensible. I marked it ambiguous and excluded it from the score rather than counting it either way.

**Results**

| Run | Model | Prompt | Real (19 scored) | Synthetic (4) | Typical latency |
|---|---|---|---|---|---|
| 1 baseline | gemini-3.5-flash | v1 | 13/19 | 3/4 (1 was a 429, not a wrong answer) | ~3 s |
| 2 | gemini-3.5-flash-lite | v2 | 19/19 | 4/4 | ~1 s |

Baseline errors: 6 of 6 were false "citizen_pr", every time quoting "Security Clearance Required" or a
citizenship *preference*. v1 of the prompt literally said "roles needing a security clearance" count,
so the model was following my vague rule. v2 says what does count (MUST be citizen/PR, SWPP, CSJ,
SECRET/TOP SECRET) and lists what doesn't (preference, eligible to work in Canada, proof of
citizenship *or* work permit, background check, Reliability Status, the generic WaterlooWorks line).
This matches how I actually applied.

**Honest limits**
- Run 2 changed the prompt **and** the model at once, so I can't say how much each helped. Next:
  re-run prompt v1 on flash-lite once the daily quota resets.
- v2 was written after looking at these same misses, on a small set (19 real + 4 synthetic, no real
  citizen_pr or remote examples). 19/19 is not evidence of 100% accuracy on new postings; the real
  test is new postings as they come in.

Default model is now `gemini-3.5-flash-lite` (faster, higher free quota, no worse on this set).

## Step 7 — React frontend and end-to-end tests (2026-11-14)

**Stack:** React 19 + TypeScript, built by Vite into `dist/client`. In production Express serves the
built files and falls back to `index.html` for any non-`/api` path, so the site and API share one
origin: the session cookie works without CORS. In development Vite proxies `/api` to Express.

**Pages**
- *Sign in.* No sign-up page (accounts come from the CLI).
- *Overview.* Totals by status (Skipped shown separately so it doesn't swamp the pipeline), counts by
  source, and Saved jobs due in the next 14 days.
- *Applications.* Search (company, title or job id), status chips (multi-select), source and sort,
  50 per page. Clicking a row opens a side panel with the timeline; the owner can change status and
  note, a viewer sees the same panel read-only.
- *Classify a posting* (owner only): paste a posting, see the bucket and the model's reason.

**Decisions**
- No UI framework or router library: 4 screens, hash-based navigation, one CSS file with light/dark
  colours. Less to explain, less to break.
- One `api.ts` wrapper adds the CSRF header to every request and turns the server's field errors into
  readable messages.
- Search waits 250 ms after typing stops (debounce) instead of one request per keystroke, and a
  response that arrives after a newer one started is ignored (stale-response guard).
- The UI hides what a viewer can't do, but that is only convenience: the server enforces roles.
  Hiding a button is not security.

**Bugs found by running it in a browser**
1. *404 on the home page.* The server found the built client with `new URL(..).pathname`, which keeps
   `%20` for the space in my folder name ("Waterloo Work"), so the folder "didn't exist". Fix:
   `fileURLToPath`. The same fix made the local database path independent of the working directory.
2. *Timeline one day early (again).* Synced records start their timeline on the file's date. Turning a
   bare date into a timestamp means midnight UTC, which is the evening before in Toronto, so a job
   applied on Nov 13 showed "Nov 12". Fix: store noon Toronto time for date-only events and format
   timeline dates in America/Toronto; a new test checks the stored time is `2026-11-13 12:00` Toronto.

**End-to-end tests (Playwright, 4):** a separate test server runs on an in-memory database with 5
fixture records, two test accounts and a fake LLM, so tests never touch real data or the Gemini quota.
1. wrong password shows the error; 2. owner: overview count, status filter, search, change status to
Interview, timeline shows "Applied → Interview"; 3. viewer: no classifier link, panel is read-only,
no Save button; 4. owner: classify a posting with the fake model.

Totals now: 53 API tests (Vitest + supertest) + 4 browser tests (Playwright), all passing locally.

## Step 8 — Making it useful every day: the Today queue and two-way sync (2026-11-14)

After using the first version I asked what the site gave me that WaterlooWorks doesn't. Honest
answer: not much day to day. Status updates appear in WaterlooWorks first, and my site only knew
what the agent had written. What I actually did every day was read a markdown file of newly sorted
postings, then go apply. So the site now replaces that file.

**Today page (the new home page).** Saved jobs that have been sorted, with citizen/PR-only jobs
hidden, expired deadlines hidden, most urgent first. Each card shows deadline countdown, location,
duration, applicant count, whether a cover letter is needed, the one-line brief (with hard
requirements), and buttons: **Applied**, **Skip** (pick a reason, stored in the note) and
**Copy job ID**. Header: applied / skipped since Monday.

**New data.** Migration 003 adds `category`, `brief`, `location`, `duration`, `applicants`,
`cover_letter`. The daily sort now writes them into `applications.json`. For the 11-13 sort I wrote
`scripts/import-sort-md.ts`, which parses the markdown lines. Its first dry run caught two wrong
values: on lines that list several jobs ("57 人 / 496480 … 161 人") the applicant count of one job
was attached to another. Rule now: a line that mentions a second job id is skipped. Better missing
than wrong. 33 records were filled in; record count and other fields unchanged (backup kept).

**Two-way sync, last writer wins.** Clicking "Applied" on the website must reach `applications.json`,
otherwise the agent would list the job again tomorrow.
- A website status/note change sets `web_edited_at`.
- `npm run sync` first PULLS pending website edits (`GET /api/sync/pending`) and writes each into the
  file if it is newer than the file's `updated_at`; then PUSHES the whole file.
- On push, if the file record is older than a pending website edit, the server keeps the website's
  status/note and takes every other field from the file; if the file is newer, the file wins and the
  pending flag is cleared.
- A date-only `updated_at` counts as the *start* of that day in Toronto, so a website click later
  that day wins. New records written by the agent use full timestamps with offset.
- The file is written atomically (temp file + rename) in exactly its original format (2-space JSON, no
  final newline), so a write-back changes only the edited record's lines.

**Bugs caught by tests**
1. *Milliseconds.* The write-back stores the edit time to the second, the database to the
   microsecond. After the file "caught up", it still looked a few ms older, so the edit stayed
   pending forever. Fix: compare whole seconds.
2. *Changing what goes into the fingerprint re-updates rows once.* `updated_at` is now hashed as
   written (not cut to the date), so the first sync after the change reported 64 updates (31 old
   timestamp records + 33 backfilled). Harmless, but worth knowing before changing a hash input.
3. *A deadlock in my own integration check.* I started the API and called the sync script with
   `execFileSync` in the same Node process. The synchronous call blocked the event loop, so the server
   could never answer the script. Async `execFile` fixed it.

**Integration check (on a copy of the real file):** first sync created 1,014 rows; marking one job
Applied on the website and syncing wrote exactly that record back (2 lines changed in the file); a
third sync changed nothing.

**Tests now:** 68 API/unit tests (Vitest) + 5 browser tests (Playwright; new: Today queue ordering,
Applied and Skip remove the card and update the weekly count).

## Step 9 — Deployment: GitHub, CI, Neon and Render (2026-11-14)

**Where it runs.**
- **Render (free web service)** builds the repo and runs one Node process that serves both the API and
  the built React app. The whole setup is in `render.yaml` (a Render "Blueprint"), so the deployment is
  code, not dashboard clicks.
- **Neon (free PostgreSQL)**. Render's own free database is deleted after 30 days; Neon's is not.
  The region is AWS us-east-2 (Ohio), the same region as the Render service, so queries don't cross
  the continent.
- The connection uses TLS with certificate checking on (`rejectUnauthorized: true`), not the common
  copy-paste setting that turns the check off.

**Secrets never pass through chat or git.**
- The database URL and Gemini key were pasted into the Render dashboard by me, by hand.
- Locally they live in `.env` / `.env.production` (git-ignored, file mode 600).
- The production login was created with `npm run cli:prod -- user:create`: it prompts for the password,
  so it is never on the command line or in shell history.
- The sync agent's API token was created with `token:create agent --write-env`, which writes it straight
  into `.env` without printing it.

**Bug 1: CI broke on day one for a reason outside my code.** The first GitHub Actions run passed type
checks and every Vitest test, including the real-PostgreSQL ones, but failed at
`playwright install --with-deps`. `ubuntu-latest` had just moved to Ubuntu 26, and Playwright 1.55 does
not know that OS, so it can't install the browser's system libraries. Fix: pin `runs-on: ubuntu-24.04`.
Lesson: "latest" in CI is a dependency that can change under you, so pin it like any other.

**Importing the real data.** `npm run sync` against the live API created 1,014 rows in about 6 seconds.
A second run reported 1,014 unchanged, so the sync is idempotent in production too.

**Checked on the live site:** sign-in, Today queue, Overview and Applications all load real data;
requests without a session get 401. In production the session cookie is set `Secure` + `HttpOnly`; behind Render's HTTPS
proxy (`trust proxy` is set so Express knows the original request was HTTPS).

**Known limit of the free plan:** the service sleeps after 15 minutes without traffic, and the next
visit takes about 50 seconds to wake it up.

**Bug 2: "API key not valid" only in production.** The classifier returned 502 on the live site, while
the same key worked locally. The app only said "Gemini request failed (400)", which wasn't enough.
1. I logged Gemini's own error message (with anything key-like masked): `API_KEY_INVALID`.
2. I still couldn't see the value stored in the Render dashboard, and shouldn't. So at startup the server
   logs the key's *length and the first 8 hex chars of its SHA-256*: enough to compare two keys,
   useless for recovering one.
3. Render: 67 characters. Local: 53. The dashboard held a mis-pasted value, and an earlier "fix" had
   never been saved. After re-pasting, the log showed a 53-character key and classification worked.
Also: the key is now `.trim()`-ed, since values pasted into dashboards often carry a trailing newline.
Lesson: when a secret "works here but not there", compare fingerprints instead of guessing.
