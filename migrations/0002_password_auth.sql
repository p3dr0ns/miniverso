ALTER TABLE auth_users ADD COLUMN password_hash TEXT;
ALTER TABLE auth_users ADD COLUMN password_salt TEXT;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_attempts_lookup ON auth_login_attempts(email, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS auth_login_attempts_created_at ON auth_login_attempts(created_at);
