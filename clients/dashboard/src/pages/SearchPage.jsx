import { useCallback, useMemo, useState } from "react";
import { BarChartH } from "../components/charts/SimpleBarChart.jsx";
import { DataPanel, EmptyState, PageLoading, RankBadge } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const TOP_N = 10;

export function SearchPage() {
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.searchTop(minutes), [minutes]);
  const filterFetcher = useCallback(() => api.searchFilters(minutes), [minutes]);
  const top = useAutoRefresh(topFetcher);
  const filters = useAutoRefresh(filterFetcher);

  const queryChart = useMemo(
    () => (top.data?.searches || []).slice(0, TOP_N).map((r) => ({
      name: (r.query || "—").slice(0, 22),
      value: Number(r.searches),
    })),
    [top.data]
  );

  const filterChart = useMemo(
    () => (filters.data?.filters || []).slice(0, TOP_N).map((r, i) => ({
      name: `${r.category || "all"} · ${r.sort_mode || "default"}`.slice(0, 22),
      value: Number(r.filter_events),
    })),
    [filters.data]
  );

  return (
    <>
      <PageHeader
        title="Tìm kiếm & Bộ lọc"
        subtitle="Khách hàng tìm gì và dùng filter như thế nào trên cửa hàng"
        minutes={minutes}
        onMinutesChange={setMinutes}
      />
      <div className="mgr-content">
        <div className="mgr-cols-2">
          <DataPanel title="Từ khóa phổ biến" subtitle="Top search queries">
            <div className="chart-panel-split">
              {!top.loading && queryChart.length > 0 && (
                <div className="data-panel__body data-panel__body--chart">
                  <BarChartH data={queryChart} color="#53389e" height={220} />
                </div>
              )}
              <div className="data-panel__body--flush">
                {top.loading ? <PageLoading /> : !(top.data?.searches || []).length ? (
                  <EmptyState />
                ) : (
                  <table className="data-table">
                    <thead><tr><th>#</th><th>Query</th><th>Lượt</th></tr></thead>
                    <tbody>
                      {top.data.searches.map((r, i) => (
                        <tr key={r.query}>
                          <td><RankBadge rank={i + 1} /></td>
                          <td><strong>{r.query}</strong></td>
                          <td>{r.searches}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </DataPanel>

          <DataPanel title="Bộ lọc" subtitle="Category & sort được dùng nhiều">
            <div className="chart-panel-split">
              {!filters.loading && filterChart.length > 0 && (
                <div className="data-panel__body data-panel__body--chart">
                  <BarChartH data={filterChart} color="#f54e00" height={220} />
                </div>
              )}
              <div className="data-panel__body--flush">
                {filters.loading ? <PageLoading /> : !(filters.data?.filters || []).length ? (
                  <EmptyState />
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Danh mục</th><th>Sắp xếp</th><th>Lượt</th></tr></thead>
                    <tbody>
                      {filters.data.filters.map((r, i) => (
                        <tr key={i}>
                          <td>{r.category || "—"}</td>
                          <td>{r.sort_mode || "—"}</td>
                          <td>{r.filter_events}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </DataPanel>
        </div>
      </div>
    </>
  );
}
