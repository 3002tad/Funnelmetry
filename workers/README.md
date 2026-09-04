# Workers

Không đặt V1 `streaming-processor` nguyên khối vào đây. Worker V2 sẽ được thêm theo
từng capability: canonical normalization, ingress telemetry, journey resolution, funnel processing
và reconciliation.

Hiện có:

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
  discrepancy comparison và current-projection repair chưa được bật.
