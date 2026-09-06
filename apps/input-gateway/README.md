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

`INPUT_GATEWAY_COORDINATION_MODE=postgres` bật coordination ledger dùng chung giữa nhiều Gateway.
Mỗi replica cần một `INPUT_GATEWAY_INSTANCE_ID` riêng, cùng `INPUT_GATEWAY_DATABASE_URL` và cùng
`INPUT_GATEWAY_CLAIM_LEASE_MS`. Ledger giữ stable `ingestion_id` cùng semantic event fingerprint:

- replica đầu tiên claim event rồi mới mở Kafka transaction;
- replica khác thấy claim còn hạn sẽ trả retryable failure để source retry;
- lease hết hạn không tự cho phép takeover: kết quả Kafka có thể chưa xác định;
- chỉ claim được release sau lỗi trước commit và abort thành công mới được gửi lại;
- cùng `(source_id,event_id)` nhưng nội dung semantic khác bị từ chối với
  `event_identity_conflict`;
- chỉ sau Kafka commit thành công claim mới chuyển thành `ACCEPTED`.

Migration `013_ingress_coordination.sql` backfill receipt cũ từ telemetry ledger. Receipt cũ thiếu
fingerprint trả retryable failure; cần khôi phục fingerprint từ raw evidence gốc, không dùng payload
retry làm bằng chứng cho nội dung lịch sử.

Sau Kafka commit, cache giữ receipt ngay cả khi cập nhật PostgreSQL thất bại. Retry với receipt đã
replay và fingerprint khớp sẽ hoàn tất claim mà không gửi Kafka lần nữa. Nếu commit có kết quả không
xác định, Gateway hạ readiness; restart để replay receipt. Claim chưa có receipt vẫn bị giữ lại để
tránh append trùng. Phục hồi tự động claim này cần broker fencing và xác minh kết quả transaction;
hiện chưa triển khai. Không xóa/release claim thủ công chỉ vì lease đã hết hạn.

Một producer xử lý tuần tự các transaction, kể cả event khác key. Đây là giới hạn throughput hiện tại.
Các test fault injection chưa thay thế bài kiểm tra kill-process/network partition trên hai Gateway
thật. Chế độ `single_replica` chỉ giữ để tương thích, không được scale ngang.
