-- Site-wide revenue per minute (every purchase_succeeded, with or without product_id).
ALTER TABLE tracking_kpi_1m
  ADD COLUMN IF NOT EXISTS revenue NUMERIC NOT NULL DEFAULT 0;
