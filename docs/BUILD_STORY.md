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
