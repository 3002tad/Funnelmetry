import { useCallback, useMemo, useState } from "react";
import { BarChartH } from "../components/charts/SimpleBarChart.jsx";
import { BarCell, DataPanel, EmptyState, PageLoading, RankBadge } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

function fmt(v) { return Number(v || 0).toLocaleString(); }
function money(v) { return `${Number(v || 0).toLocaleString("vi-VN")} ₫`; }

const TOP_N = 8;

export function ProductsPage() {
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.productsTop(minutes), [minutes]);
  const anomFetcher = useCallback(() => api.productsAnomalies(minutes), [minutes]);
  const top = useAutoRefresh(topFetcher, 60000);
  const anom = useAutoRefresh(anomFetcher, 60000);
  useOnKpiUpdate(useCallback(() => { top.refresh(); anom.refresh(); }, [top.refresh, anom.refresh]));

  const products = top.data?.products || [];

  const maxViews = useMemo(
    () => Math.max(...products.map((p) => Number(p.views)), 1),
    [products]
  );

  const chartViews = useMemo(
    () => products.slice(0, TOP_N).map((p) => ({
      name: (p.product_name || p.product_id).slice(0, 18),
      value: Number(p.views),
    })),
    [products]
  );

  const chartRevenue = useMemo(
    () => [...products]
      .sort((a, b) => Number(b.revenue) - Number(a.revenue))
      .slice(0, TOP_N)
      .map((p) => ({
        name: (p.product_name || p.product_id).slice(0, 18),
        value: Number(p.revenue),
      })),
    [products]
  );

  return (
    <>
      <PageHeader
        title="Sản phẩm"
        subtitle="Phân tích hiệu suất từng SKU — lượt xem, giỏ hàng, chuyển đổi và doanh thu"
        minutes={minutes}
        onMinutesChange={setMinutes}
      />
      <div className="mgr-content">
        {top.loading ? (
          <PageLoading />
        ) : products.length === 0 ? (
          <DataPanel title="Top sản phẩm"><EmptyState /></DataPanel>
        ) : (
          <>
            <div className="mgr-cols-2">
              <DataPanel title="Top lượt xem" subtitle={`${TOP_N} SKU có traffic cao nhất`}>
                <div className="data-panel__body data-panel__body--chart">
                  <BarChartH data={chartViews} color="#53389e" height={280} />
                </div>
              </DataPanel>
              <DataPanel title="Top doanh thu" subtitle={`${TOP_N} SKU đóng góp doanh thu nhiều nhất`}>
                <div className="data-panel__body data-panel__body--chart">
                  <BarChartH data={chartRevenue} color="#f54e00" height={280} />
                </div>
              </DataPanel>
            </div>

            <DataPanel
              title="Bảng chi tiết"
              subtitle="Xếp hạng theo traffic trong khoảng thời gian đã chọn"
            >
              <div className="data-panel__body--flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 48 }}>#</th>
                      <th>Sản phẩm</th>
                      <th>Giá</th>
                      <th>Lượt xem</th>
                      <th>Giỏ</th>
                      <th>Mua</th>
                      <th>Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={p.product_id}>
                        <td><RankBadge rank={i + 1} /></td>
                        <td>
                          <div className="product-cell">
                            <strong>{p.product_name}</strong>
                            <span>{p.product_id}</span>
                          </div>
                        </td>
                        <td>{money(p.unit_price)}</td>
                        <td><BarCell value={p.views} max={maxViews} color="#53389e" /></td>
                        <td>{fmt(p.add_to_cart)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(p.purchases)}</td>
                        <td style={{ fontWeight: 700, color: "var(--accent)" }}>{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataPanel>
          </>
        )}

        <DataPanel
          title="Cần tối ưu"
          subtitle="Nhiều lượt xem nhưng không có đơn mua — ưu tiên cải thiện giá, ảnh, mô tả"
          action={<span className="badge down">Anomaly</span>}
        >
          <div className="data-panel__body--flush">
            {anom.loading ? <PageLoading /> : !(anom.data?.anomalies || []).length ? (
              <EmptyState message="Không phát hiện sản phẩm high-view / zero-purchase." />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>Views</th>
                    <th>Giỏ</th>
                    <th>Mua</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {anom.data.anomalies.map((p) => (
                    <tr key={p.product_id}>
                      <td>
                        <div className="product-cell">
                          <strong>{p.product_name || p.product_id}</strong>
                          <span>{p.product_id}</span>
                        </div>
                      </td>
                      <td><BarCell value={p.views} max={maxViews} color="#b91c1c" /></td>
                      <td>{fmt(p.add_to_cart)}</td>
                      <td style={{ color: "var(--danger)", fontWeight: 800 }}>0</td>
                      <td><span className="badge down">Cần xem xét</span></td>
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
