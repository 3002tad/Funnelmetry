/** Shared palette — analytics dashboards (PostHog / Amplitude style) */
export const CHART_COLORS = [
  "#53389e",
  "#f54e00",
  "#0d9488",
  "#2563eb",
  "#d97706",
  "#db2777",
  "#6366f1",
  "#15803d",
];

export const SERIES = {
  purple: { stroke: "#53389e", fill: "#6d5cae", gradient: "gradPurple" },
  accent: { stroke: "#f54e00", fill: "#ff7a33", gradient: "gradAccent" },
  success: { stroke: "#15803d", fill: "#22c55e", gradient: "gradSuccess" },
  teal: { stroke: "#0d9488", fill: "#14b8a6", gradient: "gradTeal" },
  blue: { stroke: "#2563eb", fill: "#3b82f6", gradient: "gradBlue" },
};

export const GRID_STROKE = "#e4e8f1";
export const TICK_FILL = "#6b7280";
export const AXIS_LINE = false;
export const TICK_LINE = false;

export const CHART_MARGIN = { top: 12, right: 20, left: 4, bottom: 4 };

export const AXIS_TICK = { fontSize: 11, fill: TICK_FILL, fontWeight: 500 };

export const LEGEND_STYLE = {
  fontSize: "0.78rem",
  paddingTop: 12,
  color: "#5c6478",
};

export const TOOLTIP_STYLE = {
  display: "none",
};

export function formatCompact(n) {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString("vi-VN");
}

export { formatMoneyShort } from "../../lib/format.js";
