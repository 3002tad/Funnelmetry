import { useCallback, useMemo, useState } from "react";
import { DonutBreakdown } from "../components/charts/DonutBreakdown.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnLiveEvent } from "../context/LiveStreamContext.jsx";

const MAX_EVENTS = 200;

export function EventsPage() {
  // Initial load via REST; fallback polling at 30s (SSE handles the fast path).
  const fetcher = useCallback(() => api.events(50), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 30000);

  // Live events prepended on top as they arrive via SSE.
  const [liveEvents, setLiveEvents] = useState([]);

  useOnLiveEvent(useCallback((rows) => {
    setLiveEvents((prev) => {
      const merged = [...rows.slice().reverse(), ...prev];
      const seen = new Set();
      return merged.filter((e) => {
        if (seen.has(e.event_id)) return false;
        seen.add(e.event_id);
        return true;
      }).slice(0, MAX_EVENTS);
    });
  }, []));

  const allEvents = useMemo(() => {
    const base = data?.events || [];
    if (liveEvents.length === 0) return base;
    const seen = new Set(liveEvents.map((e) => e.event_id));
    const deduped = [...liveEvents, ...base.filter((e) => !seen.has(e.event_id))];
    return deduped.slice(0, MAX_EVENTS);
  }, [data, liveEvents]);

  const typeBreakdown = useMemo(() => {
    const counts = {};
    for (const e of allEvents) {
      const t = e.event_type || "unknown";
      counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [allEvents]);

  const totalTypes = typeBreakdown.reduce((s, d) => s + d.value, 0);

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Events" live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error && allEvents.length === 0) {
    return (
      <>
        <PageHeader title="Events" onRefresh={refresh} live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  const statusLabel = "Push realtime";

  return (
    <>
      <PageHeader
        title="Events"
        subtitle={`Luồng sự kiện tracking — ${statusLabel}`}
        onRefresh={refresh}
      />
      <div className="mgr-content">
        <div className="mgr-cols-2">
          {typeBreakdown.length > 0 && (
            <DataPanel
              title="Phân bổ loại event"
              subtitle={`Tỷ lệ event_type trong ${allEvents.length} bản ghi`}
            >
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
            subtitle={`${allEvents.length} sự kiện gần nhất`}
            action={
              <span className="live-badge">
                <span className="live-badge__dot" />
                Live
              </span>
            }
          >
            <div className="data-panel__body--flush" style={{ maxHeight: 420, overflow: "auto" }}>
              {allEvents.length === 0 ? (
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
                    {allEvents.slice(0, 50).map((e) => (
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
