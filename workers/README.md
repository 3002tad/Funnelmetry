# Workers

Worker V2 tách theo capability; không đặt V1 `streaming-processor` nguyên khối vào đây.
Đây là danh mục code, không xác nhận tất cả worker đang chạy trên demo.
Xem [mục lục tài liệu](../docs/README.md) và [resume/config runtime](../runtime/README.md).

Hiện có:

- [source-connector/](source-connector/README.md): chủ động pull HTTPS Event Feed,
  bàn giao Kafka và lưu cursor. Cursor không phải processing-safe checkpoint.
- [catalog-sync/](catalog-sync/README.md): đồng bộ tên sản phẩm qua Medusa Admin API;
  current descriptive metadata, không tái dựng giá lịch sử. Activation one-shot và periodic khác nhau.

- `canonical-normalizer/`: consume raw Kafka, tạo `CanonicalEvent v1` hoặc quarantine,
  ghi terminal outcome và raw consumer offset trong cùng Kafka transaction.
- `ingress-telemetry-writer/`: persist unique accepted receipt và versioned canonicalization outcome
  để Data Health có durable evidence, rồi mới commit offset của receipt/outcome topic.
- `canonical-ledger-writer/`: persist CanonicalEvent idempotent vào PostgreSQL rồi mới
  phát canonical-persisted handoff và commit canonical offset trong Kafka transaction.
- `journey-processor/`: progressive anchoring CanonicalEvent đã persist thành journey
  projection, sau đó phát journey-resolved handoff.
- `funnel-processor/`: chiếu journey theo Funnel Profile immutable/versioned, rebuild theo
  event-time rồi phát funnel-updated handoff.
- `funnel-maturity-scheduler/`: polling runtime có PostgreSQL advisory-lock coordination và lưu
  maturity evidence immutable/revisioned; gated finalizer đóng drop-off và KPI trong một transaction.
- `kpi-projector/`: materialize funnel snapshot idempotent thành KPI base fact và observed views,
  sau đó phát kpi-updated handoff.
- `reconciliation-worker/`: persist manifest/comparison, version current projection và repair có audit;
  đã có [CLI compare/repair/verify](reconciliation-worker/README.md). Có code không chứng minh
  runtime đã được cấu hình nguồn snapshot hoặc tự động đối soát; xem điều kiện trong README riêng.
