import { useCallback, useMemo, useState } from "react";
import { BarChartH } from "../components/charts/SimpleBarChart.jsx";
import { FilterUsageTable } from "../components/FilterUsageTable.jsx";
import { SearchQueryTable } from "../components/SearchQueryTable.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconSearch } from "../components/icons.jsx";
import { StatHero } from "../components/StatCard.jsx";
import { buildSearchActionItems, buildSearchSummary } from "../lib/searchMetrics.js";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

const TOP_N = 10;
const LIMIT = 20;

export function SearchPage() {
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.searchTop(minutes, LIMIT), [minutes]);
  const filterFetcher = useCallback(() => api.searchFilters(minutes), [minutes]);
  const overviewFetcher = useCallback(() => api.overview(minutes), [minutes]);

  const top = useAutoRefresh(topFetcher, 60000);
  const filters = useAutoRefresh(filterFetcher, 60000);
  const overview = useAutoRefresh(overviewFetcher, 60000);

  useOnKpiUpdate(useCallback(() => {
    top.refresh();
    filters.refresh();
    overview.refresh();
  }, [top.refresh, filters.refresh, overview.refresh]));

  const searches = top.data?.searches || [];
  const filterRows = filters.data?.filters || [];

  const summary = useMemo(
    () => buildSearchSummary(searches, filterRows),
    [searches, filterRows]
  );

  const actionItems = useMemo(
    () => buildSearchActionItems(summary),
    [summary]
  );

  const queryChart = useMemo(
    () => searches.slice(0, TOP_N).map((r) => ({
      name: (r.query || "—").slice(0, 22),
      value: Number(r.searches),
    })),
    [searches]
  );

  const filterChart = useMemo(
    () => filterRows.slice(0, TOP_N).map((r) => ({
      name: `${r.category || "all"} · ${r.sort_mode || "default"}`.slice(0, 22),
      value: Number(r.filter_events),
    })),
    [filterRows]
  );

  const sparkSearches = useMemo(
    () => (overview.data?.trend || []).map((r) => Number(r.searches || 0)),
    [overview.data]
  );

  const loading = top.loading && !top.data;
  const hasData = searches.length > 0 || filterRows.length > 0;

  if (loading) {
    return (
      <>
        <PageHeader title="Tìm kiếm & Bộ lọc" minutes={minutes} onMinutesChange={setMinutes} live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Tìm kiếm & Bộ lọc"
        subtitle="Merchandising insight — từ khóa và hành vi lọc sản phẩm"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={() => { top.refresh(); filters.refresh(); overview.refresh(); }}
        lastUpdated={top.lastUpdated}
      />
      <div className="mgr-content">
        {top.error ? <PageError message={top.error} /> : null}
        {filters.error ? <PageError message={filters.error} /> : null}

        {!hasData ? (
          <DataPanel title="Tìm kiếm"><EmptyState message="Chưa có dữ liệu search/filter trong kỳ." /></DataPanel>
        ) : (
          <>
            <div className="stat-hero-row stat-hero-row--funnel">
              <StatHero
                tone="purple"
                icon={IconSearch}
                label="Tổng lượt search"
                value={summary.totalSearches.toLocaleString("vi-VN")}
                sub={`${summary.uniqueQueries} từ khóa`}
                sparkline={sparkSearches}
              />
              <StatHero
                tone="primary"
                label="Lượt dùng bộ lọc"
                value={summary.totalFilters.toLocaleString("vi-VN")}
                sub={summary.topFilter
                  ? `${summary.topFilter.category || "all"} / ${summary.topFilter.sort_mode || "default"}`
                  : "—"}
              />
              <StatHero
                tone="success"
                label="Top query"
                value={(summary.topQuery?.query || "—").slice(0, 28)}
                sub={summary.topQuery
                  ? `${Number(summary.topQuery.searches).toLocaleString("vi-VN")} lượt`
                  : "—"}
              />
            </div>

            <div className="overview-main-grid">
              <DataPanel title="Bảng từ khóa" subtitle={`Top ${LIMIT} query theo lượt tìm`}>
                <div className="data-panel__body data-panel__body--flush">
                  {searches.length > 0 ? (
                    <SearchQueryTable searches={searches} />
                  ) : (
                    <div className="data-panel__body"><EmptyState message="Chưa có search query." /></div>
                  )}
                </div>
              </DataPanel>

              <div className="overview-right-stack">
                <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý merchandising trong kỳ">
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
                {queryChart.length > 0 && (
                  <DataPanel title="Top query (chart)" subtitle={`${TOP_N} từ khóa`}>
                    <div className="data-panel__body data-panel__body--chart">
                      <BarChartH data={queryChart} color="#53389e" height={200} />
                    </div>
                  </DataPanel>
                )}
              </div>
            </div>

            <div className="overview-main-grid">
              <DataPanel title="Bảng bộ lọc" subtitle="Category × sort — tần suất sử dụng">
                <div className="data-panel__body data-panel__body--flush">
                  {filterRows.length > 0 ? (
                    <FilterUsageTable filters={filterRows} />
                  ) : (
                    <div className="data-panel__body"><EmptyState message="Chưa có filter_apply." /></div>
                  )}
                </div>
              </DataPanel>

              {filterChart.length > 0 && (
                <DataPanel title="Top bộ lọc (chart)" subtitle="Combo category / sort">
                  <div className="data-panel__body data-panel__body--chart">
                    <BarChartH data={filterChart} color="#f54e00" height={240} />
                  </div>
                </DataPanel>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
