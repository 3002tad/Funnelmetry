# Tổng hợp thay đổi Backend Pipeline V2

Ngày tổng hợp: **2026-08-30**

Tài liệu này ghi lại phần backend V2 được xây dựng sau commit `654f0fc`. Phạm vi thay đổi chỉ
thuộc repository `Streaming_Pipeline`; không thay đổi `Medusa_Reference` hay integration Medusa
do thành viên khác phụ trách.

## 1. Luồng xử lý mới

```text
Browser SDK / Backend Integration Kit
  -> Input Gateway
  -> funnelmetry.raw.v1
  -> Canonical Normalizer
  -> funnelmetry.canonical.v1
  -> Canonical Ledger Writer
  -> PostgreSQL canonical ledger
  -> funnelmetry.canonical.persisted.v1
  -> Journey Processor
  -> PostgreSQL journey projection
  -> funnelmetry.journey.resolved.v1
  -> Funnel Processor
  -> PostgreSQL funnel projection
  -> funnelmetry.funnel.updated.v1
  -> KPI Projector
  -> PostgreSQL KPI base facts / observed views
  -> funnelmetry.kpi.updated.v1
```

Mỗi consumer stage chỉ đưa Kafka offset vào transaction sau khi projection PostgreSQL tương ứng
đã thành công. Các handoff Kafka dùng producer transaction và consumer `read_committed` để tránh
đưa dữ liệu chưa commit sang stage kế tiếp.

## 2. Input Gateway

Thư mục: `apps/input-gateway/`

- Thêm HTTP endpoint `POST /v1/ingress/events` và health/readiness endpoint.
- Hỗ trợ browser write key và exact-body HMAC cho backend/source bridge.
- Kiểm tra CORS, content type, request size và trường dữ liệu nhạy cảm.
- Ghi raw event và durable receipt trong cùng Kafka transaction.
- Dùng `(source_id, event_id)` làm idempotency key; retry cùng stable ID trả lại receipt ban đầu.
- Replay receipt topic trước khi gateway nhận traffic để khôi phục idempotency index.
- Cho phép thiếu `occurred_at`; Canonical Normalizer chịu trách nhiệm fallback và gắn quality.

Giới hạn hiện tại: receipt index nằm trong memory và runtime được tài liệu hóa cho một active
replica. Multi-replica receipt coordination chưa được triển khai.

## 3. Canonical Event Contract và Normalizer

Thư mục:

- `packages/canonical-contract/`
- `workers/canonical-normalizer/`

Các thay đổi chính:

- Thêm `CanonicalEvent v1` và canonicalization outcome contract/schema.
- Phân biệt ba authority class: `BEHAVIOR_INTENT`, `CLIENT_OBSERVATION`, `BUSINESS_FACT`.
- Giữ raw reference gồm record ID, SHA-256 content hash và byte size.
- Chuẩn hóa event time theo thứ tự `occurred_at -> produced_at -> ingested_at` và ghi rõ
  `quality.time_basis`.
- Mapping không được hỗ trợ đi quarantine thay vì bị bỏ im lặng.
- Canonical event, terminal outcome/quarantine và raw input offset được ghi nguyên tử bằng Kafka
  transaction.

## 4. Canonical Ledger

Thư mục và migration:

- `workers/canonical-ledger-writer/`
- `infra/postgres/v2/001_canonical_ledger.sql`

Ledger lưu toàn bộ canonical document cùng các field phục vụ truy vấn. Redelivery giống hệt là
no-op; cùng canonical identity nhưng document khác gây conflict và rollback. Sau khi PostgreSQL
commit, writer phát `canonical.persisted.v1` và commit canonical input offset trong cùng Kafka
transaction.

## 5. Journey Processor

Thư mục và migration:

- `workers/journey-processor/`
- `infra/postgres/v2/002_journey_projection.sql`

Journey được nối theo progressive anchoring:

1. Strong: correlation, cart, checkout, order hoặc payment entity.
2. Medium: authenticated user.
3. Weak: session context.
4. Không đủ evidence: tạo journey cô lập mới.

`journey_id` độc lập với `session_id`. Anonymous identity chưa được tự reuse khi chưa có subject/time
policy đã benchmark. Evidence cùng lúc trỏ tới nhiều journey sẽ rollback; processor không blind merge.

## 6. Funnel Processor

Thư mục và migration:

- `workers/funnel-processor/`
- `infra/postgres/v2/003_funnel_projection.sql`

Các thay đổi chính:

- Funnel Profile đã publish là immutable; đổi semantics phải tạo `profile_version` mới.
- Tách Funnel Profile, activation, Funnel Instance, reached steps và negative branches.
- Mỗi entry event tạo một Funnel Instance riêng để hỗ trợ nhiều attempt trong cùng journey.
- Rebuild projection từ Journey Event theo event-time, hỗ trợ Kafka delivery sai thứ tự.
- Step chỉ được tính khi đúng cả `event_type` và `event_class`.
- Negative/post-conversion event không xóa conversion đã đạt.
- Không hard-code conversion horizon hoặc late-arrival grace period.
- Cung cấp hai reference profile đã duyệt:
  - Commerce Conversion: `behavior.product_viewed -> cart.item_added -> checkout.started -> order.accepted`.
  - Online Payment: `order.created -> payment.attempted -> payment.captured`.

Reference profile được publish bằng:

```powershell
cd workers/funnel-processor
npm run profiles:publish-reference
```

## 7. KPI Projector

Thư mục và migration:

- `workers/kpi-projector/`
- `infra/postgres/v2/004_kpi_projection.sql`

KPI Projector lưu base fact theo từng Funnel Instance thay vì cộng counter mù:

- Snapshot có SHA-256 hash và `projection_revision`.
- Kafka redelivery hoặc trigger mới nhưng snapshot không đổi không làm tăng revision/counter.
- Outcome và quality được giữ thành hai chiều độc lập.
- Có hai view tổng hợp:
  - `funnel_kpi_profile_observed_totals`
  - `funnel_kpi_step_observed_totals`
- Rate dùng `NULLIF` để không chia cho mẫu số bằng 0.

Các view cố ý mang tên `observed`. Chúng chưa claim matured/final conversion rate vì KPI base window,
late-event watermark và maturity policy vẫn chưa được chốt trong System Backbone.

## 8. PostgreSQL migrations

Áp dụng theo đúng thứ tự:

```text
infra/postgres/v2/001_canonical_ledger.sql
infra/postgres/v2/002_journey_projection.sql
infra/postgres/v2/003_funnel_projection.sql
infra/postgres/v2/004_kpi_projection.sql
```

## 9. Cấu hình runtime mới

`infra/.env.example` đã bổ sung:

- Toàn bộ topic raw, receipt, canonical, quarantine và stage handoff.
- Stable instance/transactional ID cho từng worker.
- Consumer group ID và PostgreSQL pool size.
- `FUNNEL_PROFILE_SOURCE_ID` để activate reference profile theo source.

Không commit secret thật; developer cần sao chép thành `infra/.env` và thay credential local.

## 10. Kiểm thử đã chạy

Kết quả tại thời điểm tạo tài liệu:

| Thành phần | Unit test pass |
| --- | ---: |
| Packages contracts/SDK/integration kit | 13 |
| Input Gateway | 24 |
| Canonical Normalizer | 11 |
| Canonical Ledger Writer | 11 |
| Journey Processor | 12 |
| Funnel Processor | 11 |
| KPI Projector | 8 |
| **Tổng unit test** | **90** |

Ngoài ra có **2 PostgreSQL integration test** đã chạy thành công:

- Funnel late-arrival/out-of-order projection, conversion và negative branch.
- KPI snapshot idempotency, revision và observed aggregate views.

Tổng cộng: **92 test pass**. `git diff --check`, JavaScript syntax check và migration trên
PostgreSQL 15 thật đều đã qua.

## 11. Phần chưa hoàn thiện

- Chưa có source-native mapping đầy đủ cho từng nền tảng; Medusa adapter thuộc integration scope riêng.
- Chưa có multi-replica coordination cho Input Gateway receipt index.
- Chưa triển khai reconciliation worker, matured/drop-off scheduler và late-arrival watermark policy.
- KPI hiện là profile/instance base facts và observed totals; product/category attribution cùng time
  window chưa triển khai vì contract tương ứng còn provisional/experimental.
- Dashboard API/UI chưa đọc các bảng KPI V2 mới.
- Chưa bổ sung manifest deploy hoặc CI/CD mới; manifest k3s V1 đã bị loại khỏi runtime được duy trì.

## 12. Bước tiếp theo đề xuất

1. Nối Dashboard API vào Journey/Funnel/KPI V2 bằng read-only query layer.
2. Chốt segmentation/product attribution contract trước khi thêm Product KPI Matrix.
3. Chốt Time Semantics Contract trước khi triển khai matured drop-off và window rollup.
4. Sau đó mới xây reconciliation worker và data-quality gate cho analytics/AI.
