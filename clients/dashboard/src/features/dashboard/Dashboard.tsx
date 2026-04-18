import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, TimeRange, USE_MOCK } from "@/lib/api";
import ReactECharts from "echarts-for-react";
import {
  DollarSign,
  Activity,
  CheckCircle,
  XCircle,
  TrendingUp,
  RefreshCw,
  Clock,
  Zap,
  Gauge,
  Timer,
  BarChart3,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  Users,
  Layers,
  X,
  ChevronRight,
  ZoomIn,
  ArrowLeft,
  ShoppingBag,
  Globe,
  CreditCard,
  Package,
} from "lucide-react";
import { format } from "date-fns";
import KPICard from "@/components/ui/KPICard";
import Card from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/EmptyState";

type ChartType = "area" | "line" | "bar";

// ── Drill-down state ──
interface DrillFilter {
  key: string;
  label: string;
  value: string;
}

function ChartToggle({
  value,
  onChange,
  options = ["area", "line", "bar"],
}: {
  value: ChartType;
  onChange: (v: ChartType) => void;
  options?: ChartType[];
}) {
  const icons: Record<ChartType, typeof BarChart3> = {
    area: AreaChartIcon,
    line: LineChartIcon,
    bar: BarChart3,
  };
  return (
    <div className="flex bg-gray-100 rounded-md p-0.5 gap-0.5">
      {options.map((opt) => {
        const Icon = icons[opt];
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`p-1.5 rounded transition-colors ${
              value === opt ? "bg-white text-primary shadow-sm" : "text-gray-400 hover:text-gray-600"
            }`}
            title={opt.charAt(0).toUpperCase() + opt.slice(1)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

// Shared ECharts theme helpers
const eGrid = { left: 50, right: 20, top: 30, bottom: 30, containLabel: false };
const eTooltipStyle = { backgroundColor: "#fff", borderColor: "#e5e7eb", textStyle: { color: "#374151" } };

export default function Dashboard() {
  const navigate = useNavigate();
  const goToEvents = useCallback(
    (params: Record<string, string>) => {
      navigate(`/events?${new URLSearchParams(params)}`);
    },
    [navigate]
  );

  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [revenueChart, setRevenueChart] = useState<ChartType>("area");
  const [ordersChart, setOrdersChart] = useState<ChartType>("bar");
  const [eventTypesChart, setEventTypesChart] = useState<ChartType>("area");
  const [latencyChart, setLatencyChart] = useState<ChartType>("line");

  // ── Drill-down state ──
  const [drillFilters, setDrillFilters] = useState<DrillFilter[]>([]);
  const [drillDetail, setDrillDetail] = useState<{
    title: string;
    type: "eventType" | "status" | "user" | "time";
    value: string;
  } | null>(null);

  const addDrill = useCallback((key: string, label: string, value: string) => {
    setDrillFilters((prev) => {
      const filtered = prev.filter((f) => f.key !== key);
      return [...filtered, { key, label, value }];
    });
  }, []);

  const removeDrill = useCallback((key: string) => {
    setDrillFilters((prev) => prev.filter((f) => f.key !== key));
    if (drillDetail?.type === key) setDrillDetail(null);
  }, [drillDetail]);

  const clearDrills = useCallback(() => {
    setDrillFilters([]);
    setDrillDetail(null);
  }, []);

  // Extract active drill filters
  const activeEventType = drillFilters.find((f) => f.key === "eventType")?.value;
  const activeStatus = drillFilters.find((f) => f.key === "status")?.value;

  // ── Queries ──
  const {
    data: kpi,
    isLoading: kpiLoading,
    error: kpiError,
  } = useQuery({
    queryKey: ["kpi", timeRange],
    queryFn: () => api.getKpi(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const { data: timeSeries, isLoading: timeSeriesLoading } = useQuery({
    queryKey: ["timeseries", timeRange],
    queryFn: () => api.getTimeSeries(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.getSystemMetrics(),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const { data: traceStats } = useQuery({
    queryKey: ["traceStats", timeRange],
    queryFn: () => api.getTraceStats(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: fullTimeSeries } = useQuery({
    queryKey: ["fullTimeSeries", timeRange],
    queryFn: () => api.getFullTimeSeries(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const { data: topUsers } = useQuery({
    queryKey: ["topUsers", timeRange],
    queryFn: () => api.getTopUsers(timeRange, 10),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: amountDistribution } = useQuery({
    queryKey: ["amountDistribution", timeRange],
    queryFn: () => api.getAmountDistribution(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: latencyTimeline } = useQuery({
    queryKey: ["latencyTimeline", timeRange],
    queryFn: () => api.getLatencyTimeline(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: scatterData } = useQuery({
    queryKey: ["scatter", timeRange],
    queryFn: () => api.getScatterData(timeRange, 200),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: revenueByType } = useQuery({
    queryKey: ["revenueByType", timeRange],
    queryFn: () => api.getRevenueByType(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: heatmapData } = useQuery({
    queryKey: ["heatmap", timeRange],
    queryFn: () => api.getHeatmap(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: categoryStats } = useQuery({
    queryKey: ["categoryStats", timeRange],
    queryFn: () => api.getByCategory(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: regionStats } = useQuery({
    queryKey: ["regionStats", timeRange],
    queryFn: () => api.getByRegion(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: paymentStats } = useQuery({
    queryKey: ["paymentStats", timeRange],
    queryFn: () => api.getByPayment(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: topProducts } = useQuery({
    queryKey: ["topProducts", timeRange],
    queryFn: () => api.getTopProducts(timeRange, 10),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // Drill-down detail: fetch events filtered by current drill
  const { data: drillEvents } = useQuery({
    queryKey: ["drillEvents", drillDetail?.type, drillDetail?.value, timeRange],
    queryFn: () =>
      api.getEvents({
        pageSize: 50,
        ...(drillDetail?.type === "eventType" && { eventType: drillDetail.value as any }),
        ...(drillDetail?.type === "status" && { status: drillDetail.value as any }),
        ...(drillDetail?.type === "user" && { search: drillDetail.value }),
      }),
    enabled: !!drillDetail,
  });

  // ── Derived data (with drill filtering) ──
  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: "15m", label: "15m" },
    { value: "1h", label: "1h" },
    { value: "24h", label: "24h" },
  ];

  const revenueChartData = timeSeries?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    revenue: d.revenue,
  }));

  const ordersChartData = timeSeries?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    success: d.paymentSuccess,
    failed: d.paymentFailed,
    created: d.ordersCreated,
  }));

  // Filter fullTimeSeries by active drills
  const eventTypesData = useMemo(() => {
    if (!fullTimeSeries) return undefined;
    return fullTimeSeries.map((d) => {
      const row: Record<string, any> = {
        time: format(new Date(d.timestamp), "HH:mm"),
        "Success Rate": d.successRate,
      };
      if (!activeEventType || activeEventType === "order_created") row["Orders Created"] = d.ordersCreated;
      if (!activeEventType || activeEventType === "payment_initiated") row["Payment Initiated"] = d.paymentInitiated;
      if (!activeEventType || activeEventType === "payment_success") row["Payment Success"] = d.paymentSuccess;
      if (!activeEventType || activeEventType === "payment_failed") row["Payment Failed"] = d.paymentFailed;
      if (!activeEventType || activeEventType === "order_cancelled") row["Order Cancelled"] = d.orderCancelled;
      return row;
    });
  }, [fullTimeSeries, activeEventType]);

  const latencyTimelineData = latencyTimeline?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    P50: d.p50,
    P95: d.p95,
    events: d.count,
  }));

  const amountColors = ["#94A3B8", "#60A5FA", "#34D399", "#FBBF24", "#F97316", "#EF4444"];

  const funnelData = kpi
    ? [
        { name: "Orders Created", value: kpi.totalEvents },
        { name: "Payment Initiated", value: kpi.pending + kpi.paymentSuccess + kpi.totalFailed },
        { name: "Payment Success", value: kpi.paymentSuccess },
      ].filter((d) => d.value > 0)
    : [];

  const successRate = kpi?.successRate ?? 0;
  const gaugeColor = successRate >= 80 ? "#10B981" : successRate >= 60 ? "#F59E0B" : "#EF4444";

  const treemapColors: Record<string, string> = {
    "order created": "#6366F1",
    "payment initiated": "#3B82F6",
    "payment success": "#10B981",
    "payment failed": "#EF4444",
    "order cancelled": "#F59E0B",
  };

  const categoryColors: Record<string, string> = {
    electronics: "#6366F1",
    fashion: "#EC4899",
    food: "#F59E0B",
    home: "#3B82F6",
    beauty: "#A855F7",
    books: "#10B981",
  };

  const paymentColors: Record<string, string> = {
    credit_card: "#3B82F6",
    e_wallet: "#10B981",
    bank_transfer: "#F59E0B",
    cod: "#94A3B8",
  };

  const heatmapGrid = useMemo(() => {
    if (!heatmapData || heatmapData.length === 0) return [];
    const types = [...new Set(heatmapData.map((d) => d.eventType))].sort();
    const rows: Record<string, any>[] = [];
    for (let h = 0; h < 24; h++) {
      const row: Record<string, any> = { hour: `${h.toString().padStart(2, "0")}:00` };
      for (const t of types) {
        if (activeEventType && t !== activeEventType) continue;
        const cell = heatmapData.find((d) => d.hour === h && d.eventType === t);
        row[t] = cell?.count || 0;
      }
      rows.push(row);
    }
    return rows;
  }, [heatmapData, activeEventType]);

  // Filter scatter by active status
  const filteredScatter = useMemo(() => {
    if (!scatterData) return [];
    let data = scatterData;
    if (activeStatus) data = data.filter((d) => d.status === activeStatus);
    if (activeEventType) data = data.filter((d) => d.eventType === activeEventType);
    return data;
  }, [scatterData, activeStatus, activeEventType]);

  // Filter top users — we show all but highlight
  const filteredRevenueByType = useMemo(() => {
    if (!revenueByType) return [];
    if (activeEventType) return revenueByType.filter((d) => d.eventType === activeEventType);
    return revenueByType;
  }, [revenueByType, activeEventType]);

  const scatterColors: Record<string, string> = { success: "#10B981", failed: "#EF4444", pending: "#F59E0B" };

  const pieData = kpi
    ? [
        { name: "Success", value: kpi.paymentSuccess, status: "success" },
        { name: "Pending", value: kpi.pending, status: "pending" },
        { name: "Failed", value: kpi.totalFailed, status: "failed" },
      ].filter((d) => d.value > 0)
    : [];

  // ── Drill handlers ──
  const drillEventType = (eventType: string) => {
    const label = eventType.replace(/_/g, " ");
    addDrill("eventType", label, eventType);
    setDrillDetail({ title: `Event Type: ${label}`, type: "eventType", value: eventType });
  };

  const drillStatus = (status: string) => {
    addDrill("status", status, status);
    setDrillDetail({ title: `Status: ${status}`, type: "status", value: status });
  };

  const drillUser = (userId: string) => {
    addDrill("user", userId, userId);
    setDrillDetail({ title: `User: ${userId}`, type: "user", value: userId });
  };

  const drillTime = (tr: TimeRange) => {
    setTimeRange(tr);
  };

  // ── ECharts option builders ──

  const getRevenueOption = () => {
    if (!revenueChartData) return {};
    const times = revenueChartData.map((d) => d.time);
    const revenues = revenueChartData.map((d) => d.revenue);
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) => `${p[0].axisValue}<br/>${(p[0].value / 1000).toFixed(0)}K VND`,
      },
      grid: eGrid,
      xAxis: {
        type: "category",
        data: times,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)}K` },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Revenue",
          type: revenueChart === "bar" ? "bar" : "line",
          smooth: true,
          data: revenues,
          itemStyle: { color: "#10B981" },
          lineStyle: { color: "#10B981", width: 2 },
          areaStyle:
            revenueChart === "area"
              ? {
                  color: {
                    type: "linear",
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(16,185,129,0.3)" },
                      { offset: 1, color: "rgba(16,185,129,0)" },
                    ],
                  },
                }
              : undefined,
          barMaxWidth: 40,
        },
      ],
    };
  };

  const getOrdersOption = () => {
    if (!ordersChartData) return {};
    const times = ordersChartData.map((d) => d.time);
    const successData = ordersChartData.map((d) => d.success);
    const failedData = ordersChartData.map((d) => d.failed);
    const successColor = activeStatus && activeStatus !== "success" ? "#10B98140" : "#10B981";
    const failedColor = activeStatus && activeStatus !== "failed" ? "#EF444440" : "#EF4444";
    const isLine = ordersChart === "line";
    const isArea = ordersChart === "area";
    const seriesType = isLine || isArea ? "line" : "bar";
    return {
      tooltip: { trigger: "axis", ...eTooltipStyle },
      legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 11 } },
      grid: { ...eGrid, bottom: 50 },
      xAxis: {
        type: "category",
        data: times,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Success",
          type: seriesType,
          stack: seriesType === "bar" ? "a" : undefined,
          smooth: true,
          data: successData,
          itemStyle: { color: successColor },
          lineStyle: seriesType === "line" ? { color: successColor, width: 2 } : undefined,
          areaStyle:
            isArea
              ? {
                  color: {
                    type: "linear", x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(16,185,129,0.3)" },
                      { offset: 1, color: "rgba(16,185,129,0)" },
                    ],
                  },
                }
              : undefined,
        },
        {
          name: "Failed",
          type: seriesType,
          stack: seriesType === "bar" ? "a" : undefined,
          smooth: true,
          data: failedData,
          itemStyle: { color: failedColor },
          lineStyle: seriesType === "line" ? { color: failedColor, width: 2 } : undefined,
          areaStyle:
            isArea
              ? {
                  color: {
                    type: "linear", x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(239,68,68,0.3)" },
                      { offset: 1, color: "rgba(239,68,68,0)" },
                    ],
                  },
                }
              : undefined,
        },
      ],
    };
  };

  const getPieOption = () => {
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          center: ["50%", "50%"],
          data: pieData.map((d) => {
            const base = d.status === "success" ? "#10B981" : d.status === "pending" ? "#F59E0B" : "#EF4444";
            const color = activeStatus && d.status !== activeStatus ? base + "40" : base;
            return {
              value: d.value,
              name: d.name,
              status: d.status,
              itemStyle: {
                color,
                borderColor: activeStatus === d.status ? "#1D4ED8" : "none",
                borderWidth: activeStatus === d.status ? 3 : 0,
              },
            };
          }),
          label: { show: true, formatter: "{b}\n{d}%", fontSize: 11 },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.5)" },
          },
        },
      ],
    };
  };

  const getEventTypesOption = () => {
    if (!eventTypesData) return {};
    const times = eventTypesData.map((d) => d.time);
    const isBar = eventTypesChart === "bar";
    const isArea = eventTypesChart === "area";
    const seriesType = isBar ? "bar" : "line";

    const seriesDefs = [
      { key: "Orders Created", color: "#6366F1", et: "order_created" },
      { key: "Payment Initiated", color: "#3B82F6", et: "payment_initiated" },
      { key: "Payment Success", color: "#10B981", et: "payment_success" },
      { key: "Payment Failed", color: "#EF4444", et: "payment_failed" },
      { key: "Order Cancelled", color: "#F59E0B", et: "order_cancelled" },
    ].filter((s) => !activeEventType || activeEventType === s.et);

    return {
      tooltip: { trigger: "axis", ...eTooltipStyle },
      legend: {
        bottom: 0,
        textStyle: { color: "#374151", fontSize: 10 },
      },
      grid: { ...eGrid, bottom: 50 },
      xAxis: {
        type: "category",
        data: times,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: seriesDefs.map((s) => ({
        name: s.key,
        type: seriesType,
        stack: "a",
        smooth: true,
        data: eventTypesData.map((d) => d[s.key] ?? 0),
        itemStyle: { color: s.color },
        lineStyle: seriesType === "line" ? { color: s.color, width: 2 } : undefined,
        areaStyle: isArea
          ? {
              color: {
                type: "linear", x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: s.color + "66" },
                  { offset: 1, color: s.color + "00" },
                ],
              },
            }
          : undefined,
      })),
    };
  };

  const getLatencyOption = () => {
    if (!latencyTimelineData) return {};
    const times = latencyTimelineData.map((d) => d.time);
    const isBar = latencyChart === "bar";
    const isArea = latencyChart === "area";
    const seriesType = isBar ? "bar" : "line";
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) => p.map((s: any) => `${s.seriesName}: ${s.value}ms`).join("<br/>"),
      },
      legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 11 } },
      grid: { ...eGrid, bottom: 50 },
      xAxis: {
        type: "category",
        data: times,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11, formatter: (v: number) => `${v}ms` },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "P50",
          type: seriesType,
          smooth: true,
          data: latencyTimelineData.map((d) => d.P50),
          itemStyle: { color: "#10B981" },
          lineStyle: seriesType === "line" ? { color: "#10B981", width: 2 } : undefined,
          areaStyle: isArea
            ? {
                color: {
                  type: "linear", x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: "rgba(16,185,129,0.3)" },
                    { offset: 1, color: "rgba(16,185,129,0)" },
                  ],
                },
              }
            : undefined,
        },
        {
          name: "P95",
          type: seriesType,
          smooth: true,
          data: latencyTimelineData.map((d) => d.P95),
          itemStyle: { color: "#F59E0B" },
          lineStyle: seriesType === "line" ? { color: "#F59E0B", width: 2 } : undefined,
          areaStyle: isArea
            ? {
                color: {
                  type: "linear", x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: "rgba(245,158,11,0.3)" },
                    { offset: 1, color: "rgba(245,158,11,0)" },
                  ],
                },
              }
            : undefined,
        },
      ],
    };
  };

  const getTopUsersOption = () => {
    if (!topUsers || topUsers.length === 0) return {};
    const slice = topUsers.slice(0, 10);
    const userIds = slice.map((d) => d.userId);
    const successCounts = slice.map((d) => d.successCount);
    const failedCounts = slice.map((d) => d.failedCount);
    return {
      tooltip: { trigger: "axis", ...eTooltipStyle },
      legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 11 } },
      grid: { left: 80, right: 20, top: 20, bottom: 50, containLabel: false },
      xAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      yAxis: {
        type: "category",
        data: userIds,
        axisLabel: { color: "#9CA3AF", fontSize: 10, width: 70, overflow: "truncate" },
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
      },
      series: [
        {
          name: "Success",
          type: "bar",
          stack: "a",
          data: successCounts,
          itemStyle: { color: "#10B981" },
        },
        {
          name: "Failed",
          type: "bar",
          stack: "a",
          data: failedCounts,
          itemStyle: { color: "#EF4444" },
          barMaxWidth: 40,
        },
      ],
    };
  };

  const getAmountDistributionOption = () => {
    if (!amountDistribution || amountDistribution.length === 0) return {};
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) => `${p[0].axisValue}<br/>${p[0].value.toLocaleString()} Transactions`,
      },
      grid: eGrid,
      xAxis: {
        type: "category",
        data: amountDistribution.map((d) => d.range),
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Transactions",
          type: "bar",
          data: amountDistribution.map((d, i) => ({
            value: d.count,
            itemStyle: { color: amountColors[i % amountColors.length] },
          })),
          barMaxWidth: 60,
        },
      ],
    };
  };

  const getFunnelOption = () => {
    if (funnelData.length === 0) return {};
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c}" },
      series: [
        {
          type: "funnel",
          left: "10%",
          width: "80%",
          data: funnelData.map((d, i) => ({
            value: d.value,
            name: d.name,
            itemStyle: { color: ["#6366F1", "#3B82F6", "#10B981"][i] },
          })),
          label: { color: "#374151", fontSize: 11 },
        },
      ],
    };
  };

  const getGaugeOption = () => {
    return {
      series: [
        {
          type: "gauge",
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: "80%",
          data: [{ value: successRate, name: "Success Rate" }],
          pointer: { show: false },
          progress: {
            show: true,
            width: 18,
            roundCap: true,
            itemStyle: { color: gaugeColor },
          },
          axisLine: { lineStyle: { width: 18, color: [[1, "#F3F4F6"]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          detail: { show: false },
        },
      ],
    };
  };

  const getSuccessRateTrendOption = () => {
    if (!eventTypesData) return {};
    const times = eventTypesData.map((d) => d.time);
    const srData = eventTypesData.map((d) => d["Success Rate"] ?? 0);
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) => `${p[0].axisValue}<br/>${(p[0].value as number).toFixed(1)}% Success Rate`,
      },
      grid: eGrid,
      xAxis: {
        type: "category",
        data: times,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: "#9CA3AF", fontSize: 11, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Success Rate",
          type: "line",
          smooth: true,
          data: srData,
          itemStyle: { color: "#10B981" },
          lineStyle: { color: "#10B981", width: 2 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(16,185,129,0.3)" },
                { offset: 1, color: "rgba(16,185,129,0)" },
              ],
            },
          },
        },
      ],
    };
  };

  const getScatterOption = () => {
    if (filteredScatter.length === 0) return {};
    const statuses = activeStatus ? [activeStatus] : ["success", "failed", "pending"];
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: any) =>
          `${p.seriesName}<br/>Amount: ${(p.value[0] / 1000).toFixed(0)}K<br/>Latency: ${p.value[1]}ms`,
      },
      legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 11 } },
      grid: { ...eGrid, bottom: 50 },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#9CA3AF",
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`,
        },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 10, formatter: (v: number) => `${v}ms` },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: statuses.map((s) => ({
        name: s,
        type: "scatter",
        symbolSize: 8,
        opacity: 0.7,
        data: filteredScatter.filter((d) => d.status === s).map((d) => [d.amount, d.latency]),
        itemStyle: { color: scatterColors[s] },
      })),
    };
  };

  const getRevenueByTypeOption = () => {
    if (filteredRevenueByType.length === 0) return {};
    const eventTypes = filteredRevenueByType.map((d) => d.eventType);
    const revenues = filteredRevenueByType.map((d) => d.revenue);
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) =>
          `${p[0].axisValue.replace(/_/g, " ")}<br/>${(p[0].value / 1000000).toFixed(2)}M VND`,
      },
      grid: { left: 120, right: 20, top: 20, bottom: 30, containLabel: false },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#9CA3AF",
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`,
        },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      yAxis: {
        type: "category",
        data: eventTypes,
        axisLabel: {
          color: "#9CA3AF",
          fontSize: 10,
          formatter: (v: string) => v.replace(/_/g, " "),
        },
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
      },
      series: [
        {
          name: "Revenue",
          type: "bar",
          data: revenues.map((v, i) => ({
            value: v,
            itemStyle: {
              color: treemapColors[filteredRevenueByType[i].eventType.replace(/_/g, " ")] || "#94A3B8",
            },
          })),
          barMaxWidth: 40,
        },
      ],
    };
  };

  const getHeatmapOption = () => {
    if (heatmapGrid.length === 0) return {};
    const hours = heatmapGrid.map((d) => d.hour);
    const eventTypeDefs = [
      { key: "order_created", name: "Order Created", color: "#6366F1" },
      { key: "payment_initiated", name: "Payment Initiated", color: "#3B82F6" },
      { key: "payment_success", name: "Payment Success", color: "#10B981" },
      { key: "payment_failed", name: "Payment Failed", color: "#EF4444" },
      { key: "order_cancelled", name: "Order Cancelled", color: "#F59E0B" },
    ].filter((s) => !activeEventType || activeEventType === s.key);

    return {
      tooltip: { trigger: "axis", ...eTooltipStyle },
      legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 10 } },
      grid: { ...eGrid, bottom: 50 },
      xAxis: {
        type: "category",
        data: hours,
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: eventTypeDefs.map((s) => ({
        name: s.name,
        type: "bar",
        stack: "a",
        data: heatmapGrid.map((row) => row[s.key] ?? 0),
        itemStyle: { color: s.color },
      })),
    };
  };

  const getCategoryOption = () => {
    if (!categoryStats || categoryStats.length === 0) return {};
    const categories = categoryStats.map((d) => d.category);
    const revenues = categoryStats.map((d) => d.revenue);
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) =>
          `${p[0].axisValue}<br/>${(p[0].value / 1000000).toFixed(2)}M VND`,
      },
      grid: { left: 90, right: 20, top: 20, bottom: 30, containLabel: false },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#9CA3AF",
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`,
        },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
      },
      series: [
        {
          name: "Revenue",
          type: "bar",
          data: revenues.map((v, i) => ({
            value: v,
            itemStyle: { color: categoryColors[categoryStats[i].category] || "#94A3B8" },
          })),
          barMaxWidth: 40,
        },
      ],
    };
  };

  const getRegionOption = () => {
    if (!regionStats || regionStats.length === 0) return {};
    const regionColors = ["#6366F1", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#A855F7", "#EC4899", "#14B8A6", "#94A3B8"];
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) => `${p[0].axisValue}<br/>${p[0].value.toLocaleString()} Orders`,
      },
      grid: eGrid,
      xAxis: {
        type: "category",
        data: regionStats.map((d) => d.region),
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Orders",
          type: "bar",
          data: regionStats.map((d, i) => ({
            value: d.count,
            itemStyle: { color: regionColors[i % regionColors.length] },
          })),
          barMaxWidth: 50,
        },
      ],
    };
  };

  const getPaymentOption = () => {
    if (!paymentStats || paymentStats.length === 0) return {};
    return {
      tooltip: {
        trigger: "axis",
        ...eTooltipStyle,
        formatter: (p: any[]) =>
          `${p[0].axisValue.replace(/_/g, " ")}<br/>${p[0].value.toLocaleString()} Transactions`,
      },
      grid: eGrid,
      xAxis: {
        type: "category",
        data: paymentStats.map((d) => d.paymentMethod),
        axisLine: { lineStyle: { color: "#9CA3AF" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#9CA3AF",
          fontSize: 11,
          formatter: (v: string) => v.replace(/_/g, " "),
        },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9CA3AF", fontSize: 11 },
        splitLine: { lineStyle: { color: "#F3F4F6" } },
      },
      series: [
        {
          name: "Transactions",
          type: "bar",
          data: paymentStats.map((d) => ({
            value: d.count,
            itemStyle: { color: paymentColors[d.paymentMethod] || "#94A3B8" },
          })),
          barMaxWidth: 60,
        },
      ],
    };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Click any chart element to drill down into details</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white rounded-lg border border-gray-200 p-1">
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => drillTime(option.value)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  timeRange === option.value ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              autoRefresh ? "bg-success text-white border-success" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <RefreshCw size={16} className={autoRefresh ? "animate-spin" : ""} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
        </div>
      </div>

      {/* ── Drill-down Breadcrumb Bar ── */}
      {drillFilters.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-sm text-blue-700 font-medium">
            <ZoomIn size={16} /> Drill-down:
          </div>
          <div className="flex items-center gap-1 text-sm text-blue-600">
            <span>Overview</span>
            {drillFilters.map((f) => (
              <span key={f.key} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-blue-400" />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 rounded-full text-xs font-medium">
                  {f.label}
                  <button onClick={() => removeDrill(f.key)} className="hover:text-blue-900">
                    <X size={12} />
                  </button>
                </span>
              </span>
            ))}
          </div>
          <button
            onClick={clearDrills}
            className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            <ArrowLeft size={14} /> Back to Overview
          </button>
        </div>
      )}

      {/* Pipeline Throughput Banner */}
      {metrics && (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-5 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="flex items-center gap-2 text-blue-200 text-sm mb-1"><Zap size={14} /> Processing Rate</div>
              <div className="text-3xl font-bold">{metrics.processedEventsPerSec.toLocaleString()}</div>
              <div className="text-blue-200 text-xs">events/sec</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-blue-200 text-sm mb-1"><Gauge size={14} /> Kafka Lag</div>
              <div className="text-3xl font-bold">{metrics.kafkaLag.toLocaleString()}</div>
              <div className="text-blue-200 text-xs">messages behind</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-blue-200 text-sm mb-1"><Timer size={14} /> Latency P50</div>
              <div className="text-3xl font-bold">{traceStats?.p50 != null ? `${traceStats.p50}` : "—"}</div>
              <div className="text-blue-200 text-xs">ms end-to-end</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-blue-200 text-sm mb-1"><Timer size={14} /> Latency P95</div>
              <div className="text-3xl font-bold">{traceStats?.p95 != null ? `${traceStats.p95}` : "—"}</div>
              <div className="text-blue-200 text-xs">ms end-to-end</div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards — clickable drill-down */}
      {kpiLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-32"><LoadingSpinner size="sm" /></div>
          ))}
        </div>
      ) : kpiError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">Error loading KPIs.</div>
      ) : kpi ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title="Revenue" value={`${(kpi.revenue / 1000000).toFixed(2)}M`} subtitle="VND" icon={<DollarSign size={24} />} color="success" trend="up" onClick={() => goToEvents({})} />
          <KPICard title="Total Events" value={kpi.totalEvents.toLocaleString()} subtitle="processed" icon={<Activity size={24} />} color="primary" onClick={() => { clearDrills(); }} />
          <KPICard title="Success" value={kpi.paymentSuccess.toLocaleString()} icon={<CheckCircle size={24} />} color="success" onClick={() => drillStatus("success")} />
          <KPICard title="Pending" value={kpi.pending.toLocaleString()} icon={<Clock size={24} />} color="warning" onClick={() => drillStatus("pending")} />
          <KPICard title="Failed" value={kpi.totalFailed.toLocaleString()} icon={<XCircle size={24} />} color="danger" onClick={() => drillStatus("failed")} />
          <KPICard title="Success Rate" value={`${kpi.successRate.toFixed(1)}%`} icon={<TrendingUp size={24} />} color={kpi.successRate >= 80 ? "success" : kpi.successRate >= 60 ? "warning" : "danger"} onClick={() => drillEventType("payment_success")} />
        </div>
      ) : null}

      {/* ── Drill-down Detail Panel ── */}
      {drillDetail && drillEvents && (
        <div className="bg-white rounded-lg shadow-md border-2 border-blue-200 p-6 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <ZoomIn size={20} className="text-blue-500" /> {drillDetail.title}
              <span className="text-sm font-normal text-gray-500">— {drillEvents.total.toLocaleString()} events</span>
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => goToEvents({
                  ...(drillDetail.type === "eventType" && { eventType: drillDetail.value }),
                  ...(drillDetail.type === "status" && { status: drillDetail.value }),
                  ...(drillDetail.type === "user" && { search: drillDetail.value }),
                })}
                className="text-sm text-primary hover:text-blue-700 font-medium"
              >
                View all in Events →
              </button>
              <button onClick={() => setDrillDetail(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
          </div>
          {/* Mini summary cards */}
          {drillEvents.statusCounts && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-green-300" onClick={() => drillStatus("success")}>
                <div className="text-xl font-bold text-green-700">{drillEvents.statusCounts.success?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-green-600">Success</div>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-yellow-300" onClick={() => drillStatus("pending")}>
                <div className="text-xl font-bold text-yellow-700">{drillEvents.statusCounts.pending?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-yellow-600">Pending</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-red-300" onClick={() => drillStatus("failed")}>
                <div className="text-xl font-bold text-red-700">{drillEvents.statusCounts.failed?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-red-600">Failed</div>
              </div>
            </div>
          )}
          {/* Events table preview */}
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Time</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">User</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600">Amount</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {drillEvents.events.slice(0, 20).map((e) => (
                  <tr key={e.id} className="hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => {
                      if (drillDetail.type !== "user") drillUser(e.userId);
                    }}
                  >
                    <td className="py-2 px-3 text-gray-700">{format(new Date(e.eventTime), "HH:mm:ss")}</td>
                    <td className="py-2 px-3">
                      <button
                        onClick={(ev) => { ev.stopPropagation(); drillEventType(e.eventType); }}
                        className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                      >
                        {e.eventType.replace(/_/g, " ")}
                      </button>
                    </td>
                    <td className="py-2 px-3 font-mono text-gray-600 text-xs">{e.userId}</td>
                    <td className="py-2 px-3 text-right font-medium">{e.amount.toLocaleString()} {e.currency}</td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={(ev) => { ev.stopPropagation(); drillStatus(e.status); }}
                        className={`text-xs px-2 py-0.5 rounded ${
                          e.status === "success" ? "bg-green-50 text-green-700" : e.status === "failed" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"
                        } hover:opacity-80`}
                      >
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

      {/* Charts Row 1: Revenue + Payment Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Revenue Over Time</h3>
            <ChartToggle value={revenueChart} onChange={setRevenueChart} />
          </div>
          {timeSeriesLoading ? (
            <div className="h-[300px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          ) : revenueChartData ? (
            <ReactECharts option={getRevenueOption()} style={{ height: 300 }} notMerge={true} />
          ) : null}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Payment Status</h3>
            <ChartToggle value={ordersChart} onChange={setOrdersChart} />
          </div>
          {timeSeriesLoading ? (
            <div className="h-[300px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          ) : ordersChartData ? (
            <ReactECharts
              option={getOrdersOption()}
              style={{ height: 300 }}
              notMerge={true}
              onEvents={{
                click: (params: any) => {
                  if (params.seriesName === "Success") drillStatus("success");
                  else if (params.seriesName === "Failed") drillStatus("failed");
                },
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Row 2: Pie + Latency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Event Distribution — click to drill">
          {pieData.length > 0 ? (
            <ReactECharts
              option={getPieOption()}
              style={{ height: 280 }}
              notMerge={true}
              onEvents={{
                click: (params: any) => {
                  if (params.data?.status) drillStatus(params.data.status);
                },
              }}
            />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </Card>

        <Card title="Pipeline Latency" className="lg:col-span-2">
          {traceStats ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-green-50 rounded-lg p-4"><div className="text-2xl font-bold text-green-700">{traceStats.p50 ?? "—"}<span className="text-sm font-normal ml-1">ms</span></div><div className="text-xs text-green-600 mt-1">P50</div></div>
                <div className="bg-yellow-50 rounded-lg p-4"><div className="text-2xl font-bold text-yellow-700">{traceStats.p95 ?? "—"}<span className="text-sm font-normal ml-1">ms</span></div><div className="text-xs text-yellow-600 mt-1">P95</div></div>
                <div className="bg-red-50 rounded-lg p-4"><div className="text-2xl font-bold text-red-700">{traceStats.p99 ?? "—"}<span className="text-sm font-normal ml-1">ms</span></div><div className="text-xs text-red-600 mt-1">P99</div></div>
              </div>
              <div className="space-y-3">
                <LatencyBar label="Generator → Kafka" value={traceStats.avgGenToKafkaMs} color="bg-blue-500" max={Math.max(traceStats.avgGenToKafkaMs ?? 0, traceStats.avgKafkaToSparkMs ?? 0, traceStats.avgSparkToDbMs ?? 0)} />
                <LatencyBar label="Kafka → Spark" value={traceStats.avgKafkaToSparkMs} color="bg-orange-500" max={Math.max(traceStats.avgGenToKafkaMs ?? 0, traceStats.avgKafkaToSparkMs ?? 0, traceStats.avgSparkToDbMs ?? 0)} />
                <LatencyBar label="Spark → PostgreSQL" value={traceStats.avgSparkToDbMs} color="bg-purple-500" max={Math.max(traceStats.avgGenToKafkaMs ?? 0, traceStats.avgKafkaToSparkMs ?? 0, traceStats.avgSparkToDbMs ?? 0)} />
              </div>
              <div className="text-xs text-gray-400 text-center">Based on {traceStats.count.toLocaleString()} traced events</div>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          )}
        </Card>
      </div>

      {/* Row 3: Event Types + Latency Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Layers size={18} className="text-indigo-500" /> Event Types {activeEventType && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{activeEventType.replace(/_/g, " ")}</span>}
            </h3>
            <ChartToggle value={eventTypesChart} onChange={setEventTypesChart} />
          </div>
          {eventTypesData ? (
            <ReactECharts
              option={getEventTypesOption()}
              style={{ height: 300 }}
              notMerge={true}
              onEvents={{
                legendselectchanged: (params: any) => {
                  const map: Record<string, string> = {
                    "Orders Created": "order_created",
                    "Payment Initiated": "payment_initiated",
                    "Payment Success": "payment_success",
                    "Payment Failed": "payment_failed",
                    "Order Cancelled": "order_cancelled",
                  };
                  const name = params.name as string;
                  if (map[name]) drillEventType(map[name]);
                },
              }}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Timer size={18} className="text-orange-500" /> Latency Trend</h3>
            <ChartToggle value={latencyChart} onChange={setLatencyChart} />
          </div>
          {latencyTimelineData ? (
            <ReactECharts option={getLatencyOption()} style={{ height: 300 }} notMerge={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          )}
        </div>
      </div>

      {/* Row 4: Top Users + Amount Distribution — clickable drill */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4"><Users size={18} className="text-blue-500" /> Top Users — click to drill</h3>
          {topUsers && topUsers.length > 0 ? (
            <ReactECharts
              option={getTopUsersOption()}
              style={{ height: 300 }}
              notMerge={true}
              onEvents={{
                click: (params: any) => {
                  if (params.name) drillUser(params.name);
                },
              }}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4"><DollarSign size={18} className="text-green-500" /> Amount Distribution</h3>
          {amountDistribution && amountDistribution.length > 0 ? (
            <ReactECharts option={getAmountDistributionOption()} style={{ height: 300 }} notMerge={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>
      </div>

      {/* Row 5: Funnel + Gauge + Success Rate Trend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversion Funnel</h3>
          {funnelData.length > 0 ? (
            <>
              <ReactECharts option={getFunnelOption()} style={{ height: 250 }} notMerge={true} />
              {kpi && <div className="text-center text-xs text-gray-500">Conversion: {((kpi.paymentSuccess / kpi.totalEvents) * 100).toFixed(1)}%</div>}
            </>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Success Rate</h3>
          {kpi ? (
            <div className="relative">
              <ReactECharts option={getGaugeOption()} style={{ height: 220 }} notMerge={true} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className={`text-4xl font-bold ${kpi.successRate >= 80 ? "text-green-600" : kpi.successRate >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                  {kpi.successRate.toFixed(1)}%
                </span>
                <span className="text-xs text-gray-500 mt-1">payments successful</span>
              </div>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Success Rate Trend</h3>
          {eventTypesData ? (
            <ReactECharts option={getSuccessRateTrendOption()} style={{ height: 280 }} notMerge={true} />
          ) : (
            <div className="h-[280px] flex items-center justify-center"><LoadingSpinner size="sm" /></div>
          )}
        </div>
      </div>

      {/* Row 6: Scatter + Revenue by Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Amount vs Latency {activeStatus && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">{activeStatus}</span>}</h3>
          <p className="text-xs text-gray-500 mb-4">Click dots to drill by status</p>
          {filteredScatter.length > 0 ? (
            <ReactECharts
              option={getScatterOption()}
              style={{ height: 300 }}
              notMerge={true}
              onEvents={{
                click: (params: any) => {
                  if (params.seriesName) drillStatus(params.seriesName);
                },
              }}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No trace data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Revenue by Event Type — click to drill</h3>
          <p className="text-xs text-gray-500 mb-4">Click a bar to filter all charts</p>
          {filteredRevenueByType.length > 0 ? (
            <ReactECharts
              option={getRevenueByTypeOption()}
              style={{ height: 300 }}
              notMerge={true}
              onEvents={{
                click: (params: any) => {
                  if (params.name) drillEventType(params.name);
                },
              }}
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>
      </div>

      {/* Row 7: Heatmap */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Event Heatmap by Hour {activeEventType && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-2">{activeEventType.replace(/_/g, " ")}</span>}</h3>
        <p className="text-xs text-gray-500 mb-4">Filtered by active drill-down</p>
        {heatmapGrid.length > 0 ? (
          <ReactECharts option={getHeatmapOption()} style={{ height: 300 }} notMerge={true} />
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
        )}
      </div>

      {/* Row 8: Category Revenue + Region Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <ShoppingBag size={18} className="text-indigo-500" /> Revenue by Category
          </h3>
          {categoryStats && categoryStats.length > 0 ? (
            <ReactECharts option={getCategoryOption()} style={{ height: 300 }} notMerge={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Globe size={18} className="text-blue-500" /> Orders by Region
          </h3>
          {regionStats && regionStats.length > 0 ? (
            <ReactECharts option={getRegionOption()} style={{ height: 300 }} notMerge={true} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>
      </div>

      {/* Row 9: Payment Methods + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <CreditCard size={18} className="text-green-500" /> Payment Method Success Rate
          </h3>
          {paymentStats && paymentStats.length > 0 ? (
            <div className="space-y-4">
              <ReactECharts option={getPaymentOption()} style={{ height: 220 }} notMerge={true} />
              <div className="grid grid-cols-2 gap-2">
                {paymentStats.map((p) => (
                  <div key={p.paymentMethod} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs font-medium text-gray-700" style={{ color: paymentColors[p.paymentMethod] }}>
                      {p.paymentMethod.replace(/_/g, " ")}
                    </span>
                    <span className={`text-xs font-bold ${p.successRate >= 80 ? "text-green-600" : p.successRate >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                      {p.successRate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Package size={18} className="text-orange-500" /> Top Products by Revenue
          </h3>
          {topProducts && topProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">#</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Product</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Category</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Orders</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topProducts.map((p, i) => (
                    <tr key={p.productId} className="hover:bg-gray-50">
                      <td className="py-2 px-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-2 px-2">
                        <div className="font-medium text-gray-800 text-xs">{p.productName}</div>
                        <div className="text-gray-400 text-[10px]">{p.productId}</div>
                      </td>
                      <td className="py-2 px-2">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: (categoryColors[p.category] || "#94A3B8") + "20", color: categoryColors[p.category] || "#94A3B8" }}>
                          {p.category}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-gray-700">{p.orderCount.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-xs font-semibold text-gray-900">{(p.revenue / 1000000).toFixed(1)}M</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>
      </div>

      {/* Status */}
      <div className={`rounded-lg p-4 ${USE_MOCK ? "bg-yellow-50 border border-yellow-300" : "bg-green-50 border border-green-200"}`}>
        <div className="flex items-center gap-3">
          <div className={USE_MOCK ? "text-yellow-600" : "text-green-600"}>{USE_MOCK ? "⚠️" : "✅"}</div>
          <div className="text-sm">
            <span className="font-medium">{USE_MOCK ? "Mock Data Mode" : "Live Data Mode"}</span>
            <span className="text-gray-600 ml-2">{USE_MOCK ? "Showing simulated data" : "Connected to pipeline — real-time from PostgreSQL"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LatencyBar({ label, value, color, max }: { label: string; value: number | null; color: string; max: number }) {
  const pct = value != null && max > 0 ? Math.max(5, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-gray-600 text-right">{label}</div>
      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2`} style={{ width: `${pct}%` }}>
          {value != null && <span className="text-[10px] text-white font-medium">{value}ms</span>}
        </div>
      </div>
    </div>
  );
}
