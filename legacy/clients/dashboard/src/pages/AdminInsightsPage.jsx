import { useCallback } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminInsightsPage() {
  const insightsFetcher = useCallback(() => api.chatInsights(20), []);
  const pipelineFetcher = useCallback(() => api.systemPipeline(), []);

  const insights = useAutoRefresh(insightsFetcher, 30000);
  const pipeline = useAutoRefresh(pipelineFetcher, 15000);

  const aiServices = pipeline.data?.service_groups?.ai || [];
  const qdrant = aiServices.find((s) => s.name === "qdrant");
  const ollama = aiServices.find((s) => s.name === "ollama");

  return (
    <>
      <PageHeader
        variant="admin"
        title="Chatbot & Insights"
        subtitle="Qdrant RAG · Ollama LLM · insight vectors từ streaming"
        onRefresh={() => { insights.refresh(); pipeline.refresh(); }}
      />

      <div className="admin-card-grid">
        <div className={`admin-card ${qdrant?.status === "ok" ? "ok" : "warn"}`}>
          <div className="label">Qdrant</div>
          <div className="value" style={{ fontSize: "1.1rem" }}>{qdrant?.status?.toUpperCase() || "—"}</div>
          <div className="sub">{qdrant?.detail || "—"}</div>
        </div>
        <div className={`admin-card ${ollama?.status === "ok" ? "ok" : "warn"}`}>
          <div className="label">Ollama</div>
          <div className="value" style={{ fontSize: "1.1rem" }}>{ollama?.status?.toUpperCase() || "—"}</div>
          <div className="sub">{ollama?.detail || "—"}</div>
        </div>
        <div className="admin-card highlight">
          <div className="label">Insights loaded</div>
          <div className="value">{(insights.data?.insights || []).length}</div>
          <div className="sub">Qdrant: {insights.data?.qdrant || "—"}</div>
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-header">
          <h3>Insight gần nhất</h3>
          <a href="/shop/chat" className="btn btn-ghost" style={{ fontSize: "0.78rem" }}>
            → Mở Chat manager
          </a>
        </div>
        <div className="admin-panel-body">
          {insights.loading && !insights.data ? (
            <p className="empty">Đang tải…</p>
          ) : insights.error ? (
            <p className="empty">Lỗi: {insights.error}</p>
          ) : !(insights.data?.insights || []).length ? (
            <p className="empty" style={{ margin: 0 }}>
              Chưa có insight trong Qdrant — streaming processor cần flush insight job.
            </p>
          ) : (
            <ul className="insight-list">
              {insights.data.insights.map((item, i) => (
                <li key={`${item.insight_type}-${i}`} className="insight-list__item">
                  <div className="insight-list__meta">
                    <span className="badge ok">{item.insight_type || "insight"}</span>
                    {item.created_at && (
                      <span className="insight-list__time">{fmtTime(item.created_at)}</span>
                    )}
                  </div>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
