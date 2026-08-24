/** In-memory idempotency by event_id (Adapter Standard §9). */

const seen = new Map();
const MAX = Number(process.env.BUSINESS_EVENT_DEDUP_CACHE_SIZE || 50_000);

export function markSeen(eventId) {
  if (!eventId) return false;
  if (seen.has(eventId)) return true;
  seen.set(eventId, Date.now());
  while (seen.size > MAX) {
    const oldest = seen.keys().next().value;
    seen.delete(oldest);
  }
  return false;
}

export function resetDedupForTests() {
  seen.clear();
}
