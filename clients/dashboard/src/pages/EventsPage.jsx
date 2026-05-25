import { useCallback, useMemo } from "react";
import { DonutBreakdown } from "../components/charts/DonutBreakdown.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function EventsPage() {
  const fetcher = useCallback(() => api.events(100), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 8000);

  const typeBreakdown = useMemo(() => {
    const counts = {};
    for (const e of data?.events || []) {
      const t = e.event_type || "unknown";
      counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [data]);

  const totalTypes = typeBreakdown.reduce((s, d) => s + d.value, 0);

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Events" live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Events" onRefresh={refresh} live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  const events = data?.events || [];

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Luồng sự kiện tracking realtime — tự làm mới mỗi 8 giây"
        onRefresh={refresh}
      />
      <div className="mgr-content">
        <div className="mgr-cols-2">
          {typeBreakdown.length > 0 && (
            <DataPanel title="Phân bổ loại event" subtitle="Tỷ lệ event_type trong 100 bản ghi gần nhất">
              <div className="data-panel__body">
                <DonutBreakdown
                  data={typeBreakdown}
                  height={220}
                  centerLabel={String(totalTypes)}
                />
              </div>
            </DataPanel>
          )}

          <DataPanel
            title="Event stream"
            subtitle={`${events.length} sự kiện gần nhất`}
            action={<span className="live-badge"><span className="live-badge__dot" />Live</span>}
          >
            <div className="data-panel__body--flush" style={{ maxHeight: 420, overflow: "auto" }}>
              {events.length === 0 ? (
                <EmptyState message="Chưa có event nào — hãy thao tác trên web demo." />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Loại</th>
                      <th>Category</th>
                      <th>Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 24).map((e) => (
                      <tr key={e.event_id}>
                        <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                          {new Date(e.event_time).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td>
                          <code style={{ fontSize: "0.78rem", background: "var(--surface-3)", padding: "0.15rem 0.4rem", borderRadius: 4 }}>
                            {e.event_type}
                          </code>
                        </td>
                        <td>
                          <span className={`badge ${e.event_category === "commerce" ? "commerce" : "behavior"}`}>
                            {e.event_category}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>
                          {e.session_id?.slice(0, 12)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DataPanel>
        </div>
      </div>
    </>
  );
}
