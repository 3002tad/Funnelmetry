# Projection workers: journey, funnel, maturity, KPI

> Các worker downstream có thứ tự handoff riêng và không đồng nghĩa completeness/acceptance của toàn Pipeline.

## Mục lục

- [Journey processor](#journey-processor)
- [Funnel processor](#funnel-processor)
- [Funnel maturity scheduler](#funnel-maturity-scheduler)
- [KPI projector](#kpi-projector)


---

<a id="journey-processor"></a>

## Journey processor

> Nguồn gốc trước khi gộp: `docs/workers/journey-processor/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# @funnelmetry/journey-processor

Progressive journey anchoring sau Canonical Ledger:

```text
canonical-persisted topic
  → PostgreSQL journey projection
  → Kafka transaction: journey-resolved handoff + input offset
```

Thứ tự evidence:

1. `STRONG`: direct correlation, cart/checkout/order/payment entity.
2. `MEDIUM`: authenticated user identity.
3. `WEAK`: session context.
4. Không đủ evidence: tạo journey cô lập mới.

`session_id` chỉ là context mapping, không phải `journey_id` hay event dedup key. Anonymous
identity chưa được reuse nếu thiếu subject/time policy đã benchmark. Nếu evidence trỏ tới
nhiều journey, processor rollback và không tự merge mù.

Confidence hiện là categorical (`STRONG | MEDIUM | WEAK | ISOLATED`), không hard-code
numeric threshold đang còn experimental.

Evidence trỏ tới nhiều journey làm PostgreSQL transaction rollback và không tự merge. Integration
test xác nhận event xung đột không tạo `journey_events` row và không thay đổi event count của hai
journey hiện hữu. Runtime hiện chưa có terminal conflict/DLQ contract; vì vậy conflict trên Kafka sẽ
được retry và có thể giữ partition tại offset đó. Không claim tự phục hồi cho tới khi handoff contract
được duyệt và triển khai.

## Chạy

Áp dụng hai migration trong `infra/postgres/v2/`, provision persisted/resolved topic rồi:

```powershell
cd workers/journey-processor
npm install
npm start
```


---

<a id="funnel-processor"></a>

## Funnel processor

> Nguồn gốc trước khi gộp: `docs/workers/funnel-processor/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# @funnelmetry/funnel-processor

Worker chiếu `journey.resolved.v1` thành Funnel Instance theo Funnel Profile bất biến và có
version:

```text
journey-resolved topic
  -> PostgreSQL funnel projection
  -> Kafka transaction: funnel-updated handoff + input offset
```

Các nguyên tắc hiện tại:

- Một entry event tạo một Funnel Instance riêng, kể cả cùng journey có nhiều lần thử.
- Step phải đúng cả `event_type` và `event_class`; browser intent không thể thay business fact.
- Projection được dựng lại từ Journey Event theo event-time, nên hỗ trợ event đến Kafka sai thứ tự.
- Negative event được giữ ở nhánh riêng và không đảo ngược một conversion đã hoàn tất.
- `conversion_horizon_seconds` và `late_arrival_grace_seconds` thuộc từng profile; worker không
  tự gán một con số kiến trúc mặc định.
- Maturity Scheduler kết luận `DROPPED` sau horizon + grace; Funnel Processor coi projection đã
  finalization là đóng và không sửa ngược step/outcome/KPI chính thức.
- Conversion đến sau finalization chỉ được ghi vào append-only late-conversion ledger khi final
  `BUSINESS_FACT` có authoritative time và liên kết bằng strong business entity.

## Chạy

Áp dụng các migration `001` đến `012` trong `infra/postgres/v2/`, publish/activate ít nhất một profile cho
`source_id`, provision journey/funnel topic rồi:

```powershell
cd workers/funnel-processor
npm install
npm run profiles:publish-reference
npm start
```

Lệnh publish dùng `FUNNEL_PROFILE_SOURCE_ID` trong `runtime/v2-dev.env`, hiện cung cấp đúng hai profile
tham chiếu đã duyệt: Commerce Conversion và Online Payment. Chạy lại lệnh là idempotent nếu
profile cùng version không đổi; semantics khác phải dùng version mới.

Integration test PostgreSQL được bật khi có `TEST_DATABASE_URL`.


---

<a id="funnel-maturity-scheduler"></a>

## Funnel maturity scheduler

> Nguồn gốc trước khi gộp: `docs/workers/funnel-maturity-scheduler/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# Funnel maturity scheduler

This worker polls PostgreSQL for due `IN_PROGRESS` and `CONVERTED` Funnel Instances and records maturity evidence.
Only one replica polls at a time through a session-scoped PostgreSQL advisory lock; standby replicas
retry leadership on every interval.

The repository derives maturity with `@funnelmetry/time-semantics-contract`, verifies the immutable
profile deadline and entry-event time authority, records append-only revisioned evidence, and treats
a repeated `evaluation_id` as idempotent only when its immutable request matches.

Apply migrations `001` through `012` before using it. Migration `007` and the repository provide an
atomic `IN_PROGRESS -> DROPPED` plus KPI snapshot transition, guarded by latest eligible maturity
evidence and a caught-up KPI projection.

The poller considers configured transition timeouts and `conversion horizon + late-arrival grace`,
uses bounded batches, and re-evaluates each candidate under the Funnel Instance row lock. Reference
profiles have no numeric finality policy, so the local runtime remains idle until a versioned profile
publishes explicit values.

Converted instances become eligible matured conversions only after horizon + grace when both entry
and representative conversion-event times are authoritative. Non-authoritative conversions retain
their observed status but are excluded from the final conversion/drop-off denominator.

Finalization is additionally gated by `MATURITY_SCHEDULER_FINALIZATION_ENABLED`. Migration `008` and
Funnel Processor preserve the finalized `DROPPED` projection and record qualifying strong-business-key
events separately as append-only late-conversion evidence.


---

<a id="kpi-projector"></a>

## KPI projector

> Nguồn gốc trước khi gộp: `docs/workers/kpi-projector/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

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
