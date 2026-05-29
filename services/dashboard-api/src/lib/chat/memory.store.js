const MAX_SESSIONS = 500;
const TTL_MS = 2 * 60 * 60 * 1000;
const sessions = new Map();

function prune() {
  if (sessions.size <= MAX_SESSIONS) return;
  const now = Date.now();
  for (const [id, row] of sessions) {
    if (now - row.updatedAt > TTL_MS) sessions.delete(id);
  }
}

/**
 * @param {string|null|undefined} sessionId
 */
export function getSessionMemory(sessionId) {
  if (!sessionId) return null;
  const row = sessions.get(sessionId);
  if (!row) return null;
  if (Date.now() - row.updatedAt > TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  return row.context;
}

export function updateSessionMemory(sessionId, patch) {
  if (!sessionId) return;
  prune();
  const prev = sessions.get(sessionId)?.context || {};
  sessions.set(sessionId, {
    context: { ...prev, ...patch, updatedAt: Date.now() },
    updatedAt: Date.now(),
  });
}
