CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_states_updated_at ON user_states(updated_at);
