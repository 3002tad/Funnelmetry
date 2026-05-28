import { useCallback, useMemo, useState } from "react";
import { DonutBreakdown } from "../components/charts/DonutBreakdown.jsx";
import { EventTypeTable } from "../components/EventTypeTable.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconEvents } from "../components/icons.jsx";
import { StatHero } from "../components/StatCard.jsx";
import {
  buildEventActionItems,
  buildEventSummary,
  buildEventTypeRows,
} from "../lib/eventMetrics.js";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnLiveEvent } from "../context/LiveStreamContext.jsx";

const MAX_EVENTS = 200;

export function EventsPage() {
  const overviewFetcher = useCallback(() => api.overview(60), []);
  const fetcher = useCallback(() => api.events(50), []);
  const { data, loading, error, refresh, lastUpdated } = useAutoRefresh(fetcher, 30000);
  const overview = useAutoRefresh(overviewFetcher, 60000);

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

  const typeRows = useMemo(() => buildEventTypeRows(allEvents), [allEvents]);

  const typeBreakdown = useMemo(
    () => typeRows.map((r) => ({ name: r.label, value: r.count })),
    [typeRows]
  );

  const summary = useMemo(
    () => buildEventSummary(allEvents, typeRows),
    [allEvents, typeRows]
  );

  const actionItems = useMemo(
    () => buildEventActionItems(summary),
    [summary]
  );

  const sparkEvents = useMemo(
    () => (overview.data?.trend || []).map((r) => Number(r.total_events || 0)),
    [overview.data]
  );

  const totalTypes = typeBreakdown.reduce((s, d) => s + d.value, 0);

  if (loading && !data && liveEvents.length === 0) {
    return (
      <>
        <PageHeader title="Sự kiện" live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error && allEvents.length === 0) {
    return (
      <>
        <PageHeader title="Sự kiện" onRefresh={refresh} live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sự kiện"
        subtitle="Luồng tracking thời gian thực — phân bổ loại event và stream"
        onRefresh={refresh}
        lastUpdated={lastUpdated}
      />
      <div className="mgr-content">
        <div className="stat-hero-row stat-hero-row--funnel">
          <StatHero
            tone="purple"
            icon={IconEvents}
            label="Event (buffer)"
            value={summary.total.toLocaleString("vi-VN")}
            sub={`${summary.typeCount} loại`}
            sparkline={sparkEvents}
          />
          <StatHero
            tone="primary"
            label="Commerce"
            value={summary.commerce.toLocaleString("vi-VN")}
            sub="Event giao dịch"
          />
          <StatHero
            tone="success"
            label="Behavior"
            value={summary.behavior.toLocaleString("vi-VN")}
            sub={`~${summary.uniqueSessions} phiên`}
          />
        </div>

        <div className="overview-main-grid">
          <DataPanel
            title="Phân bổ loại event"
            subtitle="Bảng BI theo event_type trong buffer hiện tại"
          >
            <div className="data-panel__body data-panel__body--flush">
              {typeRows.length > 0 ? (
                <EventTypeTable rows={typeRows} />
              ) : (
                <div className="data-panel__body">
                  <EmptyState message="Chưa có event — thao tác trên web demo." />
                </div>
              )}
            </div>
          </DataPanel>

          <div className="overview-right-stack">
            <DataPanel title="Ưu tiên quan sát" subtitle="Gợi ý khi đọc luồng realtime">
              <div className="action-list">
                {actionItems.map((item) => (
                  <div key={item.key} className={`action-card ${item.level}`}>
                    <span className="action-card__title">{item.title}</span>
                    <strong className="action-card__value">{item.value}</strong>
                    <span className="action-card__hint">{item.hint}</span>
                  </div>
                ))}
              </div>
            </DataPanel>

            {typeBreakdown.length > 0 && (
              <DataPanel title="Donut phân bổ" subtitle="Tỷ trọng trực quan">
                <div className="data-panel__body">
                  <DonutBreakdown
                    data={typeBreakdown}
                    height={200}
                    centerLabel={String(totalTypes)}
                    centerSub="Events"
                  />
                </div>
              </DataPanel>
            )}
          </div>
        </div>

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
          <div className="data-panel__body--flush event-stream-wrap">
            {allEvents.length === 0 ? (
              <div className="data-panel__body">
                <EmptyState message="Chưa có event nào — hãy thao tác trên web demo." />
              </div>
            ) : (
              <table className="data-table data-table--stream">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Loại</th>
                    <th>Category</th>
                    <th>Session</th>
                  </tr>
                </thead>
                <tbody>
                  {allEvents.slice(0, 80).map((e) => (
                    <tr key={e.event_id}>
                      <td className="event-stream__time">
                        {new Date(e.event_time).toLocaleString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td>
                        <code className="event-code">{e.event_type}</code>
                      </td>
                      <td>
                        <span className={`badge ${e.event_category === "commerce" ? "commerce" : "behavior"}`}>
                          {e.event_category}
                        </span>
                      </td>
                      <td className="event-stream__session">
                        {e.session_id?.slice(0, 14)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DataPanel>
      </div>
    </>
  );
}
