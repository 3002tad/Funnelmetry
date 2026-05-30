import { useCallback, useEffect, useRef, useState } from "react";
import { DataPanel } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconChat } from "../components/icons.jsx";
import { ChatMessageContent } from "../components/ChatMessageContent.jsx";
import { api } from "../lib/api.js";

const HIDE_META_INTENTS = new Set([
  "greeting",
  "help",
  "thanks",
  "goodbye",
  "ack",
  "off_topic",
]);

const SUGGESTIONS = [
  "Phân tích tình hình shop 60 phút gần nhất",
  "Vấn đề lớn nhất đang là gì và nên làm gì trước?",
  "Sản phẩm nào nhiều view nhưng không mua?",
  "Phễu đang rớt ở bước nào — giải thích giúp",
  "So sánh 2 giờ này với 2 giờ trước",
];

const WELCOME_MESSAGE = {
  role: "assistant",
  content:
    "Chào! Mình là trợ lý **phân tích shop** — hỏi bằng tiếng Việt, mình trả lời dựa trên số liệu pipeline.\n\n" +
    "Thử: *tổng quan 60 phút qua*, *doanh thu hôm nay*, hoặc gõ **help** để xem gợi ý.",
};

function newLocalSessionId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function readStoredSessionId() {
  try {
    return sessionStorage.getItem("chat_session_id") || "";
  } catch {
    return "";
  }
}

function mapApiMessage(m) {
  const meta = m.meta && typeof m.meta === "object" ? m.meta : null;
  return {
    role: m.role,
    content: m.content,
    meta: meta
      ? {
          intent: meta.intent,
          model: meta.model,
          rag: meta.rag,
        }
      : undefined,
  };
}

function formatSessionDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ChatPage() {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [sessions, setSessions] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [insights, setInsights] = useState([]);
  const bottomRef = useRef(null);
  const sessionIdRef = useRef("");

  const persistSessionId = useCallback((id) => {
    if (!id) return;
    sessionIdRef.current = id;
    setCurrentSessionId(id);
    setSessionReady(true);
    try {
      sessionStorage.setItem("chat_session_id", id);
    } catch {
      /* private mode */
    }
  }, []);

  const useLocalSessionFallback = useCallback(() => {
    const sid = readStoredSessionId() || newLocalSessionId();
    persistSessionId(sid);
    setMessages([WELCOME_MESSAGE]);
    setSessions([]);
  }, [persistSessionId]);

  const refreshSessions = useCallback(async () => {
    const data = await api.chatSessions();
    setSessions(data.sessions || []);
    return data.sessions || [];
  }, []);

  const loadMessages = useCallback(async (sessionId) => {
    try {
      const data = await api.chatSessionMessages(sessionId);
      if (!data.messages?.length) {
        setMessages([WELCOME_MESSAGE]);
        return;
      }
      setMessages(data.messages.map(mapApiMessage));
    } catch {
      setMessages([WELCOME_MESSAGE]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryError("");
      try {
        const list = await refreshSessions();
        let sid = readStoredSessionId();
        if (!sid || !list.some((s) => s.id === sid)) {
          sid = list[0]?.id;
        }
        if (!sid) {
          try {
            const created = await api.chatSessionCreate();
            sid = created.session_id;
            await refreshSessions();
          } catch {
            useLocalSessionFallback();
            if (!cancelled) {
              setHistoryError(
                "Chưa lưu lịch sử trên server (thiếu bảng chat hoặc API cũ). Chat vẫn gửi được."
              );
            }
            return;
          }
        }
        if (!cancelled) {
          persistSessionId(sid);
          await loadMessages(sid);
        }
      } catch {
        if (!cancelled) {
          useLocalSessionFallback();
          setHistoryError(
            "Không tải lịch sử chat — dùng phiên cục bộ. Chạy migration 004_chat_history.sql nếu cần lưu DB."
          );
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessages, persistSessionId, refreshSessions, useLocalSessionFallback]);

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

  async function selectSession(id) {
    if (id === sessionIdRef.current || loading) return;
    persistSessionId(id);
    setBooting(true);
    try {
      await loadMessages(id);
    } finally {
      setBooting(false);
    }
  }

  async function startNewChat() {
    if (loading) return;
    try {
      const { session_id } = await api.chatSessionCreate();
      persistSessionId(session_id);
      setMessages([WELCOME_MESSAGE]);
      setHistoryError("");
      await refreshSessions();
    } catch {
      const sid = newLocalSessionId();
      persistSessionId(sid);
      setMessages([WELCOME_MESSAGE]);
      setHistoryError("Phiên mới (cục bộ) — lịch sử server chưa khả dụng.");
    }
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    if (!window.confirm("Xóa cuộc trò chuyện này?")) return;
    try {
      await api.chatSessionDelete(id);
      const list = await refreshSessions();
      if (id === currentSessionId) {
        if (list[0]?.id) {
          persistSessionId(list[0].id);
          await loadMessages(list[0].id);
        } else {
          await startNewChat();
        }
      }
    } catch {
      setHistoryError("Không xóa được trên server.");
    }
  }

  async function send(text) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    if (!sessionIdRef.current) {
      persistSessionId(readStoredSessionId() || newLocalSessionId());
    }

    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await api.chat(msg, undefined, sessionIdRef.current);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer,
          meta: { intent: res.intent, model: res.model_used, rag: res.rag_used },
        },
      ]);
      try {
        await refreshSessions();
      } catch {
        /* history optional */
      }
    } catch (err) {
      const errMsg =
        err.name === "TimeoutError"
          ? "Hết thời gian chờ phản hồi (~75s). Kiểm tra Ollama trên Lap1 (`kubectl -n realtime get pods`) hoặc thử câu ngắn hơn."
          : err.message;
      setMessages((m) => [...m, { role: "assistant", content: `Lỗi: ${errMsg}`, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  const inputDisabled = loading || booting;
  const sendDisabled = loading || booting || !sessionReady || !input.trim();

  return (
    <>
      <PageHeader
        title="AI Chatbot"
        subtitle="Hỏi về hành vi khách hàng — lịch sử chat lưu trên PostgreSQL khi đã migration"
        live={false}
      />
      <div className="mgr-content">
        {historyError ? (
          <p className="mgr-chat-history-warn" role="status">
            {historyError}
          </p>
        ) : null}
        <div className="mgr-chat-layout">
          <aside className="data-panel mgr-chat-sessions">
            <div className="mgr-chat-sessions-head">
              <h3>Lịch sử chat</h3>
              <button type="button" className="btn btn-sm btn-primary" onClick={startNewChat} disabled={loading}>
                + Mới
              </button>
            </div>
            {booting && sessions.length === 0 ? (
              <p className="muted mgr-chat-sessions-empty">Đang tải…</p>
            ) : sessions.length === 0 ? (
              <p className="muted mgr-chat-sessions-empty">
                {historyError ? "Chỉ phiên hiện tại (chưa lưu DB)." : "Chưa có cuộc trò chuyện."}
              </p>
            ) : (
              <ul className="mgr-chat-session-list">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`mgr-chat-session-item${s.id === currentSessionId ? " active" : ""}`}
                      onClick={() => selectSession(s.id)}
                      disabled={loading}
                    >
                      <span className="mgr-chat-session-title">{s.title || "Cuộc trò chuyện"}</span>
                      <span className="mgr-chat-session-meta">
                        {formatSessionDate(s.updated_at)} · {s.message_count ?? 0} tin
                      </span>
                    </button>
                    <button
                      type="button"
                      className="mgr-chat-session-del"
                      title="Xóa"
                      onClick={(e) => deleteSession(s.id, e)}
                      disabled={loading}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <DataPanel
            title="Trò chuyện"
            subtitle="Tiếng Việt · intent + SQL + RAG"
            action={
              <span className="chat-model-badge">
                <IconChat size={16} /> qwen2.5:3b
              </span>
            }
            className="mgr-chat-main"
          >
            <div className="mgr-chat-main-body">
              <div className="mgr-chat-messages">
                {booting ? (
                  <div className="chat-bubble assistant">
                    <div className="chat-bubble-inner muted">Đang tải lịch sử chat…</div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div key={i} className={`chat-bubble ${m.role}${m.error ? " error" : ""}`}>
                      <div className="chat-bubble-inner">
                        <ChatMessageContent text={m.content} />
                      </div>
                      {m.meta && !HIDE_META_INTENTS.has(m.meta.intent) && (
                        <span className="chat-meta">
                          {m.meta.intent}
                          {m.meta.model && m.meta.model !== "template" ? ` · ${m.meta.model}` : ""}
                          {m.meta.rag ? " · RAG" : ""}
                        </span>
                      )}
                    </div>
                  ))
                )}
                {loading && (
                  <div className="chat-bubble assistant">
                    <div className="chat-bubble-inner muted">
                      Đang truy vấn PostgreSQL và (nếu bật) Ollama — thường 5–30 giây…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <form
                className="mgr-chat-input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Hỏi về doanh thu, funnel, sản phẩm…"
                  disabled={inputDisabled}
                />
                <button type="submit" className="btn btn-primary" disabled={sendDisabled}>
                  Gửi
                </button>
              </form>

              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chat-chip"
                    onClick={() => send(s)}
                    disabled={loading || booting || !sessionReady}
                  >
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
                <li className="insight-empty-item">Chưa có insight — cần traffic + flush KPI (~30s).</li>
              </ul>
            ) : (
              <ul className="insight-list">
                {insights.map((item, i) => (
                  <li key={i}>{item.text}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
