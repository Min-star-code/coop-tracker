-- Machine credentials for the AI agent that syncs applications.json.
-- Like sessions, only the SHA-256 of the token is stored.
CREATE TABLE api_tokens (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Non-WaterlooWorks applications get their own stable key from the agent (e.g. "linkedin-acme-qa").
ALTER TABLE applications ADD COLUMN external_id TEXT UNIQUE;
ALTER TABLE applications ADD CONSTRAINT applications_one_key CHECK (
  (source = 'waterlooworks' AND external_id IS NULL) OR (source <> 'waterlooworks' AND ww_job_id IS NULL)
);

-- Fingerprint of the JSON record last applied by a sync. If the agent sends the same record
-- again, nothing changes, so edits the owner made in the web UI are kept.
ALTER TABLE applications ADD COLUMN sync_hash TEXT;
