/** Class name sets for admin vs shop dashboard */
export function theme(variant = "admin") {
  const shop = variant === "shop";
  return {
    grid: shop ? "shop-card-grid" : "admin-card-grid",
    card: shop ? "shop-card" : "admin-card",
    panel: shop ? "shop-panel" : "admin-panel",
    highlight: shop ? "accent" : "highlight",
    table: "data-table",
  };
}
