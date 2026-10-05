-- migration 2 — the "notes" CRUD domain (implemented by BOTH backends), the
-- async-jobs table (nodejs worker consumes a Redis Stream and updates it) and
-- the daily report target table (filled by the report CronJob).
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT 'anonymous',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,                      -- uuid minted by the API
  type TEXT NOT NULL,                       -- wordcount | fibonacci
  status TEXT NOT NULL DEFAULT 'queued',    -- queued | processing | done | failed
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  created_by TEXT NOT NULL DEFAULT 'anonymous',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_reports (
  day DATE NOT NULL,
  owner TEXT NOT NULL,
  notes_count INT NOT NULL,
  PRIMARY KEY (day, owner)
);

-- a couple of demo notes so the frontend isn't empty on a fresh install
INSERT INTO notes (title, body, owner)
SELECT 'Welcome to the notes demo',
       'This note lives in Postgres and is served by BOTH the nodejs and the golang backend through one API contract.',
       'demo'
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE title = 'Welcome to the notes demo');

INSERT INTO notes (title, body, owner)
SELECT 'Async jobs demo',
       'POST /api/v1/nodejs/jobs {"type":"wordcount","payload":{"noteId":1}} — a worker consumes the Redis Stream and fills jobs.result.',
       'demo'
WHERE NOT EXISTS (SELECT 1 FROM notes WHERE title = 'Async jobs demo');
