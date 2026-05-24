import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { theme } from "../lib/theme.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

function TopTable({ products, variant }) {
  const shop = variant === "shop";
  if (!products?.length) return <p className="empty">Chưa có dữ liệu.</p>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Sản phẩm</th>
          <th>Giá</th>
          {!shop && <th>Clicks</th>}
          <th>Lượt xem</th>
          <th>Giỏ hàng</th>
          <th>Đã mua</th>
          <th>Doanh thu</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.product_id}>
            <td>
              <strong>{p.product_name}</strong>
              <br />
              <span className="muted" style={{ fontSize: "0.75rem" }}>{p.product_id}</span>
            </td>
            <td>{Number(p.unit_price).toLocaleString("vi-VN")} ₫</td>
            {!shop && <td>{Number(p.clicks).toLocaleString()}</td>}
            <td>{Number(p.views).toLocaleString()}</td>
            <td>{Number(p.add_to_cart).toLocaleString()}</td>
            <td>{Number(p.purchases).toLocaleString()}</td>
            <td>{Number(p.revenue).toLocaleString("vi-VN")} ₫</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProductsPage({ variant = "admin" }) {
  const t = theme(variant);
  const [minutes, setMinutes] = useState(60);
  const topFetcher = useCallback(() => api.productsTop(minutes), [minutes]);
  const anomFetcher = useCallback(() => api.productsAnomalies(minutes), [minutes]);
  const top = useAutoRefresh(topFetcher);
  const anom = useAutoRefresh(anomFetcher, variant === "admin" ? 15000 : 0);

  return (
    <>
      <PageHeader
        variant={variant}
        title={variant === "shop" ? "Sản phẩm" : "Products"}
        subtitle={variant === "shop" ? "Hiệu suất bán hàng theo từng SKU" : undefined}
        minutes={minutes}
        onMinutesChange={setMinutes}
      />

      <div className={t.panel}>
        <h3>{variant === "shop" ? "Bán chạy nhất" : "Top Products by Views"}</h3>
        {top.loading ? <p className="empty">Đang tải…</p> : <TopTable products={top.data?.products} variant={variant} />}
      </div>

      {variant === "admin" && (
        <div className={t.panel} style={{ marginTop: "1.5rem" }}>
          <h3 style={{ color: "#f87171" }}>Nhiều view · 0 mua (anomaly)</h3>
          {anom.loading ? <p className="empty">Loading…</p> : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sản phẩm</th><th>Views</th><th>Giỏ</th><th>Mua</th>
                </tr>
              </thead>
              <tbody>
                {(anom.data?.anomalies || []).map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.product_name || p.product_id}</td>
                    <td>{p.views}</td>
                    <td>{p.add_to_cart}</td>
                    <td style={{ color: "#f87171" }}>{p.purchases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
