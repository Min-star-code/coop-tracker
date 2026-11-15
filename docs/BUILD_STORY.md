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
