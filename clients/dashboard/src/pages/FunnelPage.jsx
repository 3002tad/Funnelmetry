import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { theme } from "../lib/theme.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const STEP_LABELS = {
  page_view: "Xem trang",
  product_view: "Xem SP",
  add_to_cart: "Thêm giỏ",
  checkout_start: "Thanh toán",
  purchase: "Mua hàng",
};

export function FunnelPage({ variant = "admin" }) {
  const t = theme(variant);
  const [minutes, setMinutes] = useState(60);
  const fetcher = useCallback(() => api.funnel(minutes), [minutes]);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher);

  if (loading) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const steps = data?.funnel || [];
  const maxCount = steps[0]?.count || 1;

  return (
    <>
      <PageHeader
        variant={variant}
        title={variant === "shop" ? "Phễu mua hàng" : "Conversion Funnel"}
        subtitle={variant === "shop" ? "Hành trình khách từ vào web đến đặt hàng" : undefined}
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={refresh}
      />

      <div className={t.panel} style={{ maxWidth: 680 }}>
        {steps.map((s, i) => {
          const pct = maxCount > 0 ? Math.max((s.count / maxCount) * 100, 2) : 0;
          return (
            <div key={s.step} className="funnel-step">
              <span className="funnel-label">{STEP_LABELS[s.step] || s.step}</span>
              <div className="funnel-bar-wrap">
                <div
                  className="funnel-bar"
                  style={{
                    width: `${pct}%`,
                    background: variant === "shop"
                      ? "linear-gradient(90deg, #0d9488, #14b8a6)"
                      : undefined,
                  }}
                >
                  {s.count > 0 && s.count}
                </div>
              </div>
              <span className="funnel-count">{Number(s.count).toLocaleString()}</span>
            </div>
          );
        })}
        {steps.length === 0 && <p className="empty">Chưa có dữ liệu funnel.</p>}
      </div>
    </>
  );
}
