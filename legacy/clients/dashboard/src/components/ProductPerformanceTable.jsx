import { RankBadge } from "./DataPanel.jsx";
import { formatMoney } from "../lib/format.js";
import { MoneyText } from "./MoneyText.jsx";

function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
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
          <strong>
            <MoneyText value={formatMoney(products.reduce((s, p) => s + Number(p.revenue), 0))} />
          </strong>
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

      <div className="bi-product__table-wrap">
        <table className="data-table bi-product-table">
          <colgroup>
            <col className="bi-col-rank" />
            <col className="bi-col-name" />
            <col className="bi-col-num" />
            <col className="bi-col-num" />
            <col className="bi-col-num" />
            <col className="bi-col-num" />
            <col className="bi-col-rate" />
            <col className="bi-col-rate" />
            <col className="bi-col-revenue" />
            <col className="bi-col-bar" />
          </colgroup>
          <thead>
            <tr>
              <th className="bi-product-table__col-rank">#</th>
              <th className="bi-product-table__col-name">Sản phẩm</th>
              <th className="bi-product-table__col-count bi-product-table__col-count--lead" title="Lượt xem">
                Xem
              </th>
              <th className="bi-product-table__col-count" title="Thêm giỏ">Giỏ</th>
              <th className="bi-product-table__col-count" title="Mua hàng">Mua</th>
              <th className="bi-product-table__col-rate" title="View → Giỏ">
                <span className="bi-product-table__th-short">→ Giỏ</span>
              </th>
              <th className="bi-product-table__col-rate" title="View → Mua">
                <span className="bi-product-table__th-short">→ Mua</span>
              </th>
              <th className="bi-product-table__col-revenue">Doanh thu</th>
              <th className="bi-product-table__col-bar">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const views = Number(p.views);
              const volPct = maxViews > 0 ? (views / maxViews) * 100 : 0;
              const isAnomaly = anomaliesIds.has(p.product_id);

              return (
                <tr
                  key={p.product_id}
                  className={isAnomaly ? "bi-product-table__row--warn" : undefined}
                >
                  <td className="bi-product-table__col-rank">
                    <RankBadge rank={i + 1} />
                  </td>
                  <td className="bi-product-table__col-name">
                    <div className="bi-product__name">
                      <strong>{p.product_name || p.product_id}</strong>
                      <span>{p.category || p.product_id}</span>
                      {isAnomaly && <em className="bi-product__flag">Cần tối ưu</em>}
                    </div>
                  </td>
                  <td className="bi-product-table__col-count bi-product-table__col-count--lead">
                    {fmt(views)}
                  </td>
                  <td className="bi-product-table__col-count">{fmt(p.add_to_cart)}</td>
                  <td className="bi-product-table__col-count bi-product__num--bold">
                    {fmt(p.purchases)}
                  </td>
                  <td className={`bi-product-table__col-rate bi-product__rate ${rateClass(p.view_to_cart_rate)}`}>
                    {pct(p.view_to_cart_rate)}
                  </td>
                  <td className={`bi-product-table__col-rate bi-product__rate ${rateClass(p.purchase_rate)}`}>
                    {pct(p.purchase_rate)}
                  </td>
                  <td className="bi-product-table__col-revenue bi-product__revenue">
                    <MoneyText value={formatMoney(p.revenue)} />
                  </td>
                  <td className="bi-product-table__col-bar">
                    <div className="bi-product__bar">
                      <div
                        className="bi-product__bar-fill"
                        style={{ width: `${Math.max(volPct, 4)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
