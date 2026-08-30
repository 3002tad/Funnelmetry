# @funnelmetry/input-gateway

HTTP/security boundary cho `IngressEvent v1`.

Phần hiện có:

- xác thực Browser SDK bằng source key ID + write key;
- xác thực source bridge bằng HMAC SHA-256 trên raw request body;
- kiểm tra clock skew, source ownership và contract trước durable handoff;
- ghi raw record và durable receipt trong cùng Kafka transaction;
- khóa đồng thời theo `(source_id,event_id)` và chỉ cập nhật receipt index sau commit;
- replay compacted receipt topic trước khi ready và hạ readiness khi consumer crash;
- cung cấp `GET /health` và `POST /v1/ingress/events`;
- trả `retryable_failure`, không trả `accepted`, khi durable handoff lỗi.

## Chạy local

Tạo `infra/.env` từ `infra/.env.example`, khởi tạo hai topic Kafka rồi chạy:

```powershell
cd apps/input-gateway
npm install
npm start
```

- raw topic (`KAFKA_TOPIC_RAW`) dùng delete retention phục vụ audit/reprocess;
- receipt topic (`KAFKA_TOPIC_INGRESS_RECEIPTS`) phải dùng compaction;
- `INPUT_GATEWAY_INSTANCE_ID` phải ổn định và duy nhất cho producer transactional ID;
- memory receipt index chỉ là cache được hydrate từ Kafka, không phải durable boundary.

Reference runtime hiện chỉ hỗ trợ **một active gateway replica**. Khóa đồng thời và
receipt cache chỉ nằm trong process; chạy nhiều replica có thể race trên cùng
`(source_id,event_id)`. Chỉ nâng replica sau khi có idempotency coordination phân tán
hoặc partition ownership được kiểm thử riêng.
