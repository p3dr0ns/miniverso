PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_send_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_send_requests_created_at
  ON auth_send_requests(created_at);
CREATE INDEX IF NOT EXISTS auth_send_requests_email_created_at
  ON auth_send_requests(email, created_at);
CREATE INDEX IF NOT EXISTS auth_send_requests_ip_created_at
  ON auth_send_requests(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS auth_challenges (
  email TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'consumed')),
  consumed_by TEXT,
  CHECK ((status = 'consumed' AND consumed_by IS NOT NULL)
    OR (status != 'consumed' AND consumed_by IS NULL))
);

CREATE INDEX IF NOT EXISTS auth_challenges_expires_at
  ON auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at
  ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id
  ON auth_sessions(user_id);
