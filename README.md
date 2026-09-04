# Funnelmetry

Repository chính cho backend analytics và giao diện Funnelmetry V2.

## Cấu trúc đang chuyển đổi

```text
apps/
  dashboard-web/       UI analytics V2; một số màn hình chưa có contract vẫn dùng mock data
  dashboard-api/       API analytics hiện có, đang được chuyển dần sang V2
  input-gateway/       HTTP/security + KafkaJS durable-ingress runtime
workers/                Canonical normalizer/ledger, journey và capability tiếp theo
packages/               Input/canonical contract, Browser SDK và Backend Integration Kit
integrations/medusa/    Ranh giới tích hợp Medusa; không chứa core pipeline
tools/                   Công cụ CI planner và API docs
infra/                   Schema/config hạ tầng không phụ thuộc runtime V1
tests/                   Contract, integration, E2E và fault fixtures dùng chung
```

Code V1 đã được gom vào `legacy/` để đối chiếu trong lúc phát triển. Nội dung
trong đó không quyết định kiến trúc V2 và không còn được build/deploy mặc định.

CI/CD và manifest k3s V1 đã được loại bỏ ngày 2026-08-24 vì không còn là runtime
được duy trì. Hạ tầng triển khai mới sẽ chỉ được thêm sau khi backend V2 có
vertical slice chạy được.

## Chạy UI mới

```powershell
cd apps/dashboard-web
npm install
npm run dev
```

Mở `http://localhost:5180`.

## Kiểm tra Dashboard API

```powershell
cd apps/dashboard-api
npm install
npm test
```

Dashboard API có namespace read-only `/api/v2/analytics/*` cho KPI overview, funnel profile,
journey projection, canonical event browser và data health. Mọi request V2 phải có `source_id`; xem contract tại
[`apps/dashboard-api/README.md`](apps/dashboard-api/README.md).

## Chạy API docs V2

```powershell
cd tools/api-docs
npm install
npm test
npm run dev
```

Mở `http://localhost:5190`. Swagger mặc định chọn Analytics API V2 và vẫn cho phép chuyển sang
contract V1 để đối chiếu.

## Chạy Input Gateway

Gateway yêu cầu Kafka và các topic đã được provision. Sao chép `infra/.env.example`
thành `infra/.env`, điền credential development rồi chạy:

```powershell
cd apps/input-gateway
npm install
npm start
```

Chi tiết topic, readiness và giới hạn single-replica nằm trong
[`apps/input-gateway/README.md`](apps/input-gateway/README.md).

## Chạy Canonical Normalizer

Sau khi Kafka và các output topic đã sẵn sàng:

```powershell
cd workers/canonical-normalizer
npm install
npm start
```

Worker chỉ commit raw offset cùng transaction đã ghi canonical/quarantine và terminal
outcome. Mapping native theo source chưa nằm trong core này.

## Chạy Canonical Ledger Writer

Sau khi áp dụng `infra/postgres/v2/001_canonical_ledger.sql`:

```powershell
cd workers/canonical-ledger-writer
npm install
npm start
```

Writer commit canonical Kafka offset sau PostgreSQL transaction; redelivery được xử lý
idempotent theo canonical identity.

## Chạy Ingress Telemetry Writer

Sau khi áp dụng `infra/postgres/v2/005_ingress_telemetry.sql` và provision receipt/outcome topics:

```powershell
cd workers/ingress-telemetry-writer
npm install
npm start
```

Writer lưu accepted receipt và canonicalization outcome vào PostgreSQL trước khi commit Kafka
offset. Dữ liệu này hỗ trợ terminal outcome rate và canonicalization latency trong Data Health;
pre-handoff loss, duplicate/rejected attempt và queue drop vẫn chưa được suy diễn.

## Chạy Journey Processor

Sau khi áp dụng các migration PostgreSQL V2 và provision journey topics:

```powershell
cd workers/journey-processor
npm install
npm start
```

Processor nối event theo strong business/correlation evidence trước, sau đó mới tới
authenticated/session context; evidence xung đột không được tự merge.

## Chạy Funnel Processor

Sau khi áp dụng `infra/postgres/v2/003_funnel_projection.sql`, publish profile và provision
funnel-updated topic:

```powershell
cd workers/funnel-processor
npm install
npm run profiles:publish-reference
npm start
```

Processor tạo Funnel Instance từ entry event, rebuild ordered steps theo event-time và chỉ
đánh dấu `CONVERTED` khi đủ sequence đúng authority. Timeout/horizon không được hard-code
trong worker.

## Chạy KPI Projector

Sau khi áp dụng `infra/postgres/v2/004_kpi_projection.sql` và provision kpi-updated topic:

```powershell
cd workers/kpi-projector
npm install
npm start
```

Projector lưu KPI base fact theo Funnel Instance bằng snapshot hash/revision để redelivery không
double count. Aggregate hiện được công bố dưới dạng observed totals; time-window và matured
denominator chưa bị hard-code khi contract tương ứng còn experimental.

## Time Semantics Contract v1

Package `packages/time-semantics-contract` chuẩn hóa clock, horizon/grace, maturity và late-arrival
boundary bằng các hàm thuần. Contract không có timeout mặc định; hai reference profile còn `null`
time policy nên scheduler không tự kết luận `DROPPED`.

Migration `006_funnel_maturity.sql` và repository trong `workers/funnel-maturity-scheduler` đã lưu
được maturity evidence revisioned/idempotent. Scheduler chạy polling theo batch với PostgreSQL
advisory lock cho single-leader coordination. Migration `007_maturity_finalization.sql` bổ sung
atomic Funnel Instance/KPI drop-off finalizer. Migration `008_late_conversion.sql` và Funnel Processor
ghi late conversion bằng append-only evidence mà không sửa ngược outcome/KPI đã finalization.
Migration `009_matured_conversion.sql` đưa authoritative converted instance vào eligible matured cohort
sau horizon + grace để API công bố final conversion/drop-off rate với mẫu số đúng contract.

Chạy riêng worker bằng `npm start` trong `workers/funnel-maturity-scheduler`, hoặc chạy cùng local
stack qua `infra/compose.v2.yml`. Các tham số polling nằm trong `infra/.env.example`.

Xem [`docs/TIME_SEMANTICS_CONTRACT_V1.md`](docs/TIME_SEMANTICS_CONTRACT_V1.md).

## Reconciliation Manifest Contract v1

Package `packages/reconciliation-contract` chuẩn hóa snapshot đối soát nội bộ, độc lập với
transport REST/CSV/MQ. Chỉ snapshot record-level đã đóng và đầy đủ mới được phép chuyển sang
`RECONCILING` và có capability repair current projection. Snapshot aggregate-only hoặc incomplete
phải `DEGRADED`; snapshot chưa đóng vẫn `PROVISIONAL`.

Contract không bịa historical event và không tự đặt quality threshold. Migration
`010_reconciliation_evidence.sql` cùng repository của `workers/reconciliation-worker` persist snapshot,
record và currency control totals atomically. Migration `011_reconciliation_comparison.sql` lưu revisioned
comparison, analytics observations và discrepancy evidence. Migration
`012_reconciliation_current_projection.sql` bổ sung read model hiện tại theo revision, head theo exact scope
và correction evidence. Repair chỉ áp dụng cho comparison record-level còn hiện hành; nó tạo projection
revision mới mà không sửa raw/canonical event hoặc historical funnel.

Dashboard API/Data Health tổng hợp revision mới nhất của từng snapshot theo `coverage_end_at`, công bố
record discrepancy, revenue deviation và repair verification có denominator rõ ràng. Quality gate chỉ cho
phép gắn nhãn authoritative business analysis khi toàn bộ window trong scope là `RECONCILED`; dữ liệu
`UNAVAILABLE`, `PROVISIONAL`, `RECONCILING` hoặc `DEGRADED` vẫn được hiển thị nhưng không được diễn giải
như số liệu business authoritative.

## Tài liệu

- Kiến trúc đích: repository `../System_Backbone`
- Quy tắc workspace: repository `../System_Cookbook`
- Layout và migration: [`docs/REPOSITORY_LAYOUT.md`](docs/REPOSITORY_LAYOUT.md)
- Time semantics: [`docs/TIME_SEMANTICS_CONTRACT_V1.md`](docs/TIME_SEMANTICS_CONTRACT_V1.md)
- Tài liệu trong `docs/` mô tả runtime V1 phải được xem là tài liệu migration cho
  đến khi được viết lại theo V2.
