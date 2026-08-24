/** Lightweight markdown-ish rendering for chat bubbles (no extra deps). */

function formatInline(text) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, j) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={j}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      return <em key={j}>{p.slice(1, -1)}</em>;
    }
    return p;
  });
}

export function ChatMessageContent({ text }) {
  if (!text) return null;

  const blocks = String(text).split(/\n\n+/);

  return (
    <div className="chat-message-content">
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => /^[-•*]\s/.test(l));

        if (isList) {
          return (
            <ul key={bi} className="chat-msg-list">
              {lines.map((line, li) => (
                <li key={li}>{formatInline(line.replace(/^[-•*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className="chat-msg-p">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {formatInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
