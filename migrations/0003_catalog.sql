CREATE TABLE IF NOT EXISTS catalog_items (
  code TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  contributor_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  contributions INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_items_updated_at ON catalog_items(updated_at);
CREATE TABLE IF NOT EXISTS catalog_contributions (
  code TEXT NOT NULL REFERENCES catalog_items(code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
