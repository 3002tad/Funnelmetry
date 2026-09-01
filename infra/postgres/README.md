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
