import { useCallback, useMemo, useState } from "react";
import { BarChartH } from "../components/charts/SimpleBarChart.jsx";
import { ProductPerformanceTable } from "../components/ProductPerformanceTable.jsx";
import { BarCell, DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconProducts, IconRevenue } from "../components/icons.jsx";
import { ActionCardValue } from "../components/MoneyText.jsx";
import { StatHero } from "../components/StatCard.jsx";
import { buildProductActionItems, buildProductSummary } from "../lib/productMetrics.js";
import { api } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

function fmt(v) { return Number(v || 0).toLocaleString("vi-VN"); }

const TOP_N = 8;
const TABLE_LIMIT = 10;

function skuChartLabel(p, maxLen = 28) {
  const name = String(p.product_name || p.product_id || "").trim();
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}…` : name;
}

export function ProductsPage() {
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.productsTop(minutes, TABLE_LIMIT), [minutes]);
  const anomFetcher = useCallback(() => api.productsAnomalies(minutes), [minutes]);
  const overviewFetcher = useCallback(() => api.overview(minutes), [minutes]);

  const top = useAutoRefresh(topFetcher, 60000);
  const anom = useAutoRefresh(anomFetcher, 60000);
  const overview = useAutoRefresh(overviewFetcher, 60000);

  useOnKpiUpdate(useCallback(() => {
    top.refresh();
    anom.refresh();
    overview.refresh();
  }, [top.refresh, anom.refresh, overview.refresh]));

  const products = top.data?.products || [];
  const anomalies = anom.data?.anomalies || [];

  const anomalyIds = useMemo(
    () => new Set(anomalies.map((p) => p.product_id)),
    [anomalies]
  );

  const summary = useMemo(
    () => buildProductSummary(products, anomalies),
    [products, anomalies]
  );

  const actionItems = useMemo(
    () => buildProductActionItems(summary, anomalies),
    [summary, anomalies]
  );

  const chartViews = useMemo(
    () => products.slice(0, TOP_N).map((p) => ({
      name: skuChartLabel(p),
      value: Number(p.views),
    })),
    [products]
  );

  const chartRevenue = useMemo(
    () => [...products]
      .sort((a, b) => Number(b.revenue) - Number(a.revenue))
      .slice(0, TOP_N)
      .map((p) => ({
        name: skuChartLabel(p),
        value: Number(p.revenue),
      })),
    [products]
  );

  const sparkProductViews = useMemo(
    () => (overview.data?.trend || []).map((r) => Number(r.product_views || 0)),
    [overview.data]
  );
  const sparkPurchases = useMemo(
    () => (overview.data?.trend || []).map((r) => Number(r.purchases || 0)),
    [overview.data]
  );

  const maxAnomViews = useMemo(
    () => Math.max(...anomalies.map((p) => Number(p.views)), 1),
    [anomalies]
  );

  const loading = top.loading && !top.data;
  const error = top.error;

  if (loading) {
    return (
      <>
        <PageHeader title="Sản phẩm" minutes={minutes} onMinutesChange={setMinutes} live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sản phẩm"
        subtitle="Phân tích SKU — traffic, conversion view→mua và doanh thu theo kỳ"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={() => { top.refresh(); anom.refresh(); overview.refresh(); }}
        lastUpdated={top.lastUpdated}
      />
      <div className="mgr-content">
        {error ? <PageError message={error} /> : null}
        {anom.error ? <PageError message={anom.error} /> : null}

        {products.length === 0 ? (
          <DataPanel title="Top sản phẩm"><EmptyState /></DataPanel>
        ) : (
          <>
            <div className="stat-hero-row stat-hero-row--funnel">
              <StatHero
                tone="purple"
                icon={IconProducts}
                label="Tổng lượt xem SP"
                value={fmt(summary.totalViews)}
                sub={`${summary.skuCount} SKU · top list`}
                sparkline={sparkProductViews}
              />
              <StatHero
                tone="primary"
                icon={IconRevenue}
                label="Doanh thu (top list)"
                value={formatMoney(summary.totalRevenue)}
                sub={`${fmt(summary.totalPurchases)} đơn mua`}
                sparkline={sparkPurchases}
              />
              <StatHero
                tone="success"
                label="Conversion TB"
                value={`${summary.avgConvPct.toFixed(2)}%`}
                sub={`Giỏ: ${summary.cartRatePct.toFixed(1)}% view→cart`}
              />
            </div>

            <div className="overview-main-grid">
              <DataPanel
                title="Bảng hiệu suất SKU"
                subtitle="Top 10 theo lượt xem — conversion và doanh thu"
              >
                <div className="data-panel__body data-panel__body--flush">
                  <ProductPerformanceTable
                    products={products}
                    anomaliesIds={anomalyIds}
                  />
                </div>
              </DataPanel>

              <div className="overview-right-stack">
                <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý tối ưu catalog trong kỳ này">
                  <div className="action-list">
                    {actionItems.map((item) => (
                      <div key={item.key} className={`action-card ${item.level}`}>
                        <span className="action-card__title">{item.title}</span>
                        <ActionCardValue value={item.value} />
                        <span className="action-card__hint">{item.hint}</span>
                      </div>
                    ))}
                  </div>
                </DataPanel>

                <DataPanel title="Top lượt xem" subtitle={`${TOP_N} SKU traffic cao`}>
                  <div className="data-panel__body data-panel__body--chart">
                    <BarChartH data={chartViews} color="#53389e" height={220} />
                  </div>
                </DataPanel>
              </div>
            </div>

            <div className="mgr-cols-2">
              <DataPanel title="Top doanh thu" subtitle={`${TOP_N} SKU đóng góp nhiều nhất`}>
                <div className="data-panel__body data-panel__body--chart">
                  <BarChartH
                    data={chartRevenue}
                    color="#f54e00"
                    height={260}
                    dataKey="value"
                  />
                </div>
              </DataPanel>

              <DataPanel
                title="High view · Zero purchase"
                subtitle="Anomaly — nhiều xem, không có đơn"
                action={
                  anomalies.length > 0 ? (
                    <span className="badge down">{anomalies.length} SKU</span>
                  ) : null
                }
              >
                <div className="data-panel__body--flush">
                  {anom.loading ? (
                    <PageLoading />
                  ) : anomalies.length === 0 ? (
                    <div className="data-panel__body">
                      <EmptyState message="Không có SKU high-view / zero-purchase trong kỳ." />
                    </div>
                  ) : (
                    <table className="data-table data-table--compact">
                      <thead>
                        <tr>
                          <th>Sản phẩm</th>
                          <th>Views</th>
                          <th>Giỏ</th>
                          <th>Mua</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalies.map((p) => (
                          <tr key={p.product_id}>
                            <td>
                              <div className="product-cell">
                                <strong>{p.product_name || p.product_id}</strong>
                                <span>{p.product_id}</span>
                              </div>
                            </td>
                            <td>
                              <BarCell value={p.views} max={maxAnomViews} color="#b91c1c" />
                            </td>
                            <td>{fmt(p.add_to_cart)}</td>
                            <td className="bi-product__zero">0</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </DataPanel>
            </div>
          </>
        )}
      </div>
    </>
  );
}
