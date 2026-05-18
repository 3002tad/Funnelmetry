import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TimeRange, USE_MOCK } from "@/lib/api";
import ReactECharts from "echarts-for-react";
import {
  DollarSign, Activity, CheckCircle, XCircle, TrendingUp, RefreshCw,
  Clock, Zap, Gauge, Timer, X, ChevronRight, ZoomIn,
  ArrowLeft, ShoppingBag, Globe, CreditCard, Package, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import KPICard from "@/components/ui/KPICard";
import Card from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/EmptyState";
import { KPICardSkeleton, ChartSkeleton } from "@/components/ui/Skeleton";
import EmptyChart from "@/components/ui/EmptyChart";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import SortableGrid from "@/components/ui/SortableGrid";
import SortableItem from "@/components/ui/SortableItem";
import { useSortableLayout } from "@/hooks/useSortableLayout";

import { ChartType, paymentColors, categoryColors } from "./chartTheme";
import ChartToggle from "./components/ChartToggle";
import LatencyBar from "./components/LatencyBar";
import { useDashboardData } from "./hooks/useDashboardData";
import { useDrillDown } from "./hooks/useDrillDown";
import {
  buildOrdersOption, buildPieOption, buildAmountDistributionOption,
  buildCategoryOption, buildRegionOption, buildPaymentOption,
} from "./chartOptions";

const PANEL = "glass rounded-2xl p-6 shadow-xl shadow-slate-950/40";

export default function Dashboard() {
  const navigate = useNavigate();
  const goToEvents = useCallback(
    (params: Record<string, string>) => navigate(`/events?${new URLSearchParams(params)}`),
    [navigate],
  );

  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [ordersChart, setOrdersChart] = useState<ChartType>("bar");

  const {
    drillFilters, drillDetail, setDrillDetail, activeStatus,
    removeDrill, clearDrills, drillEventType, drillStatus, drillUser, drillEvents,
  } = useDrillDown(timeRange);

  const {
    kpi, kpiLoading, kpiError, timeSeries, timeSeriesLoading, metrics,
    traceStats, amountDistribution,
    categoryStats, regionStats, paymentStats, topProducts,
  } = useDashboardData(timeRange, autoRefresh);

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: "5m",  label: "5m" },
    { value: "15m", label: "15m" },
    { value: "30m", label: "30m" },
    { value: "1h",  label: "1h" },
    { value: "24h", label: "24h" },
  ];

  const ordersChartData = timeSeries?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    success: d.paymentSuccess,
    failed: d.paymentFailed,
    created: d.ordersCreated,
  }));

  // Sparklines from timeSeries (last ~20 points)
  const sparklines = useMemo(() => {
    if (!timeSeries || timeSeries.length === 0) return null;
    const tail = timeSeries.slice(-24);
    return {
      revenue: tail.map((d) => d.revenue),
      events:  tail.map((d) => d.paymentSuccess + d.paymentFailed + d.ordersCreated),
      success: tail.map((d) => d.paymentSuccess),
      failed:  tail.map((d) => d.paymentFailed),
    };
  }, [timeSeries]);

  // Trend % vs first half of the period
  const trendPct = useMemo(() => {
    if (!sparklines || sparklines.events.length < 4) return null;
    const half = Math.floor(sparklines.events.length / 2);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const calc = (arr: number[]) => {
      const a = sum(arr.slice(0, half));
      const b = sum(arr.slice(half));
      if (a === 0) return null;
      return ((b - a) / a) * 100;
    };
    return {
      revenue: calc(sparklines.revenue),
      events:  calc(sparklines.events),
      success: calc(sparklines.success),
      failed:  calc(sparklines.failed),
    };
  }, [sparklines]);

  const pieData = kpi
    ? [
        { name: "Success", value: kpi.paymentSuccess, status: "success" },
        { name: "Pending", value: kpi.pending, status: "pending" },
        { name: "Failed",  value: kpi.totalFailed, status: "failed" },
      ].filter((d) => d.value > 0)
    : [];

  // ── Sortable layouts ──
  const KPI_IDS = ["revenue", "totalEvents", "success", "pending", "failed", "successRate"];
  const PANEL_IDS = ["paymentStatus", "amountDist", "eventDist", "latency", "category", "region", "payment", "topProducts"];
  const kpiLayout = useSortableLayout("dashboard.kpi.order", KPI_IDS);
  const panelLayout = useSortableLayout("dashboard.panels.order", PANEL_IDS);

  const compactNumber = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return Math.round(n).toLocaleString();
  };

  const kpiCards: Record<string, JSX.Element> = kpi ? {
    revenue: (
      <KPICard
        title="Revenue"
        value={kpi.revenue}
        format={(n) => {
          if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
          if (n >= 1e9)  return `${(n / 1e9).toFixed(1)}B`;
          if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
          if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
          return Math.round(n).toString();
        }}
        subtitle="VND"
        changePct={trendPct?.revenue}
        icon={<DollarSign size={16} />}
        color="success"
        onClick={() => goToEvents({})}
      />
    ),
    totalEvents: (
      <KPICard title="Total Events" value={kpi.totalEvents} format={compactNumber}
        subtitle="processed" changePct={trendPct?.events}
        icon={<Activity size={16} />} color="primary"
        onClick={() => { clearDrills(); }} />
    ),
    success: (
      <KPICard title="Success" value={kpi.paymentSuccess} format={compactNumber}
        changePct={trendPct?.success}
        icon={<CheckCircle size={16} />} color="success"
        onClick={() => drillStatus("success")} />
    ),
    pending: (
      <KPICard title="Pending" value={kpi.pending} format={compactNumber}
        icon={<Clock size={16} />} color="warning"
        onClick={() => drillStatus("pending")} />
    ),
    failed: (
      <KPICard title="Failed" value={kpi.totalFailed} format={compactNumber}
        changePct={trendPct?.failed}
        icon={<XCircle size={16} />} color="danger"
        onClick={() => drillStatus("failed")} />
    ),
    successRate: (
      <KPICard title="Success Rate" value={kpi.successRate}
        format={(n) => `${n.toFixed(1)}%`}
        icon={<TrendingUp size={16} />}
        color={kpi.successRate >= 80 ? "success" : kpi.successRate >= 60 ? "warning" : "danger"}
        onClick={() => drillEventType("payment_success")} />
    ),
  } : {};

  const resetLayout = () => {
    kpiLayout.reset();
    panelLayout.reset();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gradient tracking-tight">Business Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Click any chart element to drill down into details</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex glass rounded-lg p-1">
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-all ${
                  timeRange === option.value
                    ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ring-1 ${
              autoRefresh
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40 shadow-md shadow-emerald-500/20"
                : "glass text-slate-400 ring-slate-700/50 hover:text-slate-200"
            }`}
          >
            {autoRefresh ? (
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
            ) : (
              <RefreshCw size={14} />
            )}
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button
            onClick={resetLayout}
            title="Reset layout to default"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium glass text-slate-400 ring-1 ring-slate-700/50 hover:text-slate-200 hover:ring-indigo-500/40 transition-all"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Drill-down Breadcrumb */}
      {drillFilters.length > 0 && (
        <div className="glass rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap ring-1 ring-indigo-500/30">
          <div className="flex items-center gap-1.5 text-sm text-indigo-300 font-medium">
            <ZoomIn size={16} /> Drill-down:
          </div>
          <div className="flex items-center gap-1 text-sm text-slate-400">
            <span>Overview</span>
            {drillFilters.map((f) => (
              <span key={f.key} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-slate-600" />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-500/20 text-indigo-200 rounded-full text-xs font-medium ring-1 ring-indigo-500/30">
                  {f.label}
                  <button onClick={() => removeDrill(f.key)} className="hover:text-white"><X size={12} /></button>
                </span>
              </span>
            ))}
          </div>
          <button onClick={clearDrills} className="ml-auto flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 font-medium">
            <ArrowLeft size={14} /> Back to Overview
          </button>
        </div>
      )}

      {/* Pipeline Throughput Banner */}
      {metrics && (
        <div className="relative overflow-hidden rounded-2xl p-6 ring-1 ring-indigo-500/20 shadow-xl shadow-indigo-500/10">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_50%)]"></div>
          {/* Animated grid pattern */}
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}></div>
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-6 text-white">
            <div>
              <div className="flex items-center gap-2 text-indigo-200 text-xs font-medium uppercase tracking-wider mb-1.5"><Zap size={13} /> Processing Rate</div>
              <div className="text-3xl font-bold tabular-nums">
                <AnimatedNumber value={metrics.processedEventsPerSec} />
              </div>
              <div className="text-indigo-200/80 text-xs mt-0.5">events/sec</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-indigo-200 text-xs font-medium uppercase tracking-wider mb-1.5"><Gauge size={13} /> Kafka Lag</div>
              <div className="text-3xl font-bold tabular-nums">
                <AnimatedNumber value={metrics.kafkaLag} />
              </div>
              <div className="text-indigo-200/80 text-xs mt-0.5">messages behind</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-indigo-200 text-xs font-medium uppercase tracking-wider mb-1.5"><Timer size={13} /> Latency P50</div>
              <div className="text-3xl font-bold tabular-nums">
                {traceStats?.p50 != null ? <AnimatedNumber value={traceStats.p50} format={(n) => Math.round(n).toString()} /> : "—"}
              </div>
              <div className="text-indigo-200/80 text-xs mt-0.5">ms end-to-end</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-indigo-200 text-xs font-medium uppercase tracking-wider mb-1.5"><Timer size={13} /> Latency P95</div>
              <div className="text-3xl font-bold tabular-nums">
                {traceStats?.p95 != null ? <AnimatedNumber value={traceStats.p95} format={(n) => Math.round(n).toString()} /> : "—"}
              </div>
              <div className="text-indigo-200/80 text-xs mt-0.5">ms end-to-end</div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards (drag to reorder) */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => <KPICardSkeleton key={i} />)}
        </div>
      ) : kpiError ? (
        <div className="glass rounded-xl p-4 text-rose-300 ring-1 ring-rose-500/30">Error loading KPIs.</div>
      ) : kpi ? (
        <SortableGrid
          ids={kpiLayout.order}
          onReorder={kpiLayout.setOrder}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 auto-rows-fr"
        >
          {kpiLayout.order.map((id) => (
            <SortableItem key={id} id={id}>
              {kpiCards[id]}
            </SortableItem>
          ))}
        </SortableGrid>
      ) : null}

      {/* Drill-down Detail Panel */}
      {drillDetail && drillEvents && (
        <div className="glass rounded-2xl p-6 ring-1 ring-indigo-500/30 shadow-xl shadow-indigo-500/10 animate-slide-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <ZoomIn size={16} className="text-indigo-400" /> {drillDetail.title}
              <span className="text-sm font-normal text-slate-500">— {drillEvents.total.toLocaleString()} events</span>
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => goToEvents({
                  ...(drillDetail.type === "eventType" && { eventType: drillDetail.value }),
                  ...(drillDetail.type === "status"    && { status: drillDetail.value }),
                  ...(drillDetail.type === "user"      && { search: drillDetail.value }),
                })}
                className="text-sm text-indigo-300 hover:text-indigo-200 font-medium"
              >View all in Events →</button>
              <button onClick={() => setDrillDetail(null)} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>
          </div>
          {drillEvents.statusCounts && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-emerald-500/10 ring-1 ring-emerald-500/30 rounded-lg p-3 text-center cursor-pointer hover:ring-emerald-400/60 transition-all" onClick={() => drillStatus("success")}>
                <div className="text-xl font-bold text-emerald-300 tabular-nums">{drillEvents.statusCounts.success?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-emerald-400/80">Success</div>
              </div>
              <div className="bg-amber-500/10 ring-1 ring-amber-500/30 rounded-lg p-3 text-center cursor-pointer hover:ring-amber-400/60 transition-all" onClick={() => drillStatus("pending")}>
                <div className="text-xl font-bold text-amber-300 tabular-nums">{drillEvents.statusCounts.pending?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-amber-400/80">Pending</div>
              </div>
              <div className="bg-rose-500/10 ring-1 ring-rose-500/30 rounded-lg p-3 text-center cursor-pointer hover:ring-rose-400/60 transition-all" onClick={() => drillStatus("failed")}>
                <div className="text-xl font-bold text-rose-300 tabular-nums">{drillEvents.statusCounts.failed?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-rose-400/80">Failed</div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded-lg ring-1 ring-slate-800/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
                <tr className="border-b border-slate-800/60">
                  <th className="text-left  py-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Time</th>
                  <th className="text-left  py-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-left  py-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">User</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Amount</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {drillEvents.events.slice(0, 20).map((e) => (
                  <tr key={e.id} className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                    onClick={() => { if (drillDetail.type !== "user") drillUser(e.userId); }}>
                    <td className="py-2 px-3 text-slate-300 tabular-nums">{format(new Date(e.eventTime), "HH:mm:ss")}</td>
                    <td className="py-2 px-3">
                      <button onClick={(ev) => { ev.stopPropagation(); drillEventType(e.eventType); }}
                        className="text-xs px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 ring-1 ring-indigo-500/30">
                        {e.eventType.replace(/_/g, " ")}
                      </button>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400 text-xs">{e.userId}</td>
                    <td className="py-2 px-3 text-right font-medium text-slate-200 tabular-nums">{e.amount.toLocaleString()} <span className="text-slate-500 text-xs">{e.currency}</span></td>
                    <td className="py-2 px-3 text-center">
                      <button onClick={(ev) => { ev.stopPropagation(); drillStatus(e.status); }}
                        className={`text-xs px-2 py-0.5 rounded ring-1 ${
                          e.status === "success" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" :
                          e.status === "failed"  ? "bg-rose-500/15    text-rose-300    ring-rose-500/30" :
                                                   "bg-amber-500/15   text-amber-300   ring-amber-500/30"
                        } hover:opacity-80`}>
                        {e.status}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Chart panels (drag to reorder) */}
      <SortableGrid
        ids={panelLayout.order}
        onReorder={panelLayout.setOrder}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {panelLayout.order.map((id) => {
          const wrapClass = id === "latency" ? "lg:col-span-2" : "";
          return (
            <SortableItem key={id} id={id} className={wrapClass}>
              {id === "paymentStatus" && (
                <div className={PANEL}>
                  <div className="flex items-center justify-between mb-4 pr-7">
                    <h3 className="text-base font-semibold text-slate-100">Payment Status</h3>
                    <ChartToggle value={ordersChart} onChange={setOrdersChart} />
                  </div>
                  {timeSeriesLoading ? <ChartSkeleton height={300} /> : ordersChartData ? (
                    <ReactECharts
                      option={buildOrdersOption(ordersChartData, ordersChart, activeStatus)}
                      style={{ height: 300 }} notMerge={true}
                      onEvents={{ click: (params: any) => {
                        if (params.seriesName === "Success") drillStatus("success");
                        else if (params.seriesName === "Failed") drillStatus("failed");
                      } }}
                    />
                  ) : null}
                </div>
              )}

              {id === "amountDist" && (
                <div className={PANEL}>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-4 pr-7">
                    <span className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center"><DollarSign size={14} className="text-emerald-400" /></span>
                    Amount Distribution
                  </h3>
                  {amountDistribution && amountDistribution.length > 0 ? (
                    <ReactECharts option={buildAmountDistributionOption(amountDistribution)} style={{ height: 300 }} notMerge={true} />
                  ) : <EmptyChart />}
                </div>
              )}

              {id === "eventDist" && (
                <Card title="Event Distribution">
                  {pieData.length > 0 ? (
                    <ReactECharts option={buildPieOption(pieData, activeStatus)} style={{ height: 280 }} notMerge={true}
                      onEvents={{ click: (params: any) => { if (params.data?.status) drillStatus(params.data.status); } }} />
                  ) : <EmptyChart height={280} />}
                </Card>
              )}

              {id === "latency" && (
                <Card title="Pipeline Latency">
                  {traceStats ? (
                    <div className="space-y-4 py-2">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="bg-emerald-500/10 ring-1 ring-emerald-500/20 rounded-lg p-4">
                          <div className="text-2xl font-bold text-emerald-300 tabular-nums">{traceStats.p50 ?? "—"}<span className="text-sm font-normal ml-1 text-emerald-400/70">ms</span></div>
                          <div className="text-xs text-emerald-400/80 mt-1 uppercase tracking-wider">P50</div>
                        </div>
                        <div className="bg-amber-500/10 ring-1 ring-amber-500/20 rounded-lg p-4">
                          <div className="text-2xl font-bold text-amber-300 tabular-nums">{traceStats.p95 ?? "—"}<span className="text-sm font-normal ml-1 text-amber-400/70">ms</span></div>
                          <div className="text-xs text-amber-400/80 mt-1 uppercase tracking-wider">P95</div>
                        </div>
                        <div className="bg-rose-500/10 ring-1 ring-rose-500/20 rounded-lg p-4">
                          <div className="text-2xl font-bold text-rose-300 tabular-nums">{traceStats.p99 ?? "—"}<span className="text-sm font-normal ml-1 text-rose-400/70">ms</span></div>
                          <div className="text-xs text-rose-400/80 mt-1 uppercase tracking-wider">P99</div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const maxL = Math.max(traceStats.avgGenToKafkaMs ?? 0, traceStats.avgKafkaToSparkMs ?? 0, traceStats.avgSparkToDbMs ?? 0);
                          return (
                            <>
                              <LatencyBar label="Generator → Kafka" value={traceStats.avgGenToKafkaMs} color="bg-gradient-to-r from-indigo-500 to-blue-500" max={maxL} />
                              <LatencyBar label="Kafka → Spark" value={traceStats.avgKafkaToSparkMs} color="bg-gradient-to-r from-amber-500 to-orange-500" max={maxL} />
                              <LatencyBar label="Spark → PostgreSQL" value={traceStats.avgSparkToDbMs} color="bg-gradient-to-r from-violet-500 to-purple-500" max={maxL} />
                            </>
                          );
                        })()}
                      </div>
                      <div className="text-xs text-slate-500 text-center">Based on {traceStats.count.toLocaleString()} traced events</div>
                    </div>
                  ) : <div className="h-[280px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>}
                </Card>
              )}

              {id === "category" && (
                <div className={PANEL}>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-4 pr-7">
                    <span className="w-7 h-7 rounded-md bg-indigo-500/20 flex items-center justify-center"><ShoppingBag size={14} className="text-indigo-400" /></span>
                    Revenue by Category
                  </h3>
                  {categoryStats && categoryStats.length > 0 ? (
                    <ReactECharts option={buildCategoryOption(categoryStats)} style={{ height: 300 }} notMerge={true} />
                  ) : <EmptyChart />}
                </div>
              )}

              {id === "region" && (
                <div className={PANEL}>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-4 pr-7">
                    <span className="w-7 h-7 rounded-md bg-blue-500/20 flex items-center justify-center"><Globe size={14} className="text-blue-400" /></span>
                    Orders by Region
                  </h3>
                  {regionStats && regionStats.length > 0 ? (
                    <ReactECharts option={buildRegionOption(regionStats)} style={{ height: 300 }} notMerge={true} />
                  ) : <EmptyChart />}
                </div>
              )}

              {id === "payment" && (
                <div className={PANEL}>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-4 pr-7">
                    <span className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center"><CreditCard size={14} className="text-emerald-400" /></span>
                    Payment Method Success Rate
                  </h3>
                  {paymentStats && paymentStats.length > 0 ? (
                    <div className="space-y-4">
                      <ReactECharts option={buildPaymentOption(paymentStats)} style={{ height: 220 }} notMerge={true} />
                      <div className="grid grid-cols-2 gap-2">
                        {paymentStats.map((p) => (
                          <div key={p.paymentMethod} className="flex items-center justify-between bg-slate-800/40 ring-1 ring-slate-700/40 rounded-lg px-3 py-2">
                            <span className="text-xs font-medium" style={{ color: paymentColors[p.paymentMethod] }}>
                              {p.paymentMethod.replace(/_/g, " ")}
                            </span>
                            <span className={`text-xs font-bold tabular-nums ${p.successRate >= 80 ? "text-emerald-300" : p.successRate >= 60 ? "text-amber-300" : "text-rose-300"}`}>
                              {p.successRate.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : <EmptyChart />}
                </div>
              )}

              {id === "topProducts" && (
                <div className={PANEL}>
                  <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2 mb-4 pr-7">
                    <span className="w-7 h-7 rounded-md bg-orange-500/20 flex items-center justify-center"><Package size={14} className="text-orange-400" /></span>
                    Top Products by Revenue
                  </h3>
                  {topProducts && topProducts.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800/60">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-900/60">
                          <tr className="border-b border-slate-800/60">
                            <th className="text-left  py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">#</th>
                            <th className="text-left  py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Product</th>
                            <th className="text-left  py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Category</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Orders</th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/40">
                          {topProducts.map((p, i) => (
                            <tr key={p.productId} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-2 px-2 text-slate-600 text-xs tabular-nums">{i + 1}</td>
                              <td className="py-2 px-2">
                                <div className="font-medium text-slate-200 text-xs">{p.productName}</div>
                                <div className="text-slate-500 text-[10px]">{p.productId}</div>
                              </td>
                              <td className="py-2 px-2">
                                <span className="text-xs px-2 py-0.5 rounded-full ring-1" style={{ backgroundColor: (categoryColors[p.category] || "#94A3B8") + "20", color: categoryColors[p.category] || "#94A3B8", borderColor: (categoryColors[p.category] || "#94A3B8") + "40" }}>
                                  {p.category}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-xs text-slate-300 tabular-nums">{p.orderCount.toLocaleString()}</td>
                              <td className="py-2 px-2 text-right text-xs font-semibold text-slate-100 tabular-nums">{(p.revenue / 1000000).toFixed(1)}M</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <EmptyChart />}
                </div>
              )}
            </SortableItem>
          );
        })}
      </SortableGrid>

      {/* Status */}
      <div className={`glass rounded-xl p-4 ring-1 ${USE_MOCK ? "ring-amber-500/30" : "ring-emerald-500/30"}`}>
        <div className="flex items-center gap-3">
          <span className="relative flex w-2.5 h-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${USE_MOCK ? "bg-amber-400" : "bg-emerald-400"}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${USE_MOCK ? "bg-amber-400" : "bg-emerald-400"}`}></span>
          </span>
          <div className="text-sm">
            <span className={`font-medium ${USE_MOCK ? "text-amber-300" : "text-emerald-300"}`}>{USE_MOCK ? "Mock Data Mode" : "Live Data Mode"}</span>
            <span className="text-slate-500 ml-2">{USE_MOCK ? "Showing simulated data" : "Connected to pipeline — real-time from PostgreSQL"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
