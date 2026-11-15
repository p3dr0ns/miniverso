PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_attempts_lookup ON auth_login_attempts(email, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS auth_login_attempts_created_at ON auth_login_attempts(created_at);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions(user_id);
