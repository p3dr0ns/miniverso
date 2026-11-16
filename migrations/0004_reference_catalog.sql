CREATE TABLE IF NOT EXISTS catalog_reference (
  code TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  variants_json TEXT NOT NULL DEFAULT '[]',
  images_json TEXT NOT NULL DEFAULT '[]',
  source_name TEXT NOT NULL,
  source_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_reference_updated_at ON catalog_reference(updated_at);
