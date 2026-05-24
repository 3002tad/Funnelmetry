import { useCallback } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function EventsPage() {
  const fetcher = useCallback(() => api.events(80), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 10000);

  if (loading) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  return (
    <>
      <PageHeader title="Events" subtitle="Raw events gần nhất" onRefresh={refresh} />
      <div className="admin-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Session</th>
              <th>Trang / SP</th>
            </tr>
          </thead>
          <tbody>
            {(data?.events || []).map((e) => (
              <tr key={e.event_id}>
                <td>{new Date(e.event_time).toLocaleString("vi-VN")}</td>
                <td>
                  <span className={`badge ${e.event_category === "commerce" ? "commerce" : "behavior"}`}>
                    {e.event_type}
                  </span>
                </td>
                <td style={{ fontSize: "0.75rem" }}>{e.session_id?.slice(0, 12)}…</td>
                <td>{e.product_id || e.page_url || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
