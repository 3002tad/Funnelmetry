import {
  ChartType,
  eGrid,
  eTooltipStyle,
  amountColors,
  categoryColors,
  regionColors,
  paymentColors,
} from "./chartTheme";

type OrdersRow = { time: string; success: number; failed: number; created: number };

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
    legend: { bottom: 0, textStyle: { color: "#cbd5e1", fontSize: 11 } },
    grid: { ...eGrid, bottom: 50 },
    xAxis: {
      type: "category",
      data: times,
      axisLine: { lineStyle: { color: "#64748b" } },
      axisTick: { show: false },
      axisLabel: { color: "#64748b", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
      splitLine: { lineStyle: { color: "#1e293b" } },
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
      axisLine: { lineStyle: { color: "#64748b" } },
      axisTick: { show: false },
      axisLabel: { color: "#64748b", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
      splitLine: { lineStyle: { color: "#1e293b" } },
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
        color: "#64748b",
        fontSize: 10,
        formatter: (v: number) =>
          v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}K`,
      },
      splitLine: { lineStyle: { color: "#1e293b" } },
    },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: "#64748b", fontSize: 11 },
      axisLine: { lineStyle: { color: "#64748b" } },
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
      axisLine: { lineStyle: { color: "#64748b" } },
      axisTick: { show: false },
      axisLabel: { color: "#64748b", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
      splitLine: { lineStyle: { color: "#1e293b" } },
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
      axisLine: { lineStyle: { color: "#64748b" } },
      axisTick: { show: false },
      axisLabel: { color: "#64748b", fontSize: 11, formatter: (v: string) => v.replace(/_/g, " ") },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
      splitLine: { lineStyle: { color: "#1e293b" } },
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
