import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";

const SUGGESTIONS = [
  "Tóm tắt tình hình website trong 60 phút",
  "Top sản phẩm được xem nhiều nhất?",
  "Sản phẩm nào nhiều view nhưng ít mua?",
  "Người dùng rớt nhiều nhất ở bước nào trong phễu?",
  "Gợi ý tối ưu conversion thấp",
];

function renderAnswer(text) {
  const parts = (text || "").split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part.split("\n").map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </span>
    ));
  });
}

export function ChatPage({ variant = "admin" }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Xin chào! Mình là trợ lý phân tích — số liệu lấy từ PostgreSQL, insight từ Qdrant. Hãy thử một câu hỏi bên dưới.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const bottomRef = useRef(null);

  const loadInsights = useCallback(async () => {
    try {
      const data = await api.chatInsights(8);
      setInsights(data.insights || []);
    } catch {
      setInsights([]);
    }
  }, []);

  useEffect(() => {
    loadInsights();
    const t = setInterval(loadInsights, 30000);
    return () => clearInterval(t);
  }, [loadInsights]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await api.chat(msg);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          meta: { intent: res.intent, rag_used: res.rag_used },
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Lỗi: ${err.message}`, error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const rootClass = variant === "shop" ? "shop-chat" : "admin-chat";

  return (
    <>
      <PageHeader
        variant={variant}
        title={variant === "shop" ? "Trợ lý cửa hàng" : "AI Chatbot"}
        subtitle="Hỏi bằng tiếng Việt — số liệu từ DB, ngữ cảnh từ Qdrant"
      />

      <div className={`chat-layout ${rootClass}`}>
        <div className={variant === "shop" ? "shop-panel chat-main" : "admin-panel chat-main"}>
          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.role}${m.error ? " error" : ""}`}>
                <div className="chat-bubble-inner">{renderAnswer(m.content)}</div>
                {m.meta?.intent && (
                  <span className="chat-meta">
                    intent: {m.meta.intent}
                    {m.meta.rag_used ? " · RAG" : ""}
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-bubble assistant">
                <div className="chat-bubble-inner muted">Đang truy vấn…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ví dụ: Sản phẩm nào nhiều view nhưng ít mua?"
              disabled={loading}
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
              Gửi
            </button>
          </form>

          <div className="chat-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chat-chip" onClick={() => send(s)} disabled={loading}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <aside className={variant === "shop" ? "shop-panel chat-insights" : "admin-panel chat-insights"}>
          <h3>Insight pipeline (Qdrant)</h3>
          {insights.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Chưa có insight — cần traffic và vài lần flush KPI (~30s).
            </p>
          ) : (
            <ul className="insight-list">
              {insights.map((item, i) => (
                <li key={i}>{item.text}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
