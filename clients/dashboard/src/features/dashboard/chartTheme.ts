export type ChartType = "area" | "line" | "bar";

export const eGrid = { left: 50, right: 20, top: 30, bottom: 30, containLabel: false };
export const eTooltipStyle = { backgroundColor: "#fff", borderColor: "#e5e7eb", textStyle: { color: "#374151" } };

export const amountColors = ["#94A3B8", "#60A5FA", "#34D399", "#FBBF24", "#F97316", "#EF4444"];

export const scatterColors: Record<string, string> = {
  success: "#10B981",
  failed: "#EF4444",
  pending: "#F59E0B",
};

export const treemapColors: Record<string, string> = {
  "order created": "#6366F1",
  "payment initiated": "#3B82F6",
  "payment success": "#10B981",
  "payment failed": "#EF4444",
  "order cancelled": "#F59E0B",
};

export const categoryColors: Record<string, string> = {
  electronics: "#6366F1",
  fashion: "#EC4899",
  food: "#F59E0B",
  home: "#3B82F6",
  beauty: "#A855F7",
  books: "#10B981",
};

export const paymentColors: Record<string, string> = {
  credit_card: "#3B82F6",
  e_wallet: "#10B981",
  bank_transfer: "#F59E0B",
  cod: "#94A3B8",
};

export const regionColors = [
  "#6366F1", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#A855F7", "#EC4899", "#14B8A6", "#94A3B8",
];
