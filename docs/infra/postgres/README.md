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
- `v2/007_maturity_finalization.sql`: append-only finalization evidence và projection identity cho
  atomic Funnel Instance/KPI drop-off transition.
- `v2/008_late_conversion.sql`: append-only late-conversion evidence; giữ nguyên outcome/KPI đã
  finalization và không lưu business-key value trong document analytics.
- `v2/009_matured_conversion.sql`: bổ sung conversion-time authority vào maturity evidence để tạo
  eligible matured conversion cohort mà không trộn observed/pending hoặc fallback-time conversion.
- `v2/010_reconciliation_evidence.sql`: append-only reconciliation snapshot, normalized source records
  và currency control totals; chưa so sánh hoặc repair current analytics projection.
- `v2/011_reconciliation_comparison.sql`: append-only comparison revisions, analytics observation set,
  denominator-safe discrepancy metrics và record-level discrepancy evidence.
- `v2/012_reconciliation_current_projection.sql`: immutable current-projection revisions/records, một
  mutable head cho mỗi exact reconciliation scope, cùng append-only repair/correction/verification evidence.
- `v2/013_ingress_coordination.sql`: shared Gateway claim/receipt ledger.
- `v2/014_ingress_send_guard.sql`: owner-bound send authorization, cho phép retry takeover claim
  hết lease chỉ khi chưa cấp quyền gửi. Claim lịch sử mặc định không được coi là chưa gửi.
- `v2/015_ingress_send_attempts.sql`: lịch sử cấp quyền gửi gắn với transactional ID và runtime boot
  generation, ghi atomically cùng send guard; không chứa Kafka transaction outcome hoặc numeric epoch.
- `v2/016_ingress_producer_generations.sql`: registry current generation theo transactional ID,
  INITIALIZING/READY; không backfill generation hoặc tự release claim.
- `v2/017_ingress_claim_recovery.sql`: Kafka scope của send attempt và audit release sau fencing;
  không backfill scope lịch sử. Recovery mặc định tắt, cần receipt history còn nguyên.
- `v2/018_kpi_handoff_evidence.sql`: lưu danh sách KPI đã thay đổi atomically cùng application/facts,
  dùng gửi lại sau crash; lịch sử thiếu evidence vẫn NULL, không suy diễn từ current projection.

Compose chạy `postgres-migrations` mỗi lần khởi động để áp dụng idempotent toàn bộ migration V2 cho
cả volume mới lẫn volume đã tồn tại.
