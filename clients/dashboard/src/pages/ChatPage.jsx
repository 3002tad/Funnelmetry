import { useCallback, useEffect, useRef, useState } from "react";
import { DataPanel } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconChat } from "../components/icons.jsx";
import { api } from "../lib/api.js";

const SUGGESTIONS = [
  "Tóm tắt tình hình website hiện tại",
  "Top sản phẩm được xem nhiều nhất?",
  "Sản phẩm nào nhiều view nhưng ít mua?",
  "Người dùng rớt nhiều nhất ở bước nào?",
  "Gợi ý tối ưu conversion rate",
];

function renderAnswer(text) {
  return (text || "").split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p
    );
    return <span key={i}>{parts}<br /></span>;
  });
}

export function ChatPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Xin chào! Mình là **trợ lý phân tích hành vi** cho cửa hàng của bạn.\n\n" +
        "• Số liệu lấy từ **PostgreSQL** (chính xác)\n" +
        "• Insight ngữ cảnh từ **Qdrant**\n" +
        "• Trả lời bằng **Ollama** khi đã cấu hình\n\n" +
        "Hãy chọn gợi ý bên dưới hoặc tự nhập câu hỏi.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const bottomRef = useRef(null);

  const loadInsights = useCallback(async () => {
    try {
      const d = await api.chatInsights(10);
      setInsights(d.insights || []);
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
          meta: { intent: res.intent, model: res.model_used, rag: res.rag_used },
        },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `Lỗi: ${err.message}`, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Chatbot"
        subtitle="Hỏi về hành vi khách hàng — số liệu từ database, không tự bịa số"
        live={false}
      />
      <div className="mgr-content">
        <div className="mgr-chat-layout">
          <DataPanel
            title="Trò chuyện"
            subtitle="Tiếng Việt · intent + SQL + RAG"
            action={
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)", fontSize: "0.8rem", fontWeight: 600 }}>
                <IconChat size={16} /> qwen2.5:3b
              </span>
            }
            className="mgr-chat-main"
          >
            <div style={{ padding: "1rem 1.25rem" }}>
              <div className="mgr-chat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`chat-bubble ${m.role}${m.error ? " error" : ""}`}>
                    <div className="chat-bubble-inner">{renderAnswer(m.content)}</div>
                    {m.meta && (
                      <span className="chat-meta">
                        {m.meta.intent}
                        {m.meta.model && m.meta.model !== "template" ? ` · ${m.meta.model}` : ""}
                        {m.meta.rag ? " · RAG" : ""}
                      </span>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="chat-bubble assistant">
                    <div className="chat-bubble-inner muted">Đang phân tích dữ liệu…</div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <form className="mgr-chat-input-row" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Hỏi về doanh thu, funnel, sản phẩm…"
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
          </DataPanel>

          <section className="data-panel chat-insights">
            <h3>Pipeline insights</h3>
            {insights.length === 0 ? (
              <ul className="insight-list">
                <li style={{ listStyle: "none", color: "var(--text-faint)" }}>
                  Chưa có insight — cần traffic + flush KPI (~30s).
                </li>
              </ul>
            ) : (
              <ul className="insight-list">
                {insights.map((item, i) => <li key={i}>{item.text}</li>)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
