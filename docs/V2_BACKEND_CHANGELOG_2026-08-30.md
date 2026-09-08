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
- Multi-replica coordination của Input Gateway có nền tảng tại mục 34; giới hạn phục hồi ở mục 35.
- Chưa triển khai reconciliation worker, matured/drop-off scheduler và late-arrival watermark policy.
- KPI hiện là profile/instance base facts và observed totals; product/category attribution cùng time
  window chưa triển khai vì contract tương ứng còn provisional/experimental.
- Dashboard UI đã đọc API V2 cho Overview, Funnels, Journeys, Events và Data Health; Settings dùng
  auth API thật. Các màn hình Product, Insights và session detail vẫn dùng mock data.
- Chưa bổ sung manifest deploy hoặc CI/CD mới; manifest k3s V1 đã bị loại khỏi runtime được duy trì.

## 12. Bước tiếp theo đề xuất

1. Chốt Product Attribution/Product × Window contract trước khi bỏ mock data ở màn hình Products.
2. Chốt segmentation/product attribution contract trước khi thêm Product KPI Matrix.
3. Chốt Time Semantics Contract trước khi triển khai matured drop-off và window rollup.
4. Sau đó mới xây reconciliation worker và data-quality gate cho analytics/AI.

## 13. Cập nhật Dashboard API V2

Read-only query layer đã được thêm sau bản tổng hợp ban đầu:

- `GET /api/v2/analytics/overview`
- `GET /api/v2/analytics/funnels/:profileId`
- `GET /api/v2/analytics/journeys`
- `GET /api/v2/analytics/journeys/:journeyId`
- `GET /api/v2/analytics/events`
- `GET /api/v2/analytics/data-health`

Các endpoint bắt buộc scope theo `source_id`, được bảo vệ bởi shop analytics auth/role zone và
không trả raw payload, identity value hoặc journey entity key. Funnel/overview response dùng
`metric_state: OBSERVED`; khoảng `from`/`to` chỉ là cohort filter theo `entry_at`, không tự nhận là
matured KPI window.

Dashboard API hiện có **84 unit/HTTP test pass** và **1 PostgreSQL integration test pass**. Integration
test áp dụng đủ bốn migration V2 rồi kiểm tra overview, funnel, privacy-safe journey/event response
và Data Health query trên PostgreSQL 15 thật.

## 14. Cập nhật Dashboard UI V2

Dashboard UI đã chuyển năm màn hình từ mock data sang Dashboard API V2:

- Login thật qua `/api/auth/login`, khôi phục phiên qua `/api/auth/me` và tự đăng xuất khi API trả `401`.
- `Overview` đọc profile instance totals, observed conversion và projection quality.
- `Funnels` đọc profile/version, reached steps và observed reach rate.
- `Journeys` đọc canonical event timeline, identity evidence summary và Funnel Instances; không hiển thị
  raw payload hoặc entity key.
- `Events` đọc canonical ledger metadata; không hiển thị payload, identity, relations hoặc aggregate ID.
- `Data Health` chỉ hiển thị time-basis, latency và projection-quality metric có dữ liệu chứng minh;
  metric chưa có durable evidence được liệt kê là unavailable.
- API URL, analytics `source_id` và workspace label được cấu hình bằng biến môi trường Vite.

Các màn hình Product, Insights và session detail vẫn là demo data. Product được gắn nhãn rõ vì
Product Attribution/Product × Window contract còn provisional. Production
build của Dashboard UI đã chạy thành công, không có lỗi TypeScript hoặc cảnh báo chunk vượt 500 kB.

## 15. Settings và tối ưu bundle Dashboard UI

- Settings hiển thị tài khoản từ auth context, workspace/source scope thật và đổi mật khẩu qua
  `PATCH /api/auth/change-password`; sau khi đổi thành công UI đăng xuất để đăng nhập lại.
- Workspace/source là cấu hình read-only; UI không còn nút lưu giả khi backend chưa có persistence.
- Các page route được lazy-load bằng React `Suspense`.
- Thay chart runtime bằng SVG React cho Data Health; loại bỏ cả `echarts-for-react` và `echarts`.
- Production build không còn chunk vượt ngưỡng 500 kB: entry chunk khoảng 247 kB và Data Health chunk
  khoảng 9 kB trước gzip sau khi nâng dependency.

## 16. HTTP contract test và dependency audit

- Bổ sung HTTP contract test chạy Express thật trên cổng tạm cho Analytics API V2.
- Test xác nhận request thiếu token trả `401`, role không thuộc shop trả `403`, query sai trả `400`,
  resource không tồn tại trả `404`, đồng thời `analyst/viewer` truy cập được endpoint hợp lệ.
- Dashboard API hiện có tổng cộng **85 test pass** khi bật PostgreSQL integration test.
- Audit ban đầu ghi nhận 5 advisory ở ECharts, Vite/esbuild và React Router. ECharts được loại bỏ;
  Vite/plugin-react được nâng lên 8/6 và React Router DOM được nâng lên 7.
- Production build sau từng bước đều thành công và `npm audit --audit-level=moderate` hiện trả
  **0 vulnerabilities**; không sử dụng `npm audit fix --force`.

## 17. OpenAPI V2 và contract drift guard

- Thêm `tools/api-docs/public/openapi-v2.yaml` cho đủ 6 Analytics API V2 endpoint.
- Swagger UI mặc định chọn Analytics V2 và giữ V1 trong dropdown để đối chiếu lịch sử.
- Tách `ANALYTICS_V2_PATHS` thành manifest không phụ thuộc runtime; Express router dùng trực tiếp
  manifest này thay vì lặp path string.
- Thêm validator parse YAML và so sánh chính xác OpenAPI paths với manifest Express; validator còn
  kiểm tra Bearer JWT, `source_id`, response `200`, marker `OBSERVED` và privacy-forbidden fields.
- API docs đã nâng lên Vite 8, khai báo Node engine, `npm test` và production build đều thành công.

## 18. Local V2 end-to-end runtime

- Thêm `infra/compose.v2.yml` cho Kafka KRaft một broker, PostgreSQL 15, Input Gateway và năm worker
  đang được duy trì; không đưa Dashboard, Medusa adapter, k3s hoặc CI/CD cũ vào stack này.
- Kafka topic được provision rõ cleanup policy; bốn migration PostgreSQL V2 được áp dụng khi tạo
  volume mới và hai Funnel Profile tham chiếu được publish idempotent trước Funnel Processor.
- Thêm Dockerfile Node dùng chung để build từng service từ lockfile và local contract packages.
- Thêm `tools/v2-e2e` phát chuỗi Commerce Conversion bốn bước qua HTTP auth thật, kiểm tra duplicate
  receipt, rồi poll PostgreSQL cho tới khi canonical ledger có 4 event, Journey Processor liên kết
  đúng 1 journey và KPI Projector materialize `CONVERTED` với `4/4` step.
- Smoke test đã chạy thành công trên Docker Compose thật. Stack dùng credential local cố định, dữ liệu
  sinh ngẫu nhiên theo từng run và không phụ thuộc hoặc thay đổi `Medusa_Reference`.
- Smoke test mở rộng đã xác nhận cả arrival order đảo ngược vẫn rebuild thành `CONVERTED 4/4` theo
  canonical event-time, còn event thiếu source timestamp được persist với
  `time_basis=ingress_fallback` và `authoritative_event_time=false`.
- Error-path E2E xác nhận unsupported semantic có terminal outcome `unsupported`, quarantine
  `mapping_not_found` và không tạo Canonical Ledger row; event hợp lệ kế tiếp vẫn được xử lý.
- Bổ sung PostgreSQL integration test cho journey evidence conflict. Transaction rollback đúng và
  không merge mù; terminal conflict/DLQ handoff vẫn là giới hạn chưa có contract được duyệt.

## 19. Durable ingress và canonicalization telemetry

- Thêm migration `005_ingress_telemetry.sql` cho unique accepted receipt, versioned
  canonicalization outcome và view latest outcome theo source event.
- Thêm `ingress-telemetry-writer`: chỉ commit Kafka offset sau khi PostgreSQL persist thành công,
  hỗ trợ redelivery idempotent và chặn immutable conflict.
- Compose V2 chạy thêm telemetry writer; E2E xác nhận 10 accepted receipt có đủ 10 terminal outcome,
  gồm 9 normalized và 1 unsupported.
- Data Health API/UI/OpenAPI công bố accepted count, terminal outcome rate, outcome distribution và
  canonicalization p50/p95 latency theo cửa sổ `received_at`.
- Demo seeder áp dụng đủ năm migration và tạo receipt/outcome tương ứng với 13 canonical event.
- Event loss trước gateway, duplicate/rejected attempt, queue drop và reconciliation vẫn là metric
  unavailable vì chưa có durable evidence tương ứng; hệ thống không dựng số thay thế.
- PostgreSQL giữ các mapping version mà writer đã quan sát. Topic compacted chỉ có thể rebuild bản
  mới nhất theo key nếu database bị mất hoàn toàn, nên đây chưa phải full historical replay guarantee.

## 20. Time Semantics Contract v1

- Thêm package `@funnelmetry/time-semantics-contract` và tài liệu runtime contract candidate; không
  thay đổi `System_Backbone` hoặc tự nâng numeric policy experimental thành approved default.
- Chuẩn hóa `occurred_at` cho business ordering, `ingested_at` cho arrival, `observed_at` cho clock
  đánh giá tường minh và `entry_at` làm gốc của Funnel Instance window.
- Horizon và grace phải được cấu hình cùng nhau. Cả hai `null` trả `UNCONFIGURED`, không được suy ra
  final drop-off hoặc final KPI denominator.
- Funnel Processor dùng validator chung khi publish/load profile, nên time policy cấu hình nửa vời
  bị reject; hai reference profile `null/null` vẫn tương thích và không đổi projection hiện tại.
- Phân biệt `PENDING`, `SUSPECTED_DROPOFF`, `MATURED` độc lập với outcome và quality state.
- Phân loại event thành on-time, late within grace, too late, after horizon, non-authoritative hoặc
  unresolved clock skew; không tự đặt skew tolerance.
- Mười unit test khóa policy validation, inclusive event-admission boundary và chỉ cho maturity bắt
  đầu sau cuối grace,
  tránh race với event đến đúng tại finalization timestamp.
- Chưa thêm scheduler/migration lifecycle. Gate tiếp theo là chốt persistence cho maturity evidence,
  transition timeout, eligibility, late conversion và idempotent scheduler handoff.

## 21. Funnel maturity persistence foundation

- Thêm migration `006_funnel_maturity.sql`: transition timeout immutable theo profile/version và
  maturity evaluation append-only theo revision, kèm latest-state view.
- Maturity evidence lưu outcome/quality snapshot, authoritative entry-time, deadline/finalization,
  eligibility và reason; database kiểm tra shape theo từng maturity state.
- Repository khóa Funnel Instance, kiểm tra deadline khớp immutable profile policy, tự suy ra
  eligibility/maturity bằng `time-semantics.v1`, chặn stale evaluation và hỗ trợ stable-ID redelivery.
- Repository không mutate `funnel_instances`, không kết luận `DROPPED` và không phát KPI handoff.
- Funnel Profile publisher persist/round-trip transition timeout; timeout phải trỏ tới một step sau
  entry step. Integration test cũ được cô lập trong schema ngẫu nhiên để không phụ thuộc demo volume.
- Compose có one-shot `postgres-migrations`, áp dụng idempotent migration `001–006` trước mọi
  PostgreSQL worker cho cả volume mới và volume đã tồn tại.

## 22. Coordinated maturity polling

- `funnel-maturity-scheduler` đã có runtime polling theo batch và cấu hình môi trường riêng.
- Một PostgreSQL advisory lock theo session bảo đảm chỉ một replica làm leader; standby thử nhận lại
  leadership ở mỗi poll, không cần bảng lease hoặc timeout tự đặt thêm.
- Candidate query chỉ chọn Funnel Instance còn `IN_PROGRESS` đã đến transition timeout hoặc quá
  `conversion horizon + late-arrival grace`, đồng thời bỏ qua maturity evidence không đổi.
- Repository vẫn khóa và tính lại từng candidate trước khi append evidence, nên kết quả truy vấn cũ
  không được dùng trực tiếp để quyết định trạng thái.
- Compose V2 chạy scheduler sau migration. Reference profile vẫn `null/null`, vì vậy worker chạy idle
  và không tự tạo numeric time policy.
- Chưa mutate outcome thành `DROPPED` và chưa phát matured KPI. Atomic outcome/KPI handoff cùng
  late-conversion evidence vẫn là gate kế tiếp.

## 23. Gated atomic drop-off finalization

- Thêm package `@funnelmetry/kpi-snapshot-contract` để KPI Projector và maturity finalizer dùng cùng
  một snapshot shape/hash, tránh hai implementation diễn giải projection khác nhau.
- Migration `007_maturity_finalization.sql` thêm projection identity và append-only finalization
  evidence. Migration tương thích insert cũ bằng trigger canonical-event identity mặc định.
- Finalizer chỉ nhận latest `MATURED + ELIGIBLE` evidence của Funnel Instance còn `IN_PROGRESS`, khóa
  instance và yêu cầu KPI projection hash hiện tại đã bắt kịp.
- `funnel_instances.outcome_status`, KPI outcome/hash/revision và finalization evidence được cập nhật
  trong cùng một PostgreSQL transaction; KPI thiếu/stale làm toàn bộ transaction rollback.
- Runtime có retry queue từ latest maturity evidence chưa finalization và stable finalization ID.
  Một candidate lỗi không chặn phần còn lại của batch.
- `MATURITY_SCHEDULER_FINALIZATION_ENABLED` mặc định và Compose đều là `false`. Chưa bật final drop-off
  trước khi late-conversion evidence/path được triển khai; reference profile vẫn không có numeric policy.

## 24. Late conversion without historical KPI rewrite

- Migration `008_late_conversion.sql` thêm ledger `funnel_late_conversions` append-only, idempotent theo
  Funnel Instance và giữ tham chiếu tới finalization/KPI snapshot chính thức.
- Funnel Processor coi instance `DROPPED` đã finalization là projection đóng: không dựng lại step/branch,
  không đổi outcome và không phát instance update khiến KPI Projector sửa snapshot cũ.
- Chỉ final `BUSINESS_FACT` có authoritative source occurrence time và liên kết `STRONG` qua business
  entity `CART/CHECKOUT/ORDER/PAYMENT` mới đủ điều kiện ghi late conversion.
- Journey evidence ưu tiên strong business entity cao hơn opaque correlation khi event có cả hai, đúng
  progressive business anchoring; correlation-only vẫn là strong fallback hợp lệ cho journey linking.
- Phân biệt `TOO_LATE_FOR_FINAL_COHORT` (occurred trong horizon nhưng ingest sau grace) với
  `AFTER_HORIZON`; cả hai đều không sửa metric thuộc horizon đã chốt.
- Late-conversion document lưu loại business entity và phương pháp liên kết nhưng không lưu entity key,
  tránh đưa identifier nghiệp vụ vào analytics evidence không cần thiết.
- Unit/integration test khóa strong-key/time-authority guard, append-only/idempotent evidence và bất biến
  của Funnel Instance, official steps, KPI outcome, revision và hash sau finalization.
- Compose và `.env.example` bật finalization gate sau khi late-conversion path đã có; default trong code
  vẫn là `false` để deployment thiếu cấu hình không tự thay đổi outcome.

## 25. Privacy-safe late-conversion analytics read model

- Overview và Funnel API tổng hợp `finalized_dropped`, `late_conversions`, arrival-class breakdown và
  `late_conversion_rate` theo cùng entry cohort/profile/version.
- Mẫu số late-conversion rate được định nghĩa tường minh là số eligible instance đã atomic finalization
  thành `DROPPED`; không cộng late conversion vào `observed_converted` của horizon cũ.
- Journey list chỉ công bố `has_late_conversion`; Journey detail trả classification, timestamps,
  link method/confidence và business entity type nhưng không trả matched entity key/document nội bộ.
- OpenAPI và typed dashboard client được mở rộng tương thích; chưa thay đổi cách UI render.
- PostgreSQL integration test chứng minh official step/KPI vẫn là drop-off trong khi late evidence có thể
  được đọc riêng, đồng thời unit test khóa zero-denominator và privacy-safe query shape.

## 26. Eligible matured conversion cohort

- Migration `009_matured_conversion.sql` bổ sung `authoritative_conversion_time` vào append-only
  maturity evidence và reason `NON_AUTHORITATIVE_CONVERSION_TIME`.
- Scheduler poll cả `IN_PROGRESS` lẫn `CONVERTED`; transition timeout vẫn chỉ áp dụng cho instance đang
  tiến hành, còn cả hai chỉ thành `MATURED` sau đúng horizon + grace của profile version.
- Converted instance chỉ `ELIGIBLE` khi policy đã cấu hình, entry time authoritative và representative
  final-step conversion time authoritative. Fallback-time conversion vẫn giữ observed outcome nhưng bị
  loại khỏi final denominator.
- Drop-off finalizer vẫn chỉ nhận `IN_PROGRESS`; thay đổi này không mở đường mutate converted outcome.
- Analytics API công bố riêng `eligible_matured`, `matured_converted`, `final_end_to_end_rate` và
  `final_dropoff_rate`; late conversion không được cộng ngược vào matured conversion.

## 27. Reconciliation Manifest v1 foundation

- Thêm package `@funnelmetry/reconciliation-contract` cho internal manifest độc lập transport;
  REST, CSV/export và MQ control message có thể cùng normalize về contract này.
- Validator khóa source/snapshot identity, entity type, coverage/timezone, `as_of`, closure/completeness,
  watermark/grace, schema/semantic version, record identity/version, money và control totals.
- Record-level manifest phải có entity ID duy nhất, version hoặc authoritative `updated_at`, và
  `control_totals.record_count` khớp số record. Amount được giữ bằng decimal string theo currency,
  không ép qua floating point.
- Chỉ closed + complete + record-level snapshot được phép vào `RECONCILING` và có record-level
  repair capability. Open snapshot chỉ `PROVISIONAL`; incomplete/aggregate-only snapshot `DEGRADED`
  với limitation reason tường minh.
- Manifest hash được canonical hóa theo record/entity, currency, field set và JSON object key để retry
  khác thứ tự không tạo evidence identity mới.
- Batch này chưa thêm persistence/worker, chưa repair current projection, không tạo historical event
  và không tự đặt discrepancy threshold.

## 28. Append-only reconciliation snapshot persistence

- Thêm migration `010_reconciliation_evidence.sql` cho snapshot metadata, normalized record và
  currency-grouped control totals. Ba bảng đều append-only và cùng giữ source-scoped snapshot identity.
- Persist riêng coverage/scope/timezone, closure/completeness, watermark/grace, schema/semantic version,
  capability state, limitation reason, control totals và canonical manifest hash/document để audit/replay.
- `reconciliation-worker` repository validate manifest trước khi mở transaction, sau đó ghi snapshot,
  record và amount totals atomically; lỗi giữa chừng rollback toàn bộ evidence.
- Retry cùng `(source_id, snapshot_id)` và cùng semantic hash trả `duplicate`; tái sử dụng identity với
  manifest khác bị reject thay vì ghi đè hoặc trộn hai snapshot.
- Database khóa capability invariant: open chỉ `PROVISIONAL`, closed + complete + record-level mới
  `RECONCILING`, incomplete/aggregate-only phải `DEGRADED` và không có record-level repair permission.
- Integration test áp dụng migration hai lần, kiểm tra atomic persistence, idempotency, immutable conflict,
  append-only trigger và aggregate-only limitation.
- Batch này vẫn chưa so sánh source với analytics, chưa ghi discrepancy/repair và không mutate raw/canonical
  history hoặc current projection.

## 29. Revisioned reconciliation discrepancy evidence

- Mở rộng reconciliation contract với comparator yêu cầu analytics current projection có cùng
  `source_id`, `entity_type`, coverage/timezone/scope và `as_of` không cũ hơn source snapshot.
- Comparator tách `MISSING`, `PHANTOM`, `STATE_MISMATCH` và `AMOUNT_MISMATCH`; một entity có thể mang
  cả state lẫn amount mismatch thay vì bị ép vào một reason duy nhất.
- Count rate dùng đúng mẫu số source/analytics theo Master và trả `null` khi denominator rỗng. Revenue
  deviation được tính riêng theo currency bằng decimal/BigInt, không dùng floating point cho monetary value.
- Closed + complete + record-level snapshot chỉ `RECONCILED` khi không còn record discrepancy hoặc
  control-total mismatch; nếu còn mismatch thì giữ `RECONCILING`. Aggregate-only/incomplete vẫn `DEGRADED`
  và record-level metric tiếp tục unavailable.
- Migration `011_reconciliation_comparison.sql` lưu comparison revision, exact analytics observation set,
  summary/rates, revenue deviation và từng discrepancy bằng append-only evidence.
- Repository khóa snapshot trong lúc cấp revision, commit summary/observations/discrepancies atomically,
  replay cùng comparison identity/hash idempotent và reject immutable conflict.
- Comparator không đọc CanonicalEvent cuối để dựng current state. Provider cho current Order/Payment/Revenue
  projection và correction ledger vẫn là gate tiếp theo; batch này chưa repair hoặc bịa historical event.

## 30. Revisioned current projection and auditable repair

- Thêm migration `012_reconciliation_current_projection.sql` với immutable projection revisions/records,
  một mutable head được ràng buộc FK theo exact `source/entity/coverage`, cùng append-only repair và
  per-entity correction evidence.
- Reconciliation contract công khai validator/hash cho analytics projection và stable coverage identity;
  record ordering, JSON scope và decimal money tiếp tục được normalize trước khi hash.
- `reconciliation-worker` có provider `recordCurrentProjection`/`getCurrentProjection`; comparison có thể
  tự lấy head đúng scope thay vì nhận projection ad-hoc từ caller.
- `repairComparison` chỉ nhận comparison `RECONCILING` gắn snapshot closed, complete, record-level; stale,
  `RECONCILED`, aggregate-only và incomplete evidence đều bị từ chối.
- Repair tạo projection revision authoritative mới, ghi correction `UPSERT`/`REMOVE` theo entity rồi đổi
  head trong cùng transaction. Raw/canonical history và historical funnel không bị mutate hoặc dựng lại.
- Advisory transaction lock serialize revision theo coverage; replay cùng identity idempotent, còn reuse
  identity với immutable input khác bị reject.
- Projection head không được lùi `as_of`; khi version khác nhau, repair yêu cầu `updated_at` so sánh được
  và reject source record cũ hơn thay vì tự đoán thứ tự version theo chuỗi.
- `verifyRepair` liên kết một comparison revision sau repair, tính `repair_success_rate` theo correction
  entity với denominator-empty state và ghi riêng trạng thái hội tụ toàn projection; không đặt threshold.

## 31. Data Health reconciliation evidence and authoritative quality gate

- Dashboard API tổng hợp latest comparison revision theo từng snapshot trong window `coverage_end_at`;
  comparison revision cũ không bị cộng lặp vào Data Health.
- Công bố snapshot quality states, record-level discrepancy counts/rates, exact revenue deviation và
  repair verification. Metric thiếu evidence hoặc denominator tiếp tục trả `null` và xuất hiện trong
  `unavailable_metrics`, không dựng số 0 giả.
- Thêm quality gate với trạng thái `UNAVAILABLE`, `PROVISIONAL`, `RECONCILING`, `RECONCILED`, `DEGRADED`.
  Chỉ scope hoàn toàn `RECONCILED` mới eligible cho authoritative business analysis; đây không phải global
  kill-switch cho UI hoặc các phép quan sát kỹ thuật.
- Data Health UI hiển thị reconciliation, repair verification và trạng thái gate. OpenAPI và TypeScript
  response contract được cập nhật tương ứng.
- Demo seed thêm một ORDER snapshot/comparison record-level đã `RECONCILED` để UI local trình bày evidence
  thật, đồng thời giữ repair metric unavailable khi chưa có repair verification.

## 32. Master-aligned Medusa input semantics

- Đồng bộ Browser SDK installer với manifest reference mới: `behavior.product_viewed`,
  `cart.add_clicked`, `checkout.started`; loại namespace `commerce.*` cũ khỏi generated binding.
- Add-to-cart browser hook phát intent trước business request. Nó không được đổi tên hoặc diễn giải thành
  authoritative `cart.item_added`.
- Canonical Normalizer nạp mapping source-native từ artifact versioned trong `integrations/medusa`, giữ
  core generic. Mapping baseline duy nhất là `medusa.order_placed -> order.created` `BUSINESS_FACT`;
  không fabricate `order.accepted`, payment hoặc cart persistence.
- Capability report của planner công bố `cartItemPersisted` và `orderAccepted` là `NOT_SUPPORTED`, còn
  Commerce Conversion là `IN_PROGRESS`.
- E2E tách strict Commerce Conversion 4/4 thành pipeline self-test và thêm Medusa input scenario riêng:
  bốn input được canonicalize, order dừng ở `order.created`, không claim Medusa conversion 4/4.
- Dashboard synthetic seed sửa authority của strict reference event `cart.item_added` thành
  `BUSINESS_FACT`; seed này là UI fixture, không phải evidence về capability Medusa.

## 33. Transport-neutral reconciliation operations CLI

- Bổ sung CLI thủ công cho `reconciliation-worker` với năm lệnh `snapshot`, `projection`, `compare`,
  `repair` và `verify`; mỗi lệnh nhận đúng request JSON của repository hiện có.
- CLI chỉ orchestration contract/repository, không tự chọn source transport, không đọc Medusa và không
  mở REST/MQ contract mới khi ranh giới integration chưa được chốt.
- Kết quả được ghi JSON ra stdout, lỗi validation/persistence trả exit code khác 0 và PostgreSQL pool
  luôn được đóng. Credential chỉ đọc từ `RECONCILIATION_DATABASE_URL` hoặc `DATABASE_URL`, không nhận
  qua command line.
- Unit test khóa dispatch cả năm command, help path không mở database, bắt buộc config database và
  cleanup khi repository trả lỗi. Toàn bộ 11 test, gồm 2 PostgreSQL integration test, đã chạy thành công.

## 34. Distributed Input Gateway receipt coordination

**Đính chính 2026-09-06:** đây là implementation ban đầu, chưa hoàn thiện multi-replica.
Các mô tả takeover/fingerprint và xác nhận E2E bên dưới được thay thế bởi mục 35.

- Migration `013_ingress_coordination.sql` thêm coordination ledger theo `(source_id,event_id)`, stable
  `ingestion_id`, semantic event fingerprint, owner token và lease có thể takeover giữa các replica.
- PostgreSQL chỉ điều phối claim trong hạ tầng Funnelmetry; Kafka transaction vẫn là Raw Durable Ingress
  và Gateway chỉ chuyển claim sang `ACCEPTED` sau khi Kafka commit thành công.
- Retry trong lúc replica khác giữ lease trả retryable failure. Sau lease/release, replica mới dùng lại
  receipt và `ingestion_id` ban đầu; cùng identity nhưng semantic payload khác trả
  `event_identity_conflict` thay vì ghi raw record mâu thuẫn.
- Receipt Kafka đã tồn tại được adopt vào ledger khi gặp lại. Migration cũng backfill receipt telemetry cũ;
  do schema cũ chưa có fingerprint, payload đầu tiên gặp lại sẽ gắn fingerprint và limitation này được
  công bố trong runtime README.
- `single_replica` vẫn là compatibility mode. Compose V2 bật `postgres`, chờ migration hoàn tất trước khi
  chạy Gateway và dùng database Funnelmetry, không nhận quyền database của source/Medusa.
- 28/28 Input Gateway test đã qua, gồm PostgreSQL integration test cho hai replica/lease takeover/conflict.
  Compose config hợp lệ và full pipeline E2E kết thúc với exit code 0.

## 35. Gateway failure-path corrections (2026-09-06)

- Chặn takeover chỉ dựa vào lease hết hạn. Kafka commit có thể đã thành công dù client không nhận
  được kết quả; tự gửi lại có thể append raw hai lần với cùng ingestion ID.
- Chỉ release sau lỗi trước commit và abort thành công. Commit không xác định làm Gateway unready;
  khởi động lại replay receipt. Claim không có evidence vẫn pending, cần cơ chế fencing/recovery tiếp theo.
- Giữ receipt trong cache ngay sau Kafka commit, trước PostgreSQL completion. Adopt chỉ hoàn tất claim
  có ingestion ID/fingerprint khớp và không gán fingerprint lịch sử từ request retry.
- Transaction trên cùng KafkaJS producer được chạy tuần tự cả khi khác event key.
- PostgreSQL integration test kiểm tra claim đồng thời, lease hết hạn, khôi phục từ receipt và fingerprint
  thiếu; fault injection kiểm tra mất DB sau commit, commit không xác định và transaction đồng thời.
- E2E thực sự chạy qua runner: ordered/out-of-order CONVERTED 4/4; Medusa input IN_PROGRESS;
  telemetry accepted=14, terminal=14, normalized=13, unsupported=1. Không coi đây là kill-process test
  hay chứng minh tự động phục hồi hoàn chỉnh của hai Gateway.

## 36. Committed receipt recovery and process fault drill

- Consumer Kafka `read_committed` tự hoàn tất claim có receipt document/ingestion ID khớp, kể cả claim
  thuộc replica đã chết. Producer completion tương thích với consumer đã hoàn tất cùng claim.
- Receipt sai bị từ chối; receipt không có claim lịch sử không tạo fingerprint từ dữ liệu retry.
- Test dùng HTTP Gateway ở tiến trình độc lập, Kafka và PostgreSQL thật: gửi cùng event đồng thời,
  kiểm tra conflict, SIGKILL ngay sau commit và restart. Hai event chỉ tạo hai raw record;
  claim đã tự phục hồi trước HTTP retry. Hook SIGKILL nằm riêng trong fixture test.
- Topics/schema ngẫu nhiên của test được dọn sau chạy. Đây là kiểm chứng crash sau commit;
  network partition và claim không có receipt vẫn cần broker fencing/recovery bổ sung.
- Kiểm chứng: 32/32 Gateway test pass (không skip), fault drill raw=2 unique=2;
  E2E toàn pipeline PASS với accepted=14 terminal=14 normalized=13 unsupported=1.

## 37. Pre-commit crash and database connection fault drill

- Mở rộng fixture test để SIGKILL Gateway sau khi gửi raw/receipt nhưng trước Kafka commit.
  Retry từ replica sống vẫn trả retryable failure dù lease hết hạn; claim giữ `CLAIMED`.
  Consumer `read_committed` không nhận event của transaction chưa commit.
- TCP proxy riêng của test từ chối kết nối PostgreSQL mới trước claim: HTTP trả retryable failure,
  database không có claim cho event đó. Mở lại kết nối rồi retry được `accepted`.
- Quan sát tổng cộng ba raw record đã commit cho ba event hợp lệ; không có raw của event bị kill
  trước commit. Không thay đổi runtime, API contract, Medusa, AI hoặc cấu hình `.env`.
- Kiểm chứng: fault drill Kafka/PostgreSQL thật PASS riêng (1 test, khoảng 137 giây);
  31 test Gateway còn lại PASS trong lượt chạy riêng, loại fault drill bằng name filter.
  Không chạy lại E2E toàn pipeline cho thay đổi chỉ gồm test/tài liệu này.
- Giới hạn: đây là kiểm tra fail-safe, không phải tự phục hồi claim trước commit. TCP refusal trước
  claim không chứng minh xử lý mọi network partition; broker fencing/recovery vẫn chưa triển khai.

## 38. Receipt replay readiness barrier correction

- Phát hiện prerequisite cho recovery: `batch.highWatermark` là mốc broker, không phải vị trí
  consumer đã xử lý. Dùng mốc đó sau batch đầu có thể cho Gateway ready khi còn receipt chưa replay.
- Dùng `batch.lastOffset() + 1` sau khi xử lý thành công toàn batch, so với target startup của từng
  partition. Theo dõi thêm `END_BATCH_PROCESS` cho batch chỉ có control/aborted records; KafkaJS
  không gọi `eachBatch` cho chúng. Offset giữ kiểu BigInt, không mất chính xác khi vượt safe integer.
- Giữ lỗi consumer trong startup để không ghi đè trạng thái lỗi thành ready khi replay vừa hoàn tất.
- Thêm regression test cho replay nhiều batch, nhiều partition, control-only batch, topic khác,
  offset lớn và consumer crash trong startup.
- Không mở takeover/release claim mới. Barrier này là điều kiện cần, chưa thay thế broker fencing
  và transaction-outcome verification cho automatic recovery.
- Kiểm chứng: toàn bộ 35/35 Gateway test PASS, không skip, gồm PostgreSQL integration và HTTP
  multi-process fault drill với Kafka thật (raw committed=3, không có event chưa commit).
  Không chạy lại E2E downstream toàn pipeline trong lượt này.

## 39. Read-only claim inspection CLI

- Thêm `npm run claims:inspect -- <source_id> [event_id]` để kiểm tra coordination ledger;
  dùng database environment hiện có, không tự nạp hoặc sửa `.env`.
- Phân biệt pending transaction evidence, explicit release, accepted trong ledger và thiếu fingerprint.
  Không suy ra quyền takeover từ lease hết hạn; không claim đã xác minh Kafka outcome.
- SQL parameterized, bắt buộc source scope, giới hạn kết quả, transaction READ ONLY và statement
  timeout. Không xuất payload, receipt document, fingerprint hoặc owner token; không có mutation command.
- Sáu test mới kiểm tra phân loại, giới hạn, CLI/config/cleanup và PostgreSQL thật: snapshot toàn ledger
  trước/sau inspection không đổi, source khác không lọt vào kết quả.
- Kiểm chứng: 40 test PASS, 1 Kafka process fault test SKIP vì lượt này chỉ bật PostgreSQL.
  Không thay đổi đường ingestion/recovery runtime, không chạy lại full pipeline E2E.
- Automatic recovery trước commit vẫn chưa triển khai: cần durable producer binding, fencing và
  outcome barrier sau fencing; CLI này chỉ phục vụ chẩn đoán.

## 40. Automatic pre-send claim recovery on retry

- Migration 014 thêm guard gắn owner và trạng thái cấp quyền gửi. Claim lịch sử mặc định đã cấp
  quyền/không đủ evidence, không tự chuyển thành chưa gửi.
- Gateway bắt buộc authorizeSend bằng atomic UPDATE trước khi mở Kafka transaction. Claim mới chưa
  được cấp quyền và hết lease được retry tự takeover, giữ nguyên receipt/ingestion ID.
- Takeover và cấp quyền serialize trên cùng PostgreSQL row. Owner cũ không gửi được sau takeover;
  owner được cấp quyền trước thì ngăn takeover. Mất phản hồi authorizeSend không tự release claim.
- CLI nhận biết pre-send lease active và pre-send retry eligible. Không suy ra trạng thái từ lease
  nếu owner guard không khớp hoặc đã cấp quyền gửi.
- Thêm SIGKILL trước authorizeSend vào process drill; kiểm tra retry giữ stable ID và một raw record.
  Bổ sung regression cho owner cũ, cấp quyền lặp, race authorize/takeover, legacy owner và legacy insert.
- Phạm vi: chỉ recovery **trước authorizeSend**, kích hoạt bởi source retry; không phải background
  resend. Crash sau cấp quyền hoặc transaction outcome chưa xác định vẫn pending. Broker fencing
  và recovery cửa sổ đó chưa triển khai. Không nâng cấp database runtime trong lượt này.
- Kiểm chứng: 42/42 Gateway test PASS, không skip, gồm process fault drill raw=4 và pre-send recovery.
  Sau khi bổ sung thêm assertion race/legacy/inspector, chạy lại 7 test liên quan: 7/7 PASS.
  Không chạy full downstream pipeline E2E; đã dọn schema/topic test và dừng Kafka/PostgreSQL test.

## 41. Eager transactional initialization and stale-producer fencing

- KafkaJS hiện cài chỉ khởi tạo transactional producer ở `transaction()`, không ở `connect()`.
  Runtime nay mở/abort transaction rỗng trước replay/ready, không append raw hoặc receipt.
- Replacement cùng client/instance ID khởi tạo epoch mới để fence producer cũ đã khởi tạo.
  Lỗi INVALID_PRODUCER_EPOCH/PRODUCER_FENCED hạ readiness kể cả khi abort rỗng thành công.
- Unit test khóa thứ tự startup, cleanup khi initialization/abort lỗi và trạng thái unready sau fencing.
  Process drill thêm hai Gateway cùng instance ID: producer cũ chưa từng gửi event cũng phải bị chặn,
  replacement nhận event và retry không tạo raw trùng.
- Không bổ sung tự release claim đã cấp quyền gửi. Vẫn thiếu durable claim-to-producer-generation
  binding và recovery policy sau fencing; không claim full automatic recovery hoặc full HA.
- Kiểm chứng lượt trước: 44/44 Gateway test PASS, không skip; old producer health=503, replacement
  accepted rồi duplicate, raw committed=5. Bước ghi kết quả cuối lượt bị giới hạn công cụ nên bổ sung ở đây.

## 42. Durable producer-generation evidence per send authorization

- Migration 015 tạo `ingress_send_attempts`, lưu source/event, owner, ingestion ID, transactional ID,
  mã runtime boot generation và thời điểm authorize. Không backfill evidence lịch sử bằng suy đoán.
- Runtime bind danh tính producer sau transactional initialization, trước replay/ready. Coordinator
  từ chối authorize nếu chưa bind hoặc bị yêu cầu đổi danh tính trong cùng coordinator.
- Authorize và INSERT attempt nằm trong một SQL statement: ghi evidence lỗi thì cấp quyền rollback.
  Retry qua owner mới tạo attempt mới, không ghi đè lịch sử lần gửi cũ.
- CLI hiển thị producer attempt của owner hiện tại (không xuất owner token). Generation là boot ID
  của ứng dụng, không phải Kafka epoch; trường null nghĩa thiếu evidence, không chứng minh chưa gửi.
- Đây là liên kết phục vụ recovery, chưa là generation registry/revocation hay bằng chứng Kafka
  transaction đã abort. Không bổ sung release tự động cho claim đã cấp quyền gửi.
- Kiểm chứng: 45/45 Gateway test PASS, không skip, gồm Kafka/PostgreSQL process drill; thêm kiểm tra
  hai boot generation, cùng transactional ID/ingestion ID và chỉ một raw cho event replacement.
  Sau bổ sung producer attempt vào CLI, chạy lại 6 test inspector: 6/6 PASS.
  Migration chỉ chạy trong schema test; chưa áp dụng 015 vào database runtime, chưa chạy full downstream E2E.

## 43. Producer-generation registry and authorization revocation (2026-09-07)

- Migration 016 lưu current generation/phase theo transactional ID; không suy diễn từ attempt lịch sử.
- Startup đăng ký INITIALIZING trước Kafka initialization, chỉ CAS sang READY sau receipt replay nếu
  vẫn là current generation. Startup bị thay thế phải fail; không tái sử dụng runtime/coordinator đã dừng.
- AuthorizeSend giữ khóa SHARE trên generation đang READY trong cùng SQL statement với guard/attempt;
  replacement UPDATE registry thu hồi quyền cấp phép của generation cũ. Khi bị từ chối do generation,
  Gateway hạ readiness trước khi mở transaction Kafka. Chưa có background watcher cho readiness.
- Unit/PostgreSQL test kiểm tra generation cũ, startup chưa ready/bị thay thế, slot độc lập; process
  drill kiểm tra old Gateway health=503, không có send attempt, retry từ replacement sau lease hết hạn.
- Registry không thay thế Kafka fencing cho send đã được cấp quyền. Startup chồng nhau vẫn có thể
  gây gián đoạn; chưa bật tự release claim đã authorize khi commit outcome không xác định.
- Kiểm chứng: lượt đầu phát hiện lỗi trùng tên biến trong PostgreSQL test, đã sửa; chạy lại 46 unit/
  PostgreSQL test PASS (Kafka drill skip ở lượt này). Kafka process drill ở lượt riêng cũng PASS,
  raw committed=5, generation cũ không tạo send attempt. Không claim một lượt 47/47 clean run.
- Chưa chạy full downstream E2E hoặc áp dụng migration 016 vào database runtime. Schema/topic test
  được dọn; các container Kafka/PostgreSQL test được dừng, dữ liệu runtime giữ nguyên.

## 44. Opt-in post-fence claim recovery (2026-09-07)

- Migration 017 ghi Kafka scope của attempt và audit recovery; không backfill attempt cũ.
- `INPUT_GATEWAY_RECOVER_FENCED_CLAIMS` mặc định false và yêu cầu PostgreSQL. Khi bật, runtime
  kiểm tra cluster ID và compact-only receipt topic; sau same-ID fencing và complete read_committed
  replay mới release pending claim đúng owner/guard/scope của generation cũ. Receipt đã commit
  được hoàn tất trước. Source retry giữ ingestion ID; không có worker tự gửi lại.
- Khóa current INITIALIZING generation, release và audit atomic; generation bị thay thế, scope
  thiếu/sai, slot khác hoặc audit lỗi không được release. Không suy diễn từ lease expiry.
- Bắt buộc lịch sử receipt còn nguyên: cấu hình compact hiện tại không chứng minh điều này.
  Topic recreation, tombstone, delete-records/retention và restore không đồng bộ không được hỗ trợ.
  Khi không xác nhận được history, phải giữ recovery tắt. Chưa claim full HA/network-partition recovery.
- Kiểm chứng: sửa lỗi CommonJS named import KafkaJS; lượt toàn bộ Gateway sau sửa PASS 50/50,
  không skip, gồm PostgreSQL và Kafka process drill. SIGKILL trước commit rồi restart cùng ID:
  claim được release kèm audit, retry accepted/duplicate đúng ID, chỉ một raw record cho event;
  tổng raw committed của drill là 6. Test scope mismatch, accepted-skip và audit rollback đều PASS.
- Bổ sung test ngăn recovery trước replay/sau consumer crash; sửa test double thiếu confirmReceipt,
  chạy riêng runtime suite PASS 10/10. Lượt 50/50 ở trên chưa chứa test bổ sung này.
- Chưa bật recovery hoặc chạy migration 014–017 trên database runtime, chưa full downstream E2E.
  Không sửa Medusa/AI, không commit/push. Tài nguyên schema/topic test được tự dọn sau test.

## 45. Full pipeline smoke and concurrent HTTP retry checks (2026-09-07)

- Bổ sung vào `tools/v2-e2e`: chờ đủ bốn KPI projection applications rồi gửi 12 retry đồng thời
  cho mỗi Commerce scenario. Kiểm tra duplicate cùng ingestion ID, raw-topic offsets không đổi,
  bốn canonical rows/journey links, KPI instance/step facts không đổi kể cả revision/occurrence count.
  Thêm HTTP timeout 15 giây và xác nhận total_step_count=4.
- Build backend hiện tại và chạy trên project riêng `funnelmetry-e2e-20260907`, volume Kafka/PG mới;
  migration 001–017 chỉ áp dụng trong project test, không migrate volume runtime `funnelmetry-v2`.
  Image tags `:local` được cập nhật khi build; recovery vẫn tắt mặc định.
- E2E PASS (exit 0): ordered và reverse-arrival đều canonical=4, journeys=1, CONVERTED 4/4;
  tổng 24 retry đồng thời giữ ID, không thêm raw và không đổi analytics. Unsupported có quarantine,
  canonical=0; thiếu source timestamp giữ ingress_fallback/non-authoritative.
  Telemetry accepted=14, terminal=14, normalized=13, unsupported=1.
- Run evidence: ordered `8a79ee8e-770d-42a4-9fee-232d9be167b6`,
  out-of-order `960d1b42-fa40-40ac-94f7-027333d39ce7`.
- Đây là HTTP retry end-to-end smoke tới PostgreSQL analytics, không phải kiểm thử Kafka redelivery,
  crash downstream worker, Dashboard UI hoặc Medusa thực tế. Không làm AI/Medusa, không commit/push.
  Stack test được dừng và giữ volume để tra evidence; không xóa dữ liệu runtime.

## 46. KPI Projector downtime/backlog recovery drill (2026-09-07)

- Chạy lại E2E trên project riêng `funnelmetry-e2e-20260907`, giữ KPI Projector dừng khi gửi
  bốn event đầu. Trước restart: canonical tăng 13 → 17, KPI applications giữ 13; bốn event của
  run `e1f3d77a-1ff6-45fa-8178-ba3e6db2143d` chưa có application. Consumer group không có member,
  current offset=25, log-end=34, lag=9 (offsets không tương đương số business event).
- Start lại đúng worker/group, không reset offset, không seed hoặc gửi lại event gốc.
  Runner PASS: ordered/reverse-arrival đều CONVERTED 4/4; 24 retry đồng thời không thêm raw
  hoặc đổi analytics; telemetry lượt mới accepted=14, terminal=14, normalized=13, unsupported=1.
- Sau test, toàn bộ dataset hai lượt có canonical=26 và KPI applications=26. Consumer offset=51,
  log-end=52, lag=1; không claim lag bằng 0. Kafka transaction control positions có thể góp vào lag,
  nên kết luận business processing dựa trên application và projection assertions, không chỉ offset.
- Bổ sung runbook trong `tools/v2-e2e/README.md`. Đây là downtime/backlog recovery, chưa phải
  crash đúng cửa sổ giữa PostgreSQL commit và Kafka commit. Không thay code worker trong lượt này.
- Dừng riêng stack E2E, giữ volume evidence. Demo Dashboard/UI và database demo vẫn mở;
  không sửa AI/Medusa hoặc database pipeline runtime, chưa commit/push.

## 47. KPI crash after PostgreSQL commit, before Kafka transaction (2026-09-07)

- Thêm process integration test và fixture riêng cho KPI Projector. Process đầu gọi repository thật,
  sau COMMIT PostgreSQL bị SIGKILL trước khi runtime mở Kafka transaction. Process thứ hai dùng
  cùng group/transactional ID, replay message thật từ Kafka, không reset offset.
- Assertions: trước restart có application và KPI revision=1/occurrence=1, input offset chưa commit
  (-1), output topic rỗng. Sau replay có committed duplicate handoff, input offset=1, toàn bộ snapshot
  instance/step/application không đổi. SQL schema và Kafka topics có UUID riêng, tự dọn sau test.
- Lượt đầu qua bind mount toàn repo thiếu node_modules KPI; chuyển sang image KPI đã build với
  test/SQL mount read-only. Suite chạy với Kafka/PostgreSQL thật PASS 10/10, không skip.
- Không thay production worker. Duplicate handoff hiện mang changed_instances=[]; chưa bảo đảm
  tái phát danh sách thay đổi từ lần PostgreSQL commit trước crash. Đã ghi giới hạn trong README;
  chưa kiểm thử cửa sổ sau send/sendOffsets hay ambiguous Kafka commit.
- Chỉ khởi động/dừng Kafka/PostgreSQL của project E2E; không thay database runtime, AI hoặc Medusa.
  Chưa commit/push.

## 48. Durable KPI handoff evidence for replay (2026-09-07)

- Migration 018 thêm changed_instances nullable vào KPI application, kiểm tra array/count.
  Repository lưu danh sách/revision trong cùng transaction PostgreSQL với facts/application.
  Duplicate trả lại danh sách và applied_at ban đầu, không dựng từ current projection.
  Envelope vẫn dùng projection_status=duplicate; shape không đổi, danh sách không còn bị bỏ trống.
- Lịch sử không được backfill: count=0 có thể trả []; count>0 nhưng thiếu evidence báo lỗi trước
  Kafka transaction/offset ACK. Khi triển khai cần dừng writer cũ, migrate trước rồi chạy code mới;
  không trộn phiên bản writer hoặc reset offset để che thiếu evidence.
- Unit/PostgreSQL/Kafka process suite PASS 10/10, không skip. Test SIGKILL sau PG commit xác nhận
  output chứa đúng danh sách đã lưu và applied_at, input offset tiến tiếp, snapshot KPI không đổi.
  PostgreSQL test kiểm tra replay revision cũ, rollback khi ghi application lỗi, thiếu evidence và
  chạy migration hai lần. Kafka có retry kết nối lúc broker khởi động, suite kết thúc exit 0.
- Thay đổi chỉ trong Pipeline; migration 018 chỉ chạy trong schema test, chưa áp dụng database
  runtime hoặc build lại image triển khai. Chưa chạy lại full E2E; chưa kiểm thử crash sau Kafka send
  hoặc ambiguous commit. Schema/topic test được dọn, Kafka/Postgres E2E được dừng; chưa commit/push.

## 49. Full E2E after KPI handoff evidence migration (2026-09-07)

- Build lại các image backend `:local`, khởi động project `funnelmetry-e2e-20260907` và áp dụng
  migration 018 trên volume test đã tồn tại. Không thay database runtime hoặc backfill lịch sử.
- E2E PASS (exit 0): ordered và reverse-arrival đều canonical=4, journeys=1, CONVERTED 4/4.
  Tổng 24 retry đồng thời giữ ingestion ID, raw offsets và analytics facts không đổi.
  Telemetry accepted=14, terminal=14, normalized=13, unsupported=1; unsupported có quarantine,
  canonical=0; fallback timestamp vẫn non-authoritative.
- Kiểm tra sau test: KPI applications=39, trong đó 13 bản ghi mới có handoff evidence,
  26 bản ghi cũ vẫn NULL; không có array/count mismatch. Kafka retry lúc coordinator khởi động
  rồi worker tiếp tục chạy; không reset offset hoặc sửa ledger để vượt test.
- Run IDs: ordered `e9b36975-7495-4e70-b7e7-a3421e48a4ed`,
  out-of-order `85b95502-ffea-4ec2-891c-01dc4a8ee10c`.
- Kết hợp với mục 48: crash test KPI 10/10 và full pipeline smoke đã qua cho thay đổi handoff.
  Lượt này không thêm tính năng hoặc thay production code; chỉ kiểm chứng và ghi kết quả.
  Dừng riêng stack E2E, giữ volume evidence. Chưa migrate runtime, commit/push hoặc triển khai;
  chưa claim mọi cửa sổ crash/network partition. AI/Medusa không thay đổi.

## 50. Merge integration package updates from origin/main (2026-09-08)

- Hợp nhất origin/main tới 97cbef6, giữ các commit backend local. Có một conflict import trong
  apps/input-gateway/src/kafka-runtime.js: giữ default import KafkaJS (ConfigResourceTypes),
  đồng thời dùng tên package mới @3002tad/funnelmetry-input-contract. Không bỏ recovery logic.
- Build tất cả image backend từ lockfile sau merge thành công. Installer test 6/6 PASS;
  package workspace test PASS. Gateway 50 PASS/1 skip, Normalizer 14 PASS, Telemetry 13 PASS,
  KPI 9 PASS/1 skip. Hai bài Kafka crash process dài không chạy lại ở lượt merge này.
- E2E PASS: ordered/reverse-arrival CONVERTED 4/4; 24 concurrent retries giữ raw/analytics;
  telemetry accepted=14, terminal=14, normalized=13, unsupported=1.
  Ordered run bf785af6-445f-4ede-a5e1-3fcc40b0c174.
- Chỉ dùng project E2E riêng; không kiểm thử publish thực tế lên GitHub Packages, GitHub Actions
  hoặc cài vào Medusa đang chạy. Không push. Stack test dừng, volume giữ nguyên.
