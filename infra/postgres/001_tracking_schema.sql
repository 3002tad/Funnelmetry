-- Tracking pipeline schema (from docs/SPEC.md §6, §13)
-- Applied after init.sql bootstrap. Wire into compose when ready.

CREATE TABLE IF NOT EXISTS tracking_events_clean (
  event_id VARCHAR(100) PRIMARY KEY,
  event_time TIMESTAMP NOT NULL,
  event_source VARCHAR(80),
  event_category VARCHAR(50),
  event_type VARCHAR(80),
  anonymous_id VARCHAR(100),
  session_id VARCHAR(100),
  user_id VARCHAR(100),
  page_url TEXT,
  product_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracking_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  total_events INT DEFAULT 0,
  page_views INT DEFAULT 0,
  product_views INT DEFAULT 0,
  clicks INT DEFAULT 0,
  searches INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  checkout_start INT DEFAULT 0,
  purchases INT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  unique_sessions INT DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start)
);

CREATE TABLE IF NOT EXISTS product_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  product_views INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  purchases INT DEFAULT 0,
  add_to_cart_rate NUMERIC DEFAULT 0,
  purchase_rate NUMERIC DEFAULT 0,
  PRIMARY KEY (window_start, product_id)
);

CREATE TABLE IF NOT EXISTS banner_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  banner_id VARCHAR(100) NOT NULL,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  target_product_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start, banner_id)
);

CREATE TABLE IF NOT EXISTS product_revenue_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  views INT DEFAULT 0,
  clicks INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  checkout_start INT DEFAULT 0,
  purchases INT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  view_to_cart_rate NUMERIC DEFAULT 0,
  purchase_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start, product_id)
);
