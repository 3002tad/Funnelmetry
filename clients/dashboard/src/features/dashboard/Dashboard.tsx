import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, TimeRange, USE_MOCK } from "@/lib/api";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  RadialBarChart,
  RadialBar,
  FunnelChart,
  Funnel,
  LabelList,
} from "recharts";
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
      // Replace existing filter of same key or add new
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
        { name: "Orders Created", value: kpi.totalEvents, fill: "#6366F1" },
        { name: "Payment Initiated", value: kpi.pending + kpi.paymentSuccess + kpi.totalFailed, fill: "#3B82F6" },
        { name: "Payment Success", value: kpi.paymentSuccess, fill: "#10B981" },
      ].filter((d) => d.value > 0)
    : [];

  const gaugeData = kpi
    ? [{ name: "Success Rate", value: kpi.successRate, fill: kpi.successRate >= 80 ? "#10B981" : kpi.successRate >= 60 ? "#F59E0B" : "#EF4444" }]
    : [];

  const treemapColors: Record<string, string> = {
    "order created": "#6366F1",
    "payment initiated": "#3B82F6",
    "payment success": "#10B981",
    "payment failed": "#EF4444",
    "order cancelled": "#F59E0B",
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

  // Dim pie slices that aren't selected
  const pieColors = pieData.map((d) => {
    const base = d.status === "success" ? "#10B981" : d.status === "pending" ? "#F59E0B" : "#EF4444";
    if (activeStatus && d.status !== activeStatus) return base + "40"; // dimmed
    return base;
  });

  const cs = {
    grid: "#F3F4F6",
    axis: "#9CA3AF",
    tooltip: { backgroundColor: "#FFF", border: "1px solid #E5E7EB", borderRadius: "8px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" },
  };

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
            <ResponsiveContainer width="100%" height={300}>
              {revenueChart === "area" ? (
                <AreaChart data={revenueChartData}>
                  <defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${(v / 1000).toFixed(0)}K VND`, "Revenue"]} />
                  <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              ) : revenueChart === "line" ? (
                <LineChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${(v / 1000).toFixed(0)}K VND`, "Revenue"]} />
                  <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              ) : (
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${(v / 1000).toFixed(0)}K VND`, "Revenue"]} />
                  <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              {ordersChart === "bar" ? (
                <BarChart data={ordersChartData} onClick={(state) => { if (state?.activeTooltipIndex != null) { /* time drill possible */ } }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend />
                  <Bar dataKey="success" fill={activeStatus && activeStatus !== "success" ? "#10B98140" : "#10B981"} name="Success" stackId="a" cursor="pointer" onClick={() => drillStatus("success")} />
                  <Bar dataKey="failed" fill={activeStatus && activeStatus !== "failed" ? "#EF444440" : "#EF4444"} name="Failed" stackId="a" radius={[4, 4, 0, 0]} cursor="pointer" onClick={() => drillStatus("failed")} />
                </BarChart>
              ) : ordersChart === "line" ? (
                <LineChart data={ordersChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend />
                  <Line type="monotone" dataKey="success" stroke="#10B981" strokeWidth={2} name="Success" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="failed" stroke="#EF4444" strokeWidth={2} name="Failed" dot={{ r: 2 }} />
                </LineChart>
              ) : (
                <AreaChart data={ordersChartData}>
                  <defs>
                    <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
                    <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#EF4444" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend />
                  <Area type="monotone" dataKey="success" stroke="#10B981" fill="url(#successGrad)" name="Success" />
                  <Area type="monotone" dataKey="failed" stroke="#EF4444" fill="url(#failedGrad)" name="Failed" />
                </AreaChart>
              )}
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>

      {/* Row 2: Pie + Latency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Event Distribution — click to drill">
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} cursor="pointer"
                  onClick={(_, index) => drillStatus(pieData[index].status)}
                >
                  {pieData.map((_, index) => (<Cell key={index} fill={pieColors[index]} stroke={activeStatus === pieData[index].status ? "#1D4ED8" : "none"} strokeWidth={activeStatus === pieData[index].status ? 3 : 0} />))}
                </Pie>
                <Tooltip formatter={(value: number) => [value.toLocaleString(), "Events"]} />
              </PieChart>
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              {eventTypesChart === "area" ? (
                <AreaChart data={eventTypesData}>
                  <defs>
                    <linearGradient id="ocGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366F1" stopOpacity={0.4}/><stop offset="95%" stopColor="#6366F1" stopOpacity={0}/></linearGradient>
                    <linearGradient id="piGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                    <linearGradient id="psGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
                    <linearGradient id="pfGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/></linearGradient>
                    <linearGradient id="ocnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4}/><stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend onClick={(e) => { if (typeof e.value === "string") { const map: Record<string, string> = { "Orders Created": "order_created", "Payment Initiated": "payment_initiated", "Payment Success": "payment_success", "Payment Failed": "payment_failed", "Order Cancelled": "order_cancelled" }; if (map[e.value]) drillEventType(map[e.value]); }}} />
                  {(!activeEventType || activeEventType === "order_created") && <Area type="monotone" dataKey="Orders Created" stroke="#6366F1" fill="url(#ocGrad)" stackId="1" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_initiated") && <Area type="monotone" dataKey="Payment Initiated" stroke="#3B82F6" fill="url(#piGrad)" stackId="1" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_success") && <Area type="monotone" dataKey="Payment Success" stroke="#10B981" fill="url(#psGrad)" stackId="1" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_failed") && <Area type="monotone" dataKey="Payment Failed" stroke="#EF4444" fill="url(#pfGrad)" stackId="1" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "order_cancelled") && <Area type="monotone" dataKey="Order Cancelled" stroke="#F59E0B" fill="url(#ocnGrad)" stackId="1" cursor="pointer" />}
                </AreaChart>
              ) : eventTypesChart === "line" ? (
                <LineChart data={eventTypesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend onClick={(e) => { if (typeof e.value === "string") { const map: Record<string, string> = { "Orders Created": "order_created", "Payment Initiated": "payment_initiated", "Payment Success": "payment_success", "Payment Failed": "payment_failed", "Order Cancelled": "order_cancelled" }; if (map[e.value]) drillEventType(map[e.value]); }}} />
                  {(!activeEventType || activeEventType === "order_created") && <Line type="monotone" dataKey="Orders Created" stroke="#6366F1" strokeWidth={2} dot={{ r: 2 }} />}
                  {(!activeEventType || activeEventType === "payment_initiated") && <Line type="monotone" dataKey="Payment Initiated" stroke="#3B82F6" strokeWidth={2} dot={{ r: 2 }} />}
                  {(!activeEventType || activeEventType === "payment_success") && <Line type="monotone" dataKey="Payment Success" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} />}
                  {(!activeEventType || activeEventType === "payment_failed") && <Line type="monotone" dataKey="Payment Failed" stroke="#EF4444" strokeWidth={2} dot={{ r: 2 }} />}
                  {(!activeEventType || activeEventType === "order_cancelled") && <Line type="monotone" dataKey="Order Cancelled" stroke="#F59E0B" strokeWidth={2} dot={{ r: 2 }} />}
                </LineChart>
              ) : (
                <BarChart data={eventTypesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                  <Tooltip contentStyle={cs.tooltip} /><Legend onClick={(e) => { if (typeof e.value === "string") { const map: Record<string, string> = { "Orders Created": "order_created", "Payment Initiated": "payment_initiated", "Payment Success": "payment_success", "Payment Failed": "payment_failed", "Order Cancelled": "order_cancelled" }; if (map[e.value]) drillEventType(map[e.value]); }}} />
                  {(!activeEventType || activeEventType === "order_created") && <Bar dataKey="Orders Created" fill="#6366F1" stackId="a" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_initiated") && <Bar dataKey="Payment Initiated" fill="#3B82F6" stackId="a" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_success") && <Bar dataKey="Payment Success" fill="#10B981" stackId="a" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "payment_failed") && <Bar dataKey="Payment Failed" fill="#EF4444" stackId="a" cursor="pointer" />}
                  {(!activeEventType || activeEventType === "order_cancelled") && <Bar dataKey="Order Cancelled" fill="#F59E0B" stackId="a" radius={[4, 4, 0, 0]} cursor="pointer" />}
                </BarChart>
              )}
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              {latencyChart === "line" ? (
                <LineChart data={latencyTimelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} unit="ms" />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${v}ms`]} /><Legend />
                  <Line type="monotone" dataKey="P50" stroke="#10B981" strokeWidth={2} dot={{ r: 2 }} /><Line type="monotone" dataKey="P95" stroke="#F59E0B" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              ) : latencyChart === "area" ? (
                <AreaChart data={latencyTimelineData}>
                  <defs><linearGradient id="p50Grad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient><linearGradient id="p95Grad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3}/><stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} unit="ms" />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${v}ms`]} /><Legend />
                  <Area type="monotone" dataKey="P50" stroke="#10B981" fill="url(#p50Grad)" /><Area type="monotone" dataKey="P95" stroke="#F59E0B" fill="url(#p95Grad)" />
                </AreaChart>
              ) : (
                <BarChart data={latencyTimelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} unit="ms" />
                  <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${v}ms`]} /><Legend />
                  <Bar dataKey="P50" fill="#10B981" /><Bar dataKey="P95" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topUsers.slice(0, 10)} layout="vertical" onClick={(state) => { if (state?.activeLabel) drillUser(state.activeLabel); }} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke={cs.axis} />
                <YAxis type="category" dataKey="userId" tick={{ fontSize: 10 }} stroke={cs.axis} width={70} />
                <Tooltip contentStyle={cs.tooltip} formatter={(v: number, name: string) => [v.toLocaleString(), name === "successCount" ? "Success" : "Failed"]} />
                <Legend />
                <Bar dataKey="successCount" name="Success" fill="#10B981" stackId="a" cursor="pointer" />
                <Bar dataKey="failedCount" name="Failed" fill="#EF4444" stackId="a" radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4"><DollarSign size={18} className="text-green-500" /> Amount Distribution</h3>
          {amountDistribution && amountDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={amountDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="range" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
                <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [v.toLocaleString(), "Transactions"]} />
                <Bar dataKey="count" name="Transactions" radius={[4, 4, 0, 0]}>
                  {amountDistribution.map((_, index) => (<Cell key={index} fill={amountColors[index % amountColors.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={250}>
                <FunnelChart><Tooltip formatter={(v: number) => [v.toLocaleString(), "Events"]} contentStyle={cs.tooltip} />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="#374151" stroke="none" dataKey="name" fontSize={11} />
                    <LabelList position="center" fill="#fff" stroke="none" dataKey="value" fontSize={13} fontWeight="bold" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={220}>
                <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" startAngle={210} endAngle={-30} barSize={20} data={gaugeData}>
                  <RadialBar background={{ fill: "#F3F4F6" }} dataKey="value" cornerRadius={10} max={100} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-4xl font-bold ${kpi.successRate >= 80 ? "text-green-600" : kpi.successRate >= 60 ? "text-yellow-600" : "text-red-600"}`}>{kpi.successRate.toFixed(1)}%</span>
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
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={eventTypesData}>
                <defs><linearGradient id="srGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${v.toFixed(1)}%`, "Success Rate"]} />
                <Area type="monotone" dataKey="Success Rate" stroke="#10B981" strokeWidth={2} fill="url(#srGrad)" />
              </AreaChart>
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} />
                <XAxis type="number" dataKey="amount" name="Amount" tick={{ fontSize: 10 }} stroke={cs.axis} tickFormatter={(v: number) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}`} />
                <YAxis type="number" dataKey="latency" name="Latency" tick={{ fontSize: 10 }} stroke={cs.axis} unit="ms" />
                <ZAxis range={[30, 30]} />
                <Tooltip contentStyle={cs.tooltip} formatter={(v: number, name: string) => [name === "Amount" ? `${(v/1000).toFixed(0)}K VND` : `${v}ms`, name]} />
                <Legend />
                {(activeStatus ? [activeStatus] : ["success", "failed", "pending"]).map((status) => (
                  <Scatter key={status} name={status.charAt(0).toUpperCase() + status.slice(1)} data={filteredScatter.filter((d) => d.status === status)} fill={scatterColors[status]} opacity={0.7} cursor="pointer"
                    onClick={() => drillStatus(status)} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No trace data yet</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Revenue by Event Type — click to drill</h3>
          <p className="text-xs text-gray-500 mb-4">Click a bar to filter all charts</p>
          {filteredRevenueByType.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={filteredRevenueByType} layout="vertical" onClick={(state) => { if (state?.activeLabel) drillEventType(state.activeLabel); }} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke={cs.axis} tickFormatter={(v: number) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : `${(v/1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="eventType" tick={{ fontSize: 10 }} stroke={cs.axis} width={110} tickFormatter={(v: string) => v.replace(/_/g, " ")} />
                <Tooltip contentStyle={cs.tooltip} formatter={(v: number) => [`${(v/1000000).toFixed(2)}M VND`, "Revenue"]} labelFormatter={(l: string) => l.replace(/_/g, " ")} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} cursor="pointer">
                  {filteredRevenueByType.map((entry, i) => (<Cell key={i} fill={treemapColors[entry.eventType.replace(/_/g, " ")] || "#94A3B8"} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={heatmapGrid}>
              <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} /><XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke={cs.axis} /><YAxis tick={{ fontSize: 11 }} stroke={cs.axis} />
              <Tooltip contentStyle={cs.tooltip} /><Legend />
              {(!activeEventType || activeEventType === "order_created") && <Bar dataKey="order_created" name="Order Created" fill="#6366F1" stackId="a" />}
              {(!activeEventType || activeEventType === "payment_initiated") && <Bar dataKey="payment_initiated" name="Payment Initiated" fill="#3B82F6" stackId="a" />}
              {(!activeEventType || activeEventType === "payment_success") && <Bar dataKey="payment_success" name="Payment Success" fill="#10B981" stackId="a" />}
              {(!activeEventType || activeEventType === "payment_failed") && <Bar dataKey="payment_failed" name="Payment Failed" fill="#EF4444" stackId="a" />}
              {(!activeEventType || activeEventType === "order_cancelled") && <Bar dataKey="order_cancelled" name="Order Cancelled" fill="#F59E0B" stackId="a" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-gray-400">No data yet</div>
        )}
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
