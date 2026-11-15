-- What the daily sort writes about each new posting, so the website can show a to-do queue.
ALTER TABLE applications ADD COLUMN category TEXT
  CHECK (category IN ('citizen_pr', 'portfolio_design', 'waterloo', 'other'));
ALTER TABLE applications ADD COLUMN brief TEXT;          -- one line: what the job is, hard requirements
ALTER TABLE applications ADD COLUMN location TEXT;       -- e.g. "Toronto hybrid", "Remote"
ALTER TABLE applications ADD COLUMN duration TEXT;       -- e.g. "4 months", "8 months required"
ALTER TABLE applications ADD COLUMN applicants INTEGER CHECK (applicants >= 0);
ALTER TABLE applications ADD COLUMN cover_letter BOOLEAN;

-- Two-way sync. Set when the owner changes status/note on the website; the sync script pulls these
-- rows back into applications.json. Cleared once the file has caught up with the website.
ALTER TABLE applications ADD COLUMN web_edited_at TIMESTAMPTZ;
CREATE INDEX applications_web_edited_idx ON applications(web_edited_at) WHERE web_edited_at IS NOT NULL;
