const EMAIL_RE = /\b[\w.-]+@[\w.-]+\.\w+\b/g;
const PHONE_RE = /\b0\d{9,10}\b/g;
const IP_RE = /\b\d{1,3}(\.\d{1,3}){3}\b/g;
const ID_RE = /\b(session|user)[_-]?id\s*[:=]\s*[\w-]+/gi;

/**
 * Redact PII patterns from model/template output.
 * @returns {{ text: string, status: "pass"|"redacted" }}
 */
export function guardOutput(answer) {
  const original = String(answer || "");
  let text = original;
  text = text.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  text = text.replace(PHONE_RE, "[REDACTED_PHONE]");
  text = text.replace(IP_RE, "[REDACTED_IP]");
  text = text.replace(ID_RE, "[REDACTED_ID]");
  const status = text === original ? "pass" : "redacted";
  return { text, status };
}
