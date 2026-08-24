import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"

const axis = { axisLine: { lineStyle: { color: "rgba(148,163,184,.18)" } }, axisTick: { show: false }, axisLabel: { color: "#7f8494", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(148,163,184,.08)" } } }

export function AnalyticsChart({ option, height = 280, onClick }: { option: EChartsOption; height?: number; onClick?: (params: unknown) => void }) {
  return <ReactECharts option={{ backgroundColor: "transparent", textStyle: { fontFamily: "Inter", color: "#a1a1aa" }, tooltip: { trigger: "axis", backgroundColor: "#17171f", borderColor: "#30303d", textStyle: { color: "#f4f4f5", fontSize: 12 } }, grid: { left: 42, right: 18, top: 26, bottom: 28 }, ...option }} style={{ height }} onEvents={onClick ? { click: onClick } : undefined} notMerge lazyUpdate />
}

export function TrendChart({ compact = false }: { compact?: boolean }) {
  const dates = ["Aug 1", "Aug 4", "Aug 7", "Aug 10", "Aug 13", "Aug 16", "Aug 19", "Aug 22"]
  return <AnalyticsChart height={compact ? 220 : 300} option={{ legend: { right: 12, top: 0, textStyle: { color: "#8b8b98", fontSize: 11 }, data: ["Revenue", "Orders"] }, xAxis: { type: "category", data: dates, boundaryGap: false, ...axis }, yAxis: [{ type: "value", ...axis }, { type: "value", show: false }], series: [{ name: "Revenue", type: "line", smooth: true, symbol: "circle", symbolSize: 7, data: [18400, 21200, 19800, 26300, 25100, 29400, 31800, 34600], lineStyle: { color: "#3b82f6", width: 2.5 }, itemStyle: { color: "#60a5fa" }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(59,130,246,.28)" }, { offset: 1, color: "rgba(59,130,246,0)" }] } } }, { name: "Orders", type: "line", smooth: true, yAxisIndex: 1, data: [142, 158, 149, 191, 184, 216, 230, 246], lineStyle: { color: "#4cc9a2", width: 2 }, itemStyle: { color: "#4cc9a2" } }] }} />
}

export function SourceDonut() {
  return <AnalyticsChart height={260} option={{ tooltip: { trigger: "item" }, legend: { bottom: 0, textStyle: { color: "#8b8b98", fontSize: 11 } }, series: [{ type: "pie", radius: ["54%", "76%"], center: ["50%", "43%"], itemStyle: { borderColor: "#15151d", borderWidth: 3, borderRadius: 5 }, label: { show: false }, data: [{ name: "Organic", value: 42, itemStyle: { color: "#3b82f6" } }, { name: "Paid social", value: 26, itemStyle: { color: "#4cc9a2" } }, { name: "Direct", value: 19, itemStyle: { color: "#55a7ff" } }, { name: "Referral", value: 13, itemStyle: { color: "#f6b84b" } }] }] }} />
}

export function HealthChart() {
  return <AnalyticsChart option={{ xAxis: { type: "category", data: ["10:00", "10:10", "10:20", "10:30", "10:40", "10:50", "11:00"], boundaryGap: false, ...axis }, yAxis: { type: "value", ...axis }, series: [{ name: "Accepted", type: "line", stack: "events", smooth: true, showSymbol: false, areaStyle: { color: "rgba(52,211,153,.22)" }, lineStyle: { color: "#34d399" }, data: [1480, 1610, 1560, 1770, 1690, 1820, 1880] }, { name: "Rejected", type: "line", smooth: true, showSymbol: false, lineStyle: { color: "#fb7185" }, data: [24, 31, 20, 36, 28, 42, 29] }] }} />
}

export function DeviceBars() {
  return <AnalyticsChart height={200} option={{ grid: { left: 80, right: 20, top: 10, bottom: 20 }, xAxis: { type: "value", max: 100, ...axis }, yAxis: { type: "category", data: ["Desktop", "Mobile", "Tablet"], ...axis }, series: [{ type: "bar", data: [72, 54, 63], barWidth: 11, itemStyle: { color: "#3b82f6", borderRadius: 6 } }] }} />
}
