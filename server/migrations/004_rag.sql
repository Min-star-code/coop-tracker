-- RAG "tailoring helper": text chunks I may reuse (resume bullets, cover-letter paragraphs) and past
-- postings, each with its embedding. Private data: only the owner can search it, and the text is
-- uploaded by the sync agent from files that are NOT in this public repo.
CREATE TABLE rag_chunks (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('outline', 'library', 'posting')),
  ref         TEXT NOT NULL,              -- where it came from: project title, library section, job id
  text        TEXT NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}', -- e.g. a posting's title and what I did with it
  hash        TEXT NOT NULL UNIQUE,       -- sha256 of source + ref + text: unchanged chunks keep their embedding
  embedding   REAL[] NOT NULL,            -- ~400 chunks: a brute-force cosine scan in TypeScript is fast enough
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rag_chunks_source ON rag_chunks (source);
