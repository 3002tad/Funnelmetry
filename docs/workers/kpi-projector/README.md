# @funnelmetry/kpi-projector

Worker materialize `funnel.updated.v1` thành KPI base fact trong PostgreSQL:

```text
funnel-updated topic
  -> idempotent Funnel Instance KPI facts
  -> observed profile/step aggregate views
  -> Kafka transaction: kpi-updated handoff + input offset
```

Projection lưu snapshot theo `funnel_instance_id` cùng SHA-256 hash và revision. Redelivery hoặc
snapshot không đổi không cộng counter lần nữa. Outcome và quality được giữ thành hai chiều riêng.
Snapshot canonicalization dùng chung package `@funnelmetry/kpi-snapshot-contract`, để maturity
finalizer có thể kiểm tra KPI đã bắt kịp trước một atomic drop-off transition.

Hai view hiện có:

- `funnel_kpi_profile_observed_totals`
- `funnel_kpi_step_observed_totals`

Các view này cố ý mang tên `observed`: chúng không claim matured/final conversion rate. KPI time
window vẫn chờ contract được chốt, nên worker không hard-code bucket 1 phút hay horizon.

## Chạy

Áp dụng các migration V2 theo thứ tự, bao gồm `018_kpi_handoff_evidence.sql`, provision funnel/kpi topic rồi:

```powershell
cd workers/kpi-projector
npm install
npm start
```

Integration test PostgreSQL được bật khi có `TEST_DATABASE_URL`.

## Crash recovery test

`test/crash-recovery.integration.test.js` chạy khi có cả `TEST_DATABASE_URL` và
`TEST_KAFKA_BROKERS`, trên Linux (SIGKILL). Test tạo schema/topic riêng và hai process worker:

1. Process đầu commit KPI vào PostgreSQL rồi bị SIGKILL trước khi mở Kafka transaction.
2. Xác nhận application/facts đã tồn tại nhưng chưa commit input offset và output topic còn rỗng.
3. Process mới dùng cùng consumer group/transactional ID nhận lại event, trả projection `duplicate`,
   commit handoff cùng input offset; snapshot PostgreSQL, revision và occurrence count không đổi.

Fault hook chỉ nằm trong `test/fixtures/crash-process.js`. Test tự dọn schema/topic đã tạo,
không reset consumer group hoặc sửa dữ liệu runtime.

Migration 018 lưu `changed_instances` trong application ledger, cùng transaction với KPI facts.
Replay trả đúng danh sách/revision và `applied_at` của lần đầu, kể cả KPI hiện tại đã thay đổi.
`projection_status` vẫn là `duplicate`; downstream không được bỏ qua danh sách chỉ vì trạng thái này.
Đây là lưu kết quả nội bộ Funnelmetry, không can thiệp transaction/database của hệ thống nguồn.

Triển khai: dừng worker cũ, áp dụng migration rồi chạy worker mới; không trộn phiên bản writer.
Migration không backfill lịch sử từ current facts. Application cũ có changed count=0 có thể trả
danh sách rỗng; count>0 nhưng thiếu evidence sẽ báo lỗi, không ACK offset. Cần xử lý evidence lịch sử
trước khi resume partition đó, không tự reset offset hoặc xóa application để bỏ qua.
Migration mới chỉ được thử trong schema test, chưa áp dụng vào database runtime.

Test PostgreSQL kiểm tra replay sau revision mới, lịch sử thiếu evidence và rollback KPI khi ghi
application lỗi. Crash test kiểm tra committed handoff có đúng danh sách đã lưu. Chưa bao phủ crash
sau Kafka send/sendOffsets hoặc lúc commit không rõ kết quả; không claim exactly-once mọi lỗi.
