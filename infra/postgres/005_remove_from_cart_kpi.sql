-- KPI counters for remove_from_cart (web-shop cart decrement).

ALTER TABLE tracking_kpi_1m
  ADD COLUMN IF NOT EXISTS remove_from_cart INT NOT NULL DEFAULT 0;

ALTER TABLE product_kpi_1m
  ADD COLUMN IF NOT EXISTS remove_from_cart INT NOT NULL DEFAULT 0;

ALTER TABLE product_revenue_kpi_1m
  ADD COLUMN IF NOT EXISTS remove_from_cart INT NOT NULL DEFAULT 0;
