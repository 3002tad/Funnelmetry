-- Chat session history for dashboard assistant (per dashboard user).

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         VARCHAR(64) PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES dashboard_users (id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL DEFAULT 'Cuộc trò chuyện',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
  ON chat_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
  ON chat_messages (session_id, id);
