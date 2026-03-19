import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, TimeRange, USE_MOCK } from "@/lib/api";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  Activity,
  CheckCircle,
  XCircle,
  TrendingUp,
  RefreshCw,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import KPICard from "@/components/ui/KPICard";
import Card from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/EmptyState";

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch KPI data
  const {
    data: kpi,
    isLoading: kpiLoading,
    error: kpiError,
  } = useQuery({
    queryKey: ["kpi", timeRange],
    queryFn: () => api.getKpi(timeRange),
    refetchInterval: autoRefresh ? 2000 : false,
    staleTime: 2000,
    refetchOnWindowFocus: false,
  });

  // Fetch time series data
  const { data: timeSeries, isLoading: timeSeriesLoading } = useQuery({
    queryKey: ["timeseries", timeRange],
    queryFn: () => api.getTimeSeries(timeRange),
    refetchInterval: autoRefresh ? 2000 : false,
    staleTime: 2000,
    refetchOnWindowFocus: false,
  });

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: "15m", label: "Last 15 minutes" },
    { value: "1h", label: "Last 1 hour" },
    { value: "24h", label: "Last 24 hours" },
  ];

  // Format data for charts
  const revenueChartData = timeSeries?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    revenue: d.revenue,
  }));

  const ordersChartData = timeSeries?.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    success: d.paymentSuccess,
    failed: d.paymentFailed,
  }));

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Business Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time e-commerce metrics and KPIs
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex bg-white rounded-lg border border-gray-200 p-1">
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  timeRange === option.value
                    ? "bg-primary text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              autoRefresh
                ? "bg-success text-white border-success"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <RefreshCw
              size={16}
              className={autoRefresh ? "animate-spin" : ""}
            />
            Auto Refresh {autoRefresh ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {kpiLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 h-32"
            >
              <LoadingSpinner size="sm" />
            </div>
          ))}
        </div>
      ) : kpiError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error loading KPIs. Please try again.
        </div>
      ) : kpi ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="Total Revenue"
            value={`${(kpi.revenue / 1000000).toFixed(2)}M`}
            subtitle="VND"
            icon={<DollarSign size={24} />}
            color="success"
            trend="up"
          />
          <KPICard
            title="Total Events"
            value={kpi.totalEvents.toLocaleString()}
            subtitle="processed"
            icon={<Activity size={24} />}
            color="primary"
          />
          <KPICard
            title="Payment Success"
            value={kpi.paymentSuccess.toLocaleString()}
            subtitle="success"
            icon={<CheckCircle size={24} />}
            color="success"
          />
          <KPICard
            title="Pending"
            value={kpi.pending.toLocaleString()}
            subtitle="pending"
            icon={<Clock size={24} />}
            color="warning"
          />
          <KPICard
            title="Failed"
            value={kpi.totalFailed.toLocaleString()}
            subtitle="failed"
            icon={<XCircle size={24} />}
            color="danger"
          />
          <KPICard
            title="Success Rate"
            value={`${kpi.successRate.toFixed(1)}%`}
            subtitle="conversion"
            icon={<TrendingUp size={24} />}
            color="warning"
          />
        </div>
      ) : null}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card title="Revenue Over Time" loading={timeSeriesLoading}>
          {revenueChartData && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12 }}
                  stroke="#6B7280"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#6B7280" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFF",
                    border: "1px solid #E5E7EB",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [
                    `${(value / 1000).toFixed(0)}K VND`,
                    "Revenue",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  name="Revenue"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Orders Status Chart */}
        <Card title="Orders by Payment Status" loading={timeSeriesLoading}>
          {ordersChartData && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={ordersChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12 }}
                  stroke="#6B7280"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#6B7280" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FFF",
                    border: "1px solid #E5E7EB",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="success"
                  fill="#10B981"
                  name="Success"
                  stackId="a"
                />
                <Bar
                  dataKey="failed"
                  fill="#EF4444"
                  name="Failed"
                  stackId="a"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Info Banner */}
      {USE_MOCK ? (
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-yellow-600 mt-0.5">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-medium text-yellow-900 mb-1">
                Mock Data Mode
              </h4>
              <p className="text-sm text-yellow-700">
                Đang hiển thị dữ liệu giả lập. Set{" "}
                <code className="bg-yellow-100 px-1 rounded">
                  VITE_USE_MOCK=false
                </code>{" "}
                trong Dockerfile để kết nối API thật.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-green-600 mt-0.5">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-medium text-green-900 mb-1">
                Live Data Mode
              </h4>
              <p className="text-sm text-green-700">
                Đang kết nối trực tiếp với PostgreSQL — dữ liệu realtime từ
                pipeline.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
