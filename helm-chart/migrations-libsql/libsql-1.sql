-- libSQL schema for the nodejs-back domain: link shortener + async jobs.
-- Idempotent by convention (IF NOT EXISTS / guarded seeds), applied by the
-- version-suffixed libsql-migration Job — same contract as the postgres one.

CREATE TABLE IF NOT EXISTS links (
    code       TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'anonymous',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Full-text index over links (libSQL ships FTS5); kept in sync by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(code UNINDEXED, url, title);

CREATE TRIGGER IF NOT EXISTS links_fts_insert AFTER INSERT ON links BEGIN
    INSERT INTO links_fts(code, url, title) VALUES (new.code, new.url, new.title);
END;

CREATE TRIGGER IF NOT EXISTS links_fts_delete AFTER DELETE ON links BEGIN
    DELETE FROM links_fts WHERE code = old.code;
END;

CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'queued',
    result     TEXT,
    error      TEXT,
    created_by TEXT NOT NULL DEFAULT 'anonymous',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS numbers (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL
);

INSERT INTO numbers(number) SELECT 3087 WHERE NOT EXISTS (SELECT 1 FROM numbers);

INSERT INTO links(code, url, title, created_by)
    SELECT 'demo001', 'https://kubernetes.io/docs/home/', 'Kubernetes documentation', 'demo'
    WHERE NOT EXISTS (SELECT 1 FROM links WHERE code = 'demo001');

INSERT INTO links(code, url, title, created_by)
    SELECT 'demo002', 'https://duckdb.org/docs/', 'DuckDB documentation', 'demo'
    WHERE NOT EXISTS (SELECT 1 FROM links WHERE code = 'demo002');
