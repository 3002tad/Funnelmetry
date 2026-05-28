import { RankBadge } from "./DataPanel.jsx";

function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function money(v) {
  return `${Number(v || 0).toLocaleString("vi-VN")} ₫`;
}

function pct(rate) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

function rateClass(rate) {
  const p = Number(rate || 0) * 100;
  if (p < 0.5) return "bi-product__rate--low";
  if (p < 2) return "bi-product__rate--med";
  return "bi-product__rate--ok";
}

/**
 * BI ranking table — views, cart, purchase, conversion, revenue bar.
 */
export function ProductPerformanceTable({ products, anomaliesIds = new Set() }) {
  if (!products?.length) return null;

  const maxViews = Math.max(...products.map((p) => Number(p.views)), 1);

  return (
    <div className="bi-product">
      <div className="bi-product__summary">
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">SKU trong bảng</span>
          <strong>{products.length}</strong>
          <span className="bi-funnel__kpi-hint">Top theo lượt xem</span>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Tổng lượt xem</span>
          <strong>{fmt(products.reduce((s, p) => s + Number(p.views), 0))}</strong>
          <span className="bi-funnel__kpi-hint">Trong danh sách</span>
        </div>
        <div className="bi-funnel__kpi bi-funnel__kpi--accent">
          <span className="bi-funnel__kpi-label">Tổng doanh thu</span>
          <strong>{money(products.reduce((s, p) => s + Number(p.revenue), 0))}</strong>
          <span className="bi-funnel__kpi-hint">Top list</span>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Conv. TB (view→mua)</span>
          <strong>
            {(() => {
              const v = products.reduce((s, p) => s + Number(p.views), 0);
              const pu = products.reduce((s, p) => s + Number(p.purchases), 0);
              return v > 0 ? `${((pu / v) * 100).toFixed(2)}%` : "—";
            })()}
          </strong>
          <span className="bi-funnel__kpi-hint">Trung bình có trọng số</span>
        </div>
      </div>

      <div className="bi-product__table" role="table">
        <div className="bi-product__head" role="row">
          <span>#</span>
          <span>Sản phẩm</span>
          <span>Lượt xem</span>
          <span>Giỏ</span>
          <span>Mua</span>
          <span>View→Giỏ</span>
          <span>View→Mua</span>
          <span>Doanh thu</span>
          <span>Traffic</span>
        </div>

        {products.map((p, i) => {
          const views = Number(p.views);
          const volPct = maxViews > 0 ? (views / maxViews) * 100 : 0;
          const isAnomaly = anomaliesIds.has(p.product_id);

          return (
            <div
              key={p.product_id}
              className={`bi-product__row${isAnomaly ? " bi-product__row--warn" : ""}`}
              role="row"
            >
              <span className="bi-product__rank" role="cell">
                <RankBadge rank={i + 1} />
              </span>
              <div className="bi-product__name" role="cell">
                <strong>{p.product_name || p.product_id}</strong>
                <span>{p.category || p.product_id}</span>
                {isAnomaly && <em className="bi-product__flag">Cần tối ưu</em>}
              </div>
              <span className="bi-product__num" role="cell">{fmt(views)}</span>
              <span className="bi-product__num" role="cell">{fmt(p.add_to_cart)}</span>
              <span className="bi-product__num bi-product__num--bold" role="cell">
                {fmt(p.purchases)}
              </span>
              <span className={`bi-product__rate ${rateClass(p.view_to_cart_rate)}`} role="cell">
                {pct(p.view_to_cart_rate)}
              </span>
              <span className={`bi-product__rate ${rateClass(p.purchase_rate)}`} role="cell">
                {pct(p.purchase_rate)}
              </span>
              <span className="bi-product__revenue" role="cell">{money(p.revenue)}</span>
              <div className="bi-product__bar" role="cell">
                <div className="bi-product__bar-fill" style={{ width: `${Math.max(volPct, 4)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
