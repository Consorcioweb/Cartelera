CREATE TABLE IF NOT EXISTS urls (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'no-vista' CHECK (status IN ('vista', 'no-vista')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);
