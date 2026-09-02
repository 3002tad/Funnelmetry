# Postgres SQL

Các file `*.sql` trực tiếp trong thư mục này thuộc runtime V1 và chỉ còn dùng để tham khảo
trong quá trình migration.

Schema V2 mới nằm trong `v2/`:

- `v2/001_canonical_ledger.sql`: immutable/idempotent CanonicalEvent ledger.
- `v2/002_journey_projection.sql`: journey, entity anchor và canonical-event link projection.
- `v2/003_funnel_projection.sql`: immutable/versioned Funnel Profile, activation, Funnel Instance,
  ordered-step projection và negative-event branch.
- `v2/004_kpi_projection.sql`: idempotent Funnel Instance KPI facts và observed aggregate views;
  chưa áp đặt time-window policy còn experimental.
- `v2/005_ingress_telemetry.sql`: accepted ingress receipt và versioned canonicalization outcome
  dùng làm durable evidence cho terminal outcome rate và canonicalization latency.
- `v2/006_funnel_maturity.sql`: immutable profile transition timeout và append-only, revisioned
  Funnel Instance maturity evidence; chưa tự thay đổi outcome thành `DROPPED`.

Compose chạy `postgres-migrations` mỗi lần khởi động để áp dụng idempotent toàn bộ migration V2 cho
cả volume mới lẫn volume đã tồn tại.
