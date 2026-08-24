import { query } from "../../db.js";

const DEFAULT_TITLE = "Cuộc trò chuyện";

export function newSessionId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function ensureChatSession(sessionId, userId, titleHint) {
  if (!sessionId || !userId) return;
  const title = (titleHint || DEFAULT_TITLE).trim().slice(0, 200) || DEFAULT_TITLE;
  await query(
    `INSERT INTO chat_sessions (id, user_id, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       updated_at = CURRENT_TIMESTAMP,
       title = CASE
         WHEN chat_sessions.title = $4 AND EXCLUDED.title <> $4 THEN EXCLUDED.title
         ELSE chat_sessions.title
       END`,
    [sessionId, userId, title, DEFAULT_TITLE]
  );
}

export async function appendChatMessage(sessionId, userId, { role, content, meta }) {
  if (!sessionId || !userId || !content) return;
  await ensureChatSession(sessionId, userId);
  await query(
    `INSERT INTO chat_messages (session_id, role, content, meta)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [sessionId, role, content, meta ? JSON.stringify(meta) : null]
  );
  await query(`UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`, [
    sessionId,
    userId,
  ]);
}

export async function listChatSessions(userId, limit = 40) {
  if (!userId) return [];
  return query(
    `SELECT
       s.id,
       s.title,
       s.created_at,
       s.updated_at,
       (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
     FROM chat_sessions s
     WHERE s.user_id = $1
     ORDER BY s.updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );
}

export async function getChatMessages(sessionId, userId, limit = 200) {
  if (!sessionId || !userId) return [];
  const owned = await query(
    `SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  if (!owned.length) return null;
  return query(
    `SELECT id, role, content, meta, created_at
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY id ASC
     LIMIT $2`,
    [sessionId, limit]
  );
}

export async function deleteChatSession(sessionId, userId) {
  if (!sessionId || !userId) return false;
  const result = await query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
    [sessionId, userId]
  );
  return result.length > 0;
}
