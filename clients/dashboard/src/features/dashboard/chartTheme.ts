export type ChartType = "area" | "line" | "bar";

// Dark-mode chart theme — axis = slate-500, splitLine = slate-800
export const eGrid = { left: 50, right: 20, top: 30, bottom: 30, containLabel: false };

export const eTooltipStyle = {
  backgroundColor: "rgba(15, 23, 42, 0.95)",
  borderColor: "rgba(99, 102, 241, 0.3)",
  borderWidth: 1,
  textStyle: { color: "#e2e8f0", fontSize: 12 },
  extraCssText: "backdrop-filter: blur(12px); border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);",
};

export const axisColor = "#475569";        // slate-600
export const axisLabelColor = "#94a3b8";   // slate-400
export const splitLineColor = "#1e293b";   // slate-800

export const amountColors = ["#64748b", "#60A5FA", "#34D399", "#FBBF24", "#FB923C", "#F87171"];

export const categoryColors: Record<string, string> = {
  electronics: "#818CF8",
  fashion:     "#F472B6",
  food:        "#FBBF24",
  home:        "#60A5FA",
  beauty:      "#C084FC",
  books:       "#34D399",
};

export const paymentColors: Record<string, string> = {
  credit_card:   "#60A5FA",
  e_wallet:      "#34D399",
  bank_transfer: "#FBBF24",
  cod:           "#94A3B8",
};

export const regionColors = [
  "#818CF8", "#60A5FA", "#34D399", "#FBBF24",
  "#F87171", "#C084FC", "#F472B6", "#22D3EE", "#94A3B8",
];
