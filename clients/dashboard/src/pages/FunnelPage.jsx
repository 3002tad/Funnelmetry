import { useCallback, useMemo } from "react";
import { ConversionFunnel } from "../components/charts/ConversionFunnel.jsx";
import { FunnelDropChart } from "../components/charts/FunnelDropChart.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconFunnel } from "../components/icons.jsx";
import { ActionCardValue } from "../components/MoneyText.jsx";
import { StatHero } from "../components/StatCard.jsx";
import { buildFunnelRows } from "../lib/funnelMetrics.js";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useManagerPeriod } from "../hooks/useManagerPeriod.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

const LABELS = {
  page_view: "Xem trang",
  product_view: "Xem sản phẩm",
  add_to_cart: "Thêm vào giỏ",
  checkout_start: "Bắt đầu checkout",
  purchase: "Hoàn tất mua",
};

export function FunnelPage() {
  const period = useManagerPeriod(60);
  const fetcher = useCallback(() => api.funnel(period.periodParams), [period.periodParams]);
  const { data, loading, error, refresh, lastUpdated } = useAutoRefresh(fetcher, 60000);
  useOnKpiUpdate(useCallback(() => refresh(), [refresh]));

  const steps = data?.funnel || [];
  const { summary } = useMemo(() => buildFunnelRows(steps, LABELS), [steps]);

  const actionItems = useMemo(() => {
    if (!summary) return [];

    const checkout = steps.find((s) => s.step === "checkout_start");
    const checkoutCount = Number(checkout?.count || 0);
    const purchase = summary.purchase;
    const checkoutDrop = checkoutCount > 0 ? (1 - purchase / checkoutCount) * 100 : 0;

    return [
      {
        key: "worst-drop",
        level: summary.worstStep && summary.worstStep.dropPct >= 50 ? "high"
          : summary.worstStep && summary.worstStep.dropPct >= 30 ? "medium" : "good",
        title: "Bước rớt mạnh nhất",
        value: summary.worstStep ? `−${summary.worstStep.dropPct.toFixed(1)}%` : "—",
        hint: summary.worstStep
          ? `"${summary.worstStep.label}" — ưu tiên tối ưu UX tại bước này.`
          : "Chưa đủ dữ liệu phễu.",
      },
      {
        key: "overall-conv",
        level: summary.overallConvPct < 1 ? "high" : summary.overallConvPct < 3 ? "medium" : "good",
        title: "Conversion tổng",
        value: `${summary.overallConvPct.toFixed(2)}%`,
        hint: summary.overallConvPct < 1
          ? "Tỷ lệ mua từ xem trang thấp — xem lại toàn funnel."
          : "Conversion tổng thể trong ngưỡng chấp nhận được.",
      },
      {
        key: "checkout-drop",
        level: checkoutDrop >= 60 ? "high" : checkoutDrop >= 40 ? "medium" : "good",
        title: "Rớt sau checkout",
        value: `${checkoutDrop.toFixed(1)}%`,
        hint: checkoutDrop >= 40
          ? "Nhiều khách checkout nhưng không mua — kiểm tra payment/shipping."
          : "Tỷ lệ hoàn tất sau checkout ổn.",
      },
    ];
  }, [steps, summary]);

  if (loading && !data) {
    return (
      <>
        <PageHeader
          title="Phễu chuyển đổi"
          minutes={period.minutes}
          onMinutesChange={period.selectMinutes}
          date={period.date}
          onDateChange={period.selectDate}
          live={false}
        />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Phễu chuyển đổi" onRefresh={refresh} live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Phễu chuyển đổi"
        subtitle="Phân tích conversion từng bước — xác định điểm rớt và volume mất"
        minutes={period.minutes}
        onMinutesChange={period.selectMinutes}
        date={period.date}
        onDateChange={period.selectDate}
        onRefresh={refresh}
        lastUpdated={lastUpdated}
      />
      <div className="mgr-content">
        {steps.length === 0 ? (
          <DataPanel title="Phễu chuyển đổi">
            <EmptyState />
          </DataPanel>
        ) : (
          <>
            {summary && (
              <div className="stat-hero-row stat-hero-row--funnel">
                <StatHero
                  tone="purple"
                  icon={IconFunnel}
                  label="Vào phễu"
                  value={summary.top.toLocaleString("vi-VN")}
                  sub="Lượt xem trang (bước 1)"
                />
                <StatHero
                  tone="success"
                  label="Hoàn tất mua"
                  value={summary.purchase.toLocaleString("vi-VN")}
                  sub="Giao dịch thành công"
                />
                <StatHero
                  tone="primary"
                  label="Conversion tổng"
                  value={`${summary.overallConvPct.toFixed(2)}%`}
                  sub={summary.worstStep
                    ? `Rớt mạnh: ${summary.worstStep.label}`
                    : "Toàn phễu"}
                />
              </div>
            )}

            <DataPanel
              title="Bảng conversion"
              subtitle="Chỉ số BI theo bước — % tổng, chuyển tiếp, rớt và volume"
            >
              <div className="data-panel__body data-panel__body--flush">
                <ConversionFunnel steps={steps} labels={LABELS} />
              </div>
            </DataPanel>

            <div className="overview-main-grid">
              <DataPanel
                title="Người rời bỏ giữa các bước"
                subtitle="Diagnostic chart — volume mất khi không chuyển bước"
              >
                <div className="data-panel__body data-panel__body--chart">
                  <FunnelDropChart steps={steps} labels={LABELS} height={280} />
                </div>
              </DataPanel>

              <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý tối ưu phễu trong kỳ này">
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
            </div>
          </>
        )}
      </div>
    </>
  );
}
