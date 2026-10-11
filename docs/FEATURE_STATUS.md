# Chức năng Pipeline: có gì, còn thiếu gì

> **Ảnh chụp 2026-10-11, không phải bảng nghiệm thu production.** “Có code” ≠ “test đạt” ≠ “đã bật trên máy này” ≠ “đã hoàn thành Master”. Kiểm tra image/commit, profile, data và [bằng chứng kiểm thử](TESTING.md) của deployment thực tế trước khi demo. Quyết định kiến trúc thuộc [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md) và [Master](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md), không thuộc bảng này.

| Mảng | Đã có trong Pipeline | Chưa hoàn tất / giới hạn |
|---|---|---|
| Source→Pipeline | `source-connector` đọc authenticated HTTPS Event Feed bằng cursor và đưa Raw Kafka; có quan sát readiness/feed cho Admin. Demo mới 11/10 đã nhận feed. | Không suy ra Source history đầy đủ từ `/readyz`; cần kiểm tra coverage, retention, cursor và processing-safe checkpoint. Source Ingress/Event Log thuộc Source owner. |
| Canonical + downstream | Normalizer, ledger, telemetry, journey, funnel, KPI, reconciliation worker và schema V2 hiện diện; demo đã có canonical outcome. | Một event qua Gateway/Feed chưa chứng minh mọi projection, replay và reconciliation hoàn chỉnh; cần đối chiếu theo event ID và quality gate. |
| Catalog sản phẩm | `catalog-sync` và UI/API dùng tên sản phẩm từ Medusa Admin; demo 11/10 quan sát 104 catalog entries. | Catalog hiện tại là descriptive reference, không phải giá lịch sử hoặc bảo đảm mọi product ID được hydrate; cần kiểm tra freshness và coverage. |
| DA / Analytics | Overview, event/journey/funnel và các trang catalog/asset/workspace/evidence/report có phần read-only hoặc staged. Order/product ranking dùng deterministic SQL/tool và cảnh báo gross placed-order value, không gọi là paid revenue. | Metrics/relationship và asset coverage còn hẹp; Traffic/Campaigns cần attribution contract đã xác minh; Findings/Reports chưa là publication chính thức. Tool thiếu hoặc data quality yếu có thể trả `PROVISIONAL`/`INSUFFICIENT_DATA`. |
| Admin | UI/API read-only cho event feed, processing, Kafka offsets/membership, worker readiness, metrics, monitoring warnings, audit, quarantine, connector và registry. Một số chức năng đã có test/API smoke theo mốc 08–10/10. | Đây không phải full admin control plane: nhiều quan sát chỉ một process/worker type hoặc snapshot; chưa có restart/scale/replay từ UI, alert delivery/persisted incident workflow, multi-replica inventory hay health SLA. Monitoring profile project mới cần provision lại. |
| AI / Qwen | Chat và deterministic tool routing đã có; demo mới đã thử Qwen. | Không phải mọi câu hỏi đều có tool/dữ liệu phù hợp; planner/evidence/quality còn giới hạn. Không suy diễn paid/net revenue từ `order.placed`; chưa có chứng nhận chất lượng trên workload production. |
| Auto-healing / autoscale | Compose restart/health, Watchdog host-side, policy/observer autoscaler và sandbox test đã có code. | Watchdog và autoscaler actuator không tự bật trong Compose. Policy chưa phải vòng scale tự động được nghiệm thu; không claim node-level HA, scale DB/Kafka/Qdrant hay recovery dưới mọi fault. |
| Migration/recovery | Có bounded replay/idempotency tests, checkpoint/cursor và tài liệu DEC-125. | General `RESTORE_REPLAY`, clean-machine bootstrap và authoritative cutover chưa được chứng nhận; không copy Kafka volume để chuyển máy. |

## Những menu UI còn ghi “chưa khả dụng”

Theo [`navigation.ts`](../apps/dashboard-web/src/app/navigation.ts) tại version đang rà soát:

| Vai trò | Menu | Trạng thái thực tế |
|---|---|---|
| Data Analyst | Traffic, Campaigns | Có mục điều hướng nhưng chưa nối analytical asset/metric và attribution contract tương ứng. |
| Admin | Recovery / Auto-Healing, Host / Container Resources | Chưa nối watchdog/recovery history hoặc host/container telemetry; không có Docker action trong UI. |
| Admin | Analysis Recipes, Agent Observability | Chưa có màn quản trị recipe/compatibility hoặc Agent/tool execution telemetry đầy đủ. |
| Admin | Model / Provider Configuration, Secrets / Integration Settings, System Settings | Chưa có API cấu hình/secret có phân quyền và audit; không nhập key vào trang placeholder. |

Các menu không nằm trong bảng trên có route/UI nhưng mức hoàn thiện khác nhau; xem bảng capability và test tương ứng, không suy “hiện menu” thành “đủ chức năng”.

## Cách đọc trạng thái Admin

Các trang Admin monitoring là **quan sát read-only**, không điều khiển Docker:

- `/api/v2/admin/event-feed`: snapshot Feed trong process Connector sau whole-batch validation; có thể cũ sau lỗi/restart. Sequence gap không phải event count hoặc Kafka lag.
- `/api/v2/admin/processing`: số lượng PostgreSQL theo từng grain; timestamp maxima không phải latency end-to-end; Kafka lag là nguồn quan sát khác.
- `/api/v2/admin/kafka-lag`: offset positions từ các group/topic allowlisted; missing commit/retention gap là unknown, không ép về 0. `membership` là trạng thái nhóm, không phải số container hoặc bảo đảm xử lý thành công.
- `/api/v2/admin/worker-readiness`: process-local runtime flag của sáu worker type, không kiểm tra DB liên tục và không bao phủ mọi replica.
- `/api/v2/admin/metrics` và `/api/v2/admin/monitoring-alerts`: cần session/quyền `pipeline.monitor`; scrape/worker unknown không đồng nghĩa healthy. Cảnh báo UI chỉ refresh khi trang mở, chưa có Alertmanager/email.

Các endpoint từ ghi nhận 08–10/10 có test auth, bounds và redaction, nhưng kết quả ở demo/image cũ không chứng minh profile monitoring của deployment mới đã provision hoặc đạt acceptance. Chi tiết theo mốc đã gộp vào [hồ sơ Admin/monitoring](archive/MONITORING_HISTORY.md); không dùng nó làm runbook hiện hành.

## Chỗ cần làm tiếp

1. Dùng [ma trận test](TESTING.md) để chứng minh một event Source→Kafka→canonical→projection/quality theo ID, không chỉ HTTP 200.
2. Provision/kiểm chứng monitoring trên project mới, rồi xác nhận alert, quyền máy và trạng thái UNKNOWN thực tế.
3. Mở rộng metadata/assets/tool coverage có kiểm soát, tách human notes khỏi official findings/reports.
4. Đánh giá autoscaler actuator, graceful drain, identity/recovery và host capacity trước khi bật tự động.
5. Chỉ nhận migration/cutover khi thỏa [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md), không suy từ demo tươi.

Nguồn chi tiết theo component: [Analytics](analytics/README.md), [UI rollout](archive/UI_HISTORY.md), [workers](workers/README.md), [autoscaler](tools/RESILIENCE.md#autoscaler), [monitoring](MONITORING.md). Các ghi nhận theo ngày là evidence ở thời điểm đó, không tự nâng trạng thái của code hiện tại.
