-- Users who can log in. Only two roles: the owner edits, a viewer (e.g. a mentor) reads.
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- scrypt hash, never the plain password
  role          TEXT NOT NULL CHECK (role IN ('owner', 'viewer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions. The cookie holds a random token; we store only its SHA-256,
-- so a leaked database row cannot be replayed as a cookie.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- One row per job saved or applied to, from WaterlooWorks or anywhere else.
CREATE TABLE applications (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('waterlooworks', 'company_site', 'linkedin', 'referral', 'other')),
  ww_job_id   TEXT UNIQUE,                  -- only for WaterlooWorks rows; NULLs never clash
  company     TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT,
  status      TEXT NOT NULL CHECK (status IN ('Saved', 'Applied', 'Interview', 'Offer', 'Ranked', 'Rejected', 'Skipped')),
  applied_on  DATE,
  deadline    DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source = 'waterlooworks' OR ww_job_id IS NULL)
);
CREATE INDEX applications_status_idx ON applications(status);
CREATE INDEX applications_deadline_idx ON applications(deadline) WHERE deadline IS NOT NULL;

-- Every status change, so the app can show a timeline (Applied -> Interview -> Offer).
CREATE TABLE status_events (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_events_app_idx ON status_events(application_id);
