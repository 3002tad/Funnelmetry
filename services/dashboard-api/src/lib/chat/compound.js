import { detectIntent, isLikelyFollowUp } from "./intent.js";
import { detectStaticIntent } from "./static-intents.js";

const ANALYZE_RE =
  /phân tích|đánh giá|nhận xét|bức tranh|vấn đề lớn|vấn đề chính|nguyên nhân|tại sao|đọc số|insight|ưu tiên/i;

const SPLIT_RE = /\s+và\s+|\s*,\s*|\s*;\s*|\s+đồng thời\s+/i;

const NON_ANALYTICS_INTENTS = new Set([
  "greeting",
  "help",
  "thanks",
  "goodbye",
  "ack",
  "off_topic",
  "general",
  "optimize",
]);

/** Split "A và B" / "A, B" into clauses (max 3). Returns null when not compound. */
export function splitCompoundClauses(message) {
  const text = (message || "").trim();
  if (text.length < 15) return null;
  if (ANALYZE_RE.test(text)) return null;
  if (isLikelyFollowUp(text)) return null;
  if (!SPLIT_RE.test(text)) return null;

  const parts = text
    .split(SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= 6);

  if (parts.length < 2 || parts.length > 3) return null;
  return parts;
}

/** True when message looks like multiple analytics questions in one turn. */
export function isCompoundCandidate(message) {
  if (!splitCompoundClauses(message)) return false;
  const staticHit = detectStaticIntent(message, null, detectIntent(message) === "general");
  return !staticHit;
}
