import { useCallback, useMemo, useState } from "react";
import { BarChartGrouped } from "../components/charts/SimpleBarChart.jsx";
import { BannerPerformanceTable } from "../components/BannerPerformanceTable.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconBanner } from "../components/icons.jsx";
import { StatHero } from "../components/StatCard.jsx";
import { buildBannerActionItems, buildBannerSummary } from "../lib/bannerMetrics.js";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

export function BannersPage() {
  const [minutes, setMinutes] = useState(60);
  const fetcher = useCallback(() => api.banners(minutes), [minutes]);
  const overviewFetcher = useCallback(() => api.overview(minutes), [minutes]);
  const { data, loading, error, refresh, lastUpdated } = useAutoRefresh(fetcher, 60000);
  const overview = useAutoRefresh(overviewFetcher, 60000);

  useOnKpiUpdate(useCallback(() => {
    refresh();
    overview.refresh();
  }, [refresh, overview.refresh]));

  const banners = data?.banners || [];

  const summary = useMemo(() => buildBannerSummary(banners), [banners]);
  const actionItems = useMemo(() => buildBannerActionItems(summary), [summary]);

  const chartData = useMemo(
    () => banners.map((b) => ({
      name: String(b.banner_id).slice(0, 14),
      impressions: Number(b.impressions),
      clicks: Number(b.clicks),
    })),
    [banners]
  );

  const sparkClicks = useMemo(
    () => (overview.data?.trend || []).map((r) => Number(r.clicks || 0)),
    [overview.data]
  );

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Banner" minutes={minutes} onMinutesChange={setMinutes} live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Banner" live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Banner"
        subtitle="Hiệu suất quảng cáo — impressions, clicks và CTR theo banner"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={() => { refresh(); overview.refresh(); }}
        lastUpdated={lastUpdated}
      />
      <div className="mgr-content">
        {banners.length === 0 ? (
          <DataPanel title="Hiệu suất banner">
            <EmptyState message="Chưa có dữ liệu banner — cần event banner_impression / banner_click." />
          </DataPanel>
        ) : (
          <>
            <div className="stat-hero-row stat-hero-row--funnel">
              <StatHero
                tone="purple"
                icon={IconBanner}
                label="Impressions"
                value={summary.totalImpressions.toLocaleString("vi-VN")}
                sub={`${summary.bannerCount} banner`}
              />
              <StatHero
                tone="primary"
                label="Clicks"
                value={summary.totalClicks.toLocaleString("vi-VN")}
                sub="Tổng nhấp"
                sparkline={sparkClicks}
              />
              <StatHero
                tone="success"
                label="CTR trung bình"
                value={`${summary.avgCtrPct.toFixed(2)}%`}
                sub={summary.best
                  ? `Tốt nhất: ${summary.best.banner_id} (${(Number(summary.best.ctr) * 100).toFixed(2)}%)`
                  : "—"}
              />
            </div>

            <div className="overview-main-grid">
              <DataPanel title="Bảng hiệu suất banner" subtitle="CTR và volume impression từng banner">
                <div className="data-panel__body data-panel__body--flush">
                  <BannerPerformanceTable banners={banners} />
                </div>
              </DataPanel>

              <div className="overview-right-stack">
                <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý tối ưu creative & placement">
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
              </div>
            </div>

            <DataPanel title="Impressions vs Clicks" subtitle="So sánh trực quan từng banner">
              <div className="data-panel__body data-panel__body--chart">
                <BarChartGrouped
                  data={chartData}
                  keys={[
                    { key: "impressions", label: "Impressions" },
                    { key: "clicks", label: "Clicks" },
                  ]}
                  height={300}
                />
              </div>
            </DataPanel>
          </>
        )}
      </div>
    </>
  );
}
