import { useCallback, useMemo, useState } from "react";
import { BarChartGrouped } from "../components/charts/SimpleBarChart.jsx";
import { BarCell, DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

export function BannersPage() {
  const [minutes, setMinutes] = useState(60);
  const fetcher = useCallback(() => api.banners(minutes), [minutes]);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 60000);
  useOnKpiUpdate(useCallback(() => refresh(), [refresh]));

  const banners = data?.banners || [];
  const maxImp = Math.max(...banners.map((b) => Number(b.impressions)), 1);

  const chartData = useMemo(
    () => banners.map((b) => ({
      name: String(b.banner_id).slice(0, 14),
      impressions: Number(b.impressions),
      clicks: Number(b.clicks),
    })),
    [banners]
  );

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Banners" minutes={minutes} onMinutesChange={setMinutes} live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Banners" live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Banners"
        subtitle="Đo lường impression, click và CTR từng banner quảng cáo"
        minutes={minutes}
        onMinutesChange={setMinutes}
      />
      <div className="mgr-content">
        {banners.length === 0 ? (
          <DataPanel title="Hiệu suất banner">
            <EmptyState message="Chưa có dữ liệu banner — cần event banner_impression / banner_click." />
          </DataPanel>
        ) : (
          <>
            <DataPanel title="Impressions vs Clicks" subtitle="So sánh trực quan từng banner">
              <div className="data-panel__body data-panel__body--chart">
                <BarChartGrouped
                  data={chartData}
                  keys={[
                    { key: "impressions", label: "Impressions" },
                    { key: "clicks", label: "Clicks" },
                  ]}
                  height={280}
                />
              </div>
            </DataPanel>

            <DataPanel title="Bảng chi tiết" subtitle="CTR = clicks / impressions">
              <div className="data-panel__body--flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Banner</th>
                      <th>Impressions</th>
                      <th>Clicks</th>
                      <th>CTR</th>
                      <th>Đánh giá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {banners.map((b) => {
                      const ctr = Number(b.ctr) * 100;
                      const badge =
                        ctr >= 3 ? "ok" : ctr >= 1 ? "degraded" : "down";
                      const label = ctr >= 3 ? "Tốt" : ctr >= 1 ? "Trung bình" : "Thấp";
                      return (
                        <tr key={b.banner_id}>
                          <td><strong>{b.banner_id}</strong></td>
                          <td><BarCell value={b.impressions} max={maxImp} color="#53389e" /></td>
                          <td>{Number(b.clicks).toLocaleString()}</td>
                          <td>
                            <strong style={{
                              color: ctr >= 3 ? "var(--success)" : ctr >= 1 ? "var(--warning)" : "var(--danger)",
                            }}>
                              {ctr.toFixed(2)}%
                            </strong>
                          </td>
                          <td><span className={`badge ${badge}`}>{label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DataPanel>
          </>
        )}
      </div>
    </>
  );
}
