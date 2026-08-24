# @funnelmetry/input-contract

Contract machine-readable cho boundary `source → Raw Durable Ingress`.

- `IngressEvent v1` dùng `(source_id, event_id)` làm idempotency key.
- `accepted`/`duplicate` bắt buộc có `ingestion_id` đã durable.
- Contract chỉ xác thực raw source fact; không canonicalize hay suy luận funnel.
- `schemas/` là JSON Schema để gateway/fixture ngoài JavaScript có thể dùng.

Không gửi PII trực tiếp, raw form value, payment token hoặc raw IP trong
`source_payload`/`source_metadata`.
