-- Product catalog for display purposes — seeded from demo-shop product list.
-- Joined at query time by dashboard-api; not part of the streaming pipeline.

CREATE TABLE IF NOT EXISTS products_catalog (
  product_id  VARCHAR(100) PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  price       NUMERIC      NOT NULL DEFAULT 0,
  category    VARCHAR(100)
);

INSERT INTO products_catalog (product_id, name, price, category) VALUES
  ('P001', 'Áo thun basic',       199000, 'fashion'),
  ('P002', 'Giày sneaker',        890000, 'fashion'),
  ('P003', 'Tai nghe Bluetooth',  450000, 'electronics'),
  ('P004', 'Bình giữ nhiệt',      120000, 'home'),
  ('P005', 'Sách productivity',    85000, 'books'),
  ('P006', 'Chuột không dây',     320000, 'electronics')
ON CONFLICT (product_id) DO UPDATE SET
  name     = EXCLUDED.name,
  price    = EXCLUDED.price,
  category = EXCLUDED.category;
