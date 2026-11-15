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

## Step 10 — Evaluating the classifier properly: 141 labelled postings (2026-11-15)

The first eval (Step 6) had 20 postings and almost no citizen/PR-only examples, so it could not
answer the question an interviewer will ask: *how do you know the AI is right?*

**Gold set.** The site's database doesn't store posting text, but my workspace had the full text of
310 postings saved during earlier application batches. They stay in a private folder outside this
repo (`eval-private/`, never committed); only job IDs, labels and results are public.
- Labels come from rules applied to the text the model also sees: SWPP/CSJ funding, "must be a
  Canadian citizen", Secret clearance or "Restricted to Work Placement program" → citizen/PR;
  marketing/design/content titles → portfolio/design; city Waterloo/Kitchener/Cambridge or remote →
  Waterloo; the rest → other.
- 13 postings were excluded because the deciding fact was only in the WaterlooWorks prescreen
  questions, not in the text. Grading the model on information it never saw would be unfair.
- I spot-checked 20 labels against the posting text; all 20 were right.
- 141 postings, citizen/PR over-sampled (46) because that is the costly mistake. Split in half:
  **dev** (used to find errors and change the prompt) and **test** (run once per finished prompt).

**Metrics** (`npm run` → `scripts/eval-gold.ts`, reports in `eval/gold/`): accuracy, per-category
precision and recall, a confusion matrix, the costly error counted separately, and consistency
(every posting asked twice).

**Results (Gemini 3.5 Flash-Lite, temperature 0)**

| | dev v2 | dev v3 | **test v2** | **test v3** |
|---|---|---|---|---|
| Accuracy | 58/71 (81.7%) | 71/71 | 68/70 (97.1%) | 68/70 (97.1%) |
| Citizen/PR postings missed (costly) | 9/23 | 0/23 | 2/23 | **0/23** |
| Citizen/PR recall | 60.9% | 100% | 91.3% | **100%** |
| Open postings wrongly marked citizen/PR | 0 | 0 | 0 | 0 |
| Same answer in both runs | 70/71 | — | — | **70/70** |

What the dev errors showed, and what v3 changed (general rules, nothing about specific job IDs):
1. All 9 costly misses were "Restricted to Work Placement program eligible students" postings. The
   v2 prompt never mentioned this restriction, so the model fell through to the location rule.
2. Design/marketing roles located in Waterloo were labelled "waterloo": the model jumped to the
   location. v3 says to decide the role type first.
3. A "remote from Canada" option wasn't recognised as remote.

**Honest reading of the numbers.**
- On the held-out test set accuracy did *not* go up (97.1% both times). What changed is *which*
  mistakes remain: v3 made **zero** costly errors (v2 made 2); its two misses are cheap ones (a
  marketing-insights job called design, a remote option missed).
- The dev set looked much worse for v2 (81.7%) only because, by chance, it held more Work Placement
  postings (9 of its 23 citizen/PR postings vs 2 in test). Small samples move numbers a lot.
- dev v3 = 100% means little: I changed the prompt by looking at dev errors. Only the test number counts.

**Regression check.** `npm run eval:regression` runs 20 fixed dev postings with fresh API calls and
fails on any costly error or accuracy below 90%. It is *not* in GitHub Actions: the posting text is
private (CI can't see it), real calls use the daily quota, and an LLM answer can change between runs,
which would make CI flaky. CI keeps the fake-LLM tests for parsing and validation, plus a new test
that the production prompt is byte-for-byte `eval/prompts/v3.txt`, so the site always runs the
version that was measured. First regression run: 20/20, pass.

### 用自己的话讲（面试用）

- **为什么要评测**：AI 分类“看起来对”不算数。我先准备 141 个已经知道正确答案的岗位，让模型去分，再数它对了多少、错在哪里。
- **准确率**：总共分对了多少。但只看它不够，因为不同的错代价不一样。
- **精确率（precision）**：模型说“这是公民/PR 岗位”的那些里面，有多少真的是。精确率低 = 冤枉了能投的岗位，我会错过机会。
- **召回率（recall）**：真正的公民/PR 岗位里面，模型找出来了多少。召回率低 = 漏掉了不能投的岗位，我会白投、甚至在预筛选里答错。对我来说漏掉更贵，所以单独数“最贵的错误”，还故意多放这类岗位。
- **混淆矩阵**：一张表，行是正确答案，列是模型的答案，一眼能看出“哪类最常被错认成哪类”。我就是从这里发现 9 个错误全是同一个原因（Work Placement 限制没写进规则）。
- **开发集 / 测试集**：改 prompt 只看开发集的错；测试集只在最后跑一次。否则就像先看了考卷答案再考试，分数没有意义。
- **一致性**：同一个岗位问两次，看答案是否一样。temperature=0 也不能保证 100% 一样，所以要实测（测试集 70/70 一致）。

## Step 11 — RAG "Tailor resume": my own bullets, retrieved and cited (2026-11-15)

**What it does.** On a new posting, the owner-only *Tailor resume* page shows which of my existing
resume bullets and cover-letter paragraphs to use, the posting phrase each one answers, requirements
none of my material covers, and the most similar past postings with what I did with them.

**Pipeline.**
1. **Chunking** (`scripts/rag-chunks.ts`): one chunk = one resume bullet (74), one cover-letter
   paragraph (10; drafts I haven't approved are skipped), or one past posting (310). A bullet is the
   unit I actually reuse.
2. **Embeddings**: `gemini-embedding-001`, 768 numbers per chunk. Computed locally by
   `npm run rag:index` (cached, waits out the free per-minute token limit) and uploaded with the
   sync token. The server only embeds the pasted posting.
3. **Vector search**: cosine similarity, top 8, at most 2 chunks per project. About 400 vectors is a
   brute-force scan in TypeScript taking well under a millisecond, so no vector database (pgvector) needed.
4. **Grounded generation**: Gemini Flash-Lite gets the posting and the 8 numbered excerpts and returns
   JSON picks `{chunk_id, requirement, why}` plus `gaps`.
5. **Hallucination guard** (`guard()` in `server/rag.ts`): a pick must cite a retrieved excerpt; every
   number in "why" must appear in that excerpt or the posting; "requirement" must be a word-for-word
   quote from the posting, otherwise it is flagged. The page shows the stored excerpt text, not
   model text, so a suggestion cannot claim something my material doesn't say.

**Privacy.** The outline and library hold personal notes, and the repo is public. The text lives only
in the private database. Upload needs the agent token; search is owner-only, so viewers get 403 and
signed-out users get 401. Tests use made-up sample chunks.

**Eval** (`scripts/eval-rag.ts`, `eval/rag/`): 8 postings (QA, testing, web, data, UX, coordinator,
AI, iOS). For each one I confirmed which of my projects/paragraphs *should* come back.

| | round 1 (whole posting embedded) | round 2 (focused text, ≤2 per project) |
|---|---|---|
| Hit rate@8 (≥1 expected source retrieved) | 8/8 | 8/8 |
| Recall@8 (share of expected sources retrieved) | 65.1% | **70.1%** |
| Picks blocked by the guard | 0/35 | 0/35 |
| "Requirement" not a real quote | 0/35 | 0/35 |

- *Round 1 problem:* every similarity score sat between 0.60 and 0.62. WaterlooWorks boilerplate (work
  term, address, application method) made all postings look alike. Fix: `focusPosting()` embeds only
  the title, Job Summary, Job Responsibilities and Required Skills. One project with many similar
  bullets could also fill the list, so retrieval now allows at most 2 chunks per project.
- *Manual faithfulness check:* I listed every capitalised term in the 35 "why" lines that isn't in the
  excerpt or posting. There were 5 hits, all false alarms (sentence-initial words, "President" from
  "Class President").
- *Honest limits:* 8 postings is small, and I improved retrieval while looking at these same 8, so
  70.1% is not a held-out number. UX design is still weak (1/4): my design material is thin in English.
  That's a content gap, not a retrieval bug. The guard checks numbers, ids and quotes; it can't prove
  that every word of "why" is true, which is why the page shows the original excerpt next to it.

### 用自己的话讲（面试用）

- **RAG 是什么**：先“查资料”（retrieval），再让模型“只根据查到的资料回答”（generation）。模型本来就会编，RAG 的意义是把它的回答绑在我自己的真实材料上。
- **切块（chunking）**：把材料切成小块再存。我按“一条简历 bullet / 一段 cover letter / 一个岗位”切，因为这是我真正会复用的单位。块太大，查到了也得再删；块太小，意思不完整。
- **向量（embedding）**：把一段文字变成 768 个数字。意思相近的文字，数字也相近。“写自动化测试”和“Playwright end-to-end tests”字面不一样，但向量很接近，所以能查到，这一点关键词搜索做不到。
- **top-k**：算岗位和每块材料的相似度（余弦相似度），取最像的 k 块（我用 k=8），每个项目最多 2 块，免得一个项目占满。
- **防编造（hallucination guard）**：模型只能“选”，不能“写”。它必须引用查到的块的编号；理由里出现的数字必须在原文里；页面显示的是我原来写的那句话。这就是我做这个功能的卖点：建议里没有一句是简历里没有的。
- **怎么评测**：检索用 hit rate 和 recall。我先标好每个岗位“应该查到哪些项目”，再看前 8 个里查到几个（recall 70.1%）。生成用忠实度：被拦下的建议数，以及我人工检查理由里有没有原文没有的东西。
- **precision 和 recall 在这里的意思**：precision 是查出来的 8 块里有多少是真的相关；recall 是该查到的里面查到了多少。我更看重 recall，因为漏掉一个好例子比多看一个不相关的块代价大，后者模型和我都会跳过。

**Bug on the first live upload.** `npm run rag:index` got `500 internal error`. The body was 7.5 MB
(395 chunks × 768 numbers printed with ~17 digits each), over the route's 5 MB limit. Express raised
"entity too large", but my error handler didn't know that type and turned it into a 500, which hid the
cause. Fixes: the handler now answers **413** (test added); vectors are rounded to 6 decimals, which
doesn't change the cosine ranking, so the upload is 3.9 MB; the route limit is 10 MB.

**Adding my skills lines (rounds 3–4).** On the live site a QA posting listed "Git" as a gap, because
only project bullets were indexed. I added the 8 English skills lines from the outline as chunks.
- Round 3 (skills ranked together with bullets): recall@8 dropped **70.1% → 65.1%**. The skills lines
  took top-8 slots from project bullets that should have come back.
- Round 4 (skills get their own 3 slots next to the 8 bullet/paragraph slots): recall@8 back to
  **70.1%**. The QA posting's gaps became tools I really haven't used (CodeceptJS, K6, TestRail), not Git.
- New side effect: when the model cites a skills line it sometimes puts the skill list itself in
  "requirement" instead of a posting quote. The guard flags these (6/37), so the flag works, but it's
  something to tighten in the prompt later.
