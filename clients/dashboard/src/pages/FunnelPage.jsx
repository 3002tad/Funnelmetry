import { useCallback, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FunnelShape } from "../components/charts/FunnelShape.jsx";
import { CHART_COLORS, GRID_STROKE, TICK_FILL, TOOLTIP_STYLE } from "../components/charts/chartTheme.js";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const LABELS = {
  page_view: "Xem trang",
  product_view: "Xem sản phẩm",
  add_to_cart: "Thêm vào giỏ",
  checkout_start: "Bắt đầu checkout",
  purchase: "Hoàn tất mua",
};

export function FunnelPage() {
  const [minutes, setMinutes] = useState(60);
  const fetcher = useCallback(() => api.funnel(minutes), [minutes]);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher);

  const chartData = useMemo(
    () => (data?.funnel || []).map((s) => ({
      name: LABELS[s.step] || s.step,
      count: Number(s.count),
    })),
    [data]
  );

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Phễu chuyển đổi" minutes={minutes} onMinutesChange={setMinutes} live={false} />
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

  const steps = data?.funnel || [];
  const maxCount = steps[0]?.count || 1;

  return (
    <>
      <PageHeader
        title="Phễu chuyển đổi"
        subtitle="Theo dõi từng bước trong hành trình mua hàng — xác định nơi khách rời bỏ"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={refresh}
      />
      <div className="mgr-content">
        {steps.length === 0 ? (
          <DataPanel title="Conversion funnel">
            <EmptyState />
          </DataPanel>
        ) : (
          <>
            <div className="mgr-cols-2">
              <DataPanel title="Sơ đồ phễu" subtitle="Chiều rộng mỗi bước = số lượng người dùng">
                <div className="data-panel__body">
                  <FunnelShape steps={steps} labels={LABELS} />
                </div>
              </DataPanel>

              <DataPanel title="Cột so sánh" subtitle="Volume từng bước trong funnel">
                <div className="data-panel__body data-panel__body--chart">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: TICK_FILL }} interval={0} angle={-10} textAnchor="end" height={52} />
                      <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={36}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DataPanel>
            </div>

            <DataPanel title="Chi tiết từng bước" subtitle="Số lượng và tỷ lệ rớt giữa các bước">
              <div className="funnel-v2">
                {steps.map((s, i) => {
                  const pct = maxCount > 0 ? Math.max((s.count / maxCount) * 100, 3) : 0;
                  const drop = i > 0 && s.drop_off_rate > 0;
                  return (
                    <div key={s.step} className="funnel-v2__step">
                      <span className="funnel-v2__label">{LABELS[s.step] || s.step}</span>
                      <div className="funnel-v2__track">
                        <div className="funnel-v2__fill" style={{ width: `${pct}%` }}>
                          {s.count > 0 && Number(s.count).toLocaleString()}
                        </div>
                      </div>
                      <span className="funnel-v2__count">{Number(s.count).toLocaleString()}</span>
                      <span className={`funnel-v2__drop${drop ? "" : " funnel-v2__drop--ok"}`}>
                        {drop ? `−${(s.drop_off_rate * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </DataPanel>
          </>
        )}
      </div>
    </>
  );
}
