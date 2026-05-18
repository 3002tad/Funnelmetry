import {
  ChartType,
  eGrid,
  eTooltipStyle,
  amountColors,
  scatterColors,
  treemapColors,
  categoryColors,
  regionColors,
  paymentColors,
} from "./chartTheme";

type RevenueRow = { time: string; revenue: number };
type OrdersRow = { time: string; success: number; failed: number; created: number };
type LatencyRow = { time: string; P50: number; P95: number; events: number };
type EventTypesRow = Record<string, any>;

export function buildRevenueOption(data: RevenueRow[] | undefined, chartType: ChartType) {
  if (!data) return {};
  const times = data.map((d) => d.time);
  const revenues = data.map((d) => d.revenue);
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
        type: chartType === "bar" ? "bar" : "line",
        smooth: true,
        data: revenues,
        itemStyle: { color: "#10B981" },
        lineStyle: { color: "#10B981", width: 2 },
        areaStyle:
          chartType === "area"
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
        barMaxWidth: 40,
      },
    ],
  };
}

export function buildOrdersOption(data: OrdersRow[] | undefined, chartType: ChartType, activeStatus: string | undefined) {
  if (!data) return {};
  const times = data.map((d) => d.time);
  const successData = data.map((d) => d.success);
  const failedData = data.map((d) => d.failed);
  const successColor = activeStatus && activeStatus !== "success" ? "#10B98140" : "#10B981";
  const failedColor = activeStatus && activeStatus !== "failed" ? "#EF444440" : "#EF4444";
  const isLine = chartType === "line";
  const isArea = chartType === "area";
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
        name: "Failed",
        type: seriesType,
        stack: seriesType === "bar" ? "a" : undefined,
        smooth: true,
        data: failedData,
        itemStyle: { color: failedColor },
        lineStyle: seriesType === "line" ? { color: failedColor, width: 2 } : undefined,
        areaStyle: isArea
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
}

type PieSlice = { name: string; value: number; status: string };
export function buildPieOption(pieData: PieSlice[], activeStatus: string | undefined) {
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
}

export function buildEventTypesOption(data: EventTypesRow[] | undefined, chartType: ChartType, activeEventType: string | undefined) {
  if (!data) return {};
  const times = data.map((d) => d.time);
  const isBar = chartType === "bar";
  const isArea = chartType === "area";
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
    legend: { bottom: 0, textStyle: { color: "#374151", fontSize: 10 } },
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
      data: data.map((d) => d[s.key] ?? 0),
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
}

export function buildLatencyOption(data: LatencyRow[] | undefined, chartType: ChartType) {
  if (!data) return {};
  const times = data.map((d) => d.time);
  const isBar = chartType === "bar";
  const isArea = chartType === "area";
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
        data: data.map((d) => d.P50),
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
        data: data.map((d) => d.P95),
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
}

export function buildTopUsersOption(topUsers: any[] | undefined) {
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
      { name: "Success", type: "bar", stack: "a", data: successCounts, itemStyle: { color: "#10B981" } },
      { name: "Failed",  type: "bar", stack: "a", data: failedCounts,  itemStyle: { color: "#EF4444" }, barMaxWidth: 40 },
    ],
  };
}

export function buildAmountDistributionOption(data: any[] | undefined) {
  if (!data || data.length === 0) return {};
  return {
    tooltip: {
      trigger: "axis",
      ...eTooltipStyle,
      formatter: (p: any[]) => `${p[0].axisValue}<br/>${p[0].value.toLocaleString()} Transactions`,
    },
    grid: eGrid,
    xAxis: {
      type: "category",
      data: data.map((d) => d.range),
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
        data: data.map((d, i) => ({
          value: d.count,
          itemStyle: { color: amountColors[i % amountColors.length] },
        })),
        barMaxWidth: 60,
      },
    ],
  };
}

export function buildFunnelOption(funnelData: { name: string; value: number }[]) {
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
}

export function buildGaugeOption(successRate: number, gaugeColor: string) {
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
        progress: { show: true, width: 18, roundCap: true, itemStyle: { color: gaugeColor } },
        axisLine: { lineStyle: { width: 18, color: [[1, "#F3F4F6"]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
      },
    ],
  };
}

export function buildSuccessRateTrendOption(data: EventTypesRow[] | undefined) {
  if (!data) return {};
  const times = data.map((d) => d.time);
  const srData = data.map((d) => d["Success Rate"] ?? 0);
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
}

export function buildScatterOption(filteredScatter: any[], activeStatus: string | undefined) {
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
}

export function buildRevenueByTypeOption(filteredRevenueByType: any[]) {
  if (filteredRevenueByType.length === 0) return {};
  const eventTypes = filteredRevenueByType.map((d) => d.eventType);
  const revenues = filteredRevenueByType.map((d) => d.revenue);
  return {
    tooltip: {
      trigger: "axis",
      ...eTooltipStyle,
      formatter: (p: any[]) => `${p[0].axisValue.replace(/_/g, " ")}<br/>${(p[0].value / 1000000).toFixed(2)}M VND`,
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
      axisLabel: { color: "#9CA3AF", fontSize: 10, formatter: (v: string) => v.replace(/_/g, " ") },
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
}

export function buildHeatmapOption(heatmapGrid: Record<string, any>[], activeEventType: string | undefined) {
  if (heatmapGrid.length === 0) return {};
  const hours = heatmapGrid.map((d) => d.hour);
  const eventTypeDefs = [
    { key: "order_created",     name: "Order Created",     color: "#6366F1" },
    { key: "payment_initiated", name: "Payment Initiated", color: "#3B82F6" },
    { key: "payment_success",   name: "Payment Success",   color: "#10B981" },
    { key: "payment_failed",    name: "Payment Failed",    color: "#EF4444" },
    { key: "order_cancelled",   name: "Order Cancelled",   color: "#F59E0B" },
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
}

export function buildCategoryOption(categoryStats: any[] | undefined) {
  if (!categoryStats || categoryStats.length === 0) return {};
  const categories = categoryStats.map((d) => d.category);
  const revenues = categoryStats.map((d) => d.revenue);
  return {
    tooltip: {
      trigger: "axis",
      ...eTooltipStyle,
      formatter: (p: any[]) => `${p[0].axisValue}<br/>${(p[0].value / 1000000).toFixed(2)}M VND`,
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
}

export function buildRegionOption(regionStats: any[] | undefined) {
  if (!regionStats || regionStats.length === 0) return {};
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
}

export function buildPaymentOption(paymentStats: any[] | undefined) {
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
      axisLabel: { color: "#9CA3AF", fontSize: 11, formatter: (v: string) => v.replace(/_/g, " ") },
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
}
