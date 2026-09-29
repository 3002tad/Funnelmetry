-- Current descriptive reference only. Never a historical price/event authority.
CREATE TABLE IF NOT EXISTS product_reference_snapshots (
  snapshot_id uuid PRIMARY KEY,
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  observed_at timestamptz NOT NULL,
  provider text NOT NULL CHECK (provider = 'medusa-admin-products-v2'),
  product_count integer NOT NULL CHECK (product_count >= 0),
  UNIQUE (source_id, snapshot_id)
);
CREATE INDEX IF NOT EXISTS product_reference_snapshot_latest
  ON product_reference_snapshots (source_id, observed_at DESC, snapshot_id DESC);
CREATE TABLE IF NOT EXISTS product_reference_names (
  source_id text NOT NULL,
  snapshot_id uuid NOT NULL,
  product_id text NOT NULL CHECK (length(product_id) BETWEEN 1 AND 200),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  source_updated_at timestamptz,
  PRIMARY KEY (source_id, snapshot_id, product_id),
  FOREIGN KEY (source_id, snapshot_id) REFERENCES product_reference_snapshots(source_id, snapshot_id)
);
-- Select ONE completed snapshot, not the latest individual product across snapshots.
-- Absence in a later snapshot means missing reference, not proof of source deletion.
CREATE OR REPLACE VIEW current_product_reference_names AS
SELECT n.source_id, n.product_id, n.title, n.source_updated_at,
       s.snapshot_id, s.observed_at, s.provider
FROM product_reference_names n
JOIN (SELECT DISTINCT ON (source_id) * FROM product_reference_snapshots
      ORDER BY source_id, observed_at DESC, snapshot_id DESC) s
  ON s.source_id=n.source_id AND s.snapshot_id=n.snapshot_id;
