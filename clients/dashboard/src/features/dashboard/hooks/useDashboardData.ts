import { useQuery } from "@tanstack/react-query";
import { api, TimeRange } from "@/lib/api";

export function useDashboardData(timeRange: TimeRange, autoRefresh: boolean) {
  const kpi = useQuery({
    queryKey: ["kpi", timeRange],
    queryFn: () => api.getKpi(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const timeSeries = useQuery({
    queryKey: ["timeseries", timeRange],
    queryFn: () => api.getTimeSeries(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const metrics = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.getSystemMetrics(),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const traceStats = useQuery({
    queryKey: ["traceStats", timeRange],
    queryFn: () => api.getTraceStats(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const fullTimeSeries = useQuery({
    queryKey: ["fullTimeSeries", timeRange],
    queryFn: () => api.getFullTimeSeries(timeRange),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const topUsers = useQuery({
    queryKey: ["topUsers", timeRange],
    queryFn: () => api.getTopUsers(timeRange, 10),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const amountDistribution = useQuery({
    queryKey: ["amountDistribution", timeRange],
    queryFn: () => api.getAmountDistribution(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const latencyTimeline = useQuery({
    queryKey: ["latencyTimeline", timeRange],
    queryFn: () => api.getLatencyTimeline(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const scatterData = useQuery({
    queryKey: ["scatter", timeRange],
    queryFn: () => api.getScatterData(timeRange, 200),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const revenueByType = useQuery({
    queryKey: ["revenueByType", timeRange],
    queryFn: () => api.getRevenueByType(timeRange),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const heatmapData = useQuery({
    queryKey: ["heatmap", timeRange],
    queryFn: () => api.getHeatmap(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const categoryStats = useQuery({
    queryKey: ["categoryStats", timeRange],
    queryFn: () => api.getByCategory(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const regionStats = useQuery({
    queryKey: ["regionStats", timeRange],
    queryFn: () => api.getByRegion(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const paymentStats = useQuery({
    queryKey: ["paymentStats", timeRange],
    queryFn: () => api.getByPayment(timeRange),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const topProducts = useQuery({
    queryKey: ["topProducts", timeRange],
    queryFn: () => api.getTopProducts(timeRange, 10),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  return {
    kpi: kpi.data,
    kpiLoading: kpi.isLoading,
    kpiError: kpi.error,
    timeSeries: timeSeries.data,
    timeSeriesLoading: timeSeries.isLoading,
    metrics: metrics.data,
    traceStats: traceStats.data,
    fullTimeSeries: fullTimeSeries.data,
    topUsers: topUsers.data,
    amountDistribution: amountDistribution.data,
    latencyTimeline: latencyTimeline.data,
    scatterData: scatterData.data,
    revenueByType: revenueByType.data,
    heatmapData: heatmapData.data,
    categoryStats: categoryStats.data,
    regionStats: regionStats.data,
    paymentStats: paymentStats.data,
    topProducts: topProducts.data,
  };
}
