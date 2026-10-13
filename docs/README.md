# Tài liệu Streaming Pipeline

> Điểm vào hiện hành cho repo này. Kiến trúc và quyết định thuộc [System Backbone](https://github.com/3002tad/System_Backbone); tài liệu ở đây mô tả triển khai và mức hoàn thành của code Pipeline, không được override Master. Cập nhật mục lục: 2026-10-13.

| Cần biết gì | Đọc file | Phạm vi |
|---|---|---|
| Triển khai Swarm và trạng thái migration | [Docker Swarm](SWARM_MIGRATION.md) | Swarm là baseline; API/UI/worker và HTTPS local đã qua smoke, chưa có live feed |
| Runbook Compose cũ | [Vận hành legacy](OPERATIONS.md) | Chỉ dùng khi rollback DEC-125 được xác nhận; không dùng cho triển khai mới |
| Chức năng đã có, còn thiếu và giới hạn | [Chức năng](FEATURE_STATUS.md) | Phân biệt code, demo evidence và production acceptance |
| Test an toàn và cách chứng minh demo | [Kiểm thử](TESTING.md) | Unit/build/config khác với E2E và restore acceptance |
| Cấu trúc repo | [Repository layout](REPOSITORY_LAYOUT.md) | Đường dẫn code và ownership |
| Time semantics | [Time contract](TIME_SEMANTICS_CONTRACT_V1.md) | Contract nội bộ Pipeline, subordinate to Backbone |
| API machine-readable | [OpenAPI V2](../tools/api-docs/public/openapi-v2.yaml) | Đối chiếu với runtime/API version thực tế |

## Nguồn quy tắc hệ thống

Thứ tự đọc khi thay đổi semantics hoặc deployment: [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md) → [Master Specification](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md) → [Core Implementation Contracts](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/CORE_IMPLEMENTATION_CONTRACTS_V1.md). Trước khi dựng máy mới, demo song song, restore hay cutover, đọc thêm [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md). Quy tắc cho coding agent nằm trong [System Cookbook](https://github.com/3002tad/System_Cookbook).

## Tài liệu chuyên sâu theo module

- [Dashboard API](apps/dashboard-api/README.md), [Dashboard Web](apps/dashboard-web/README.md), [Analytics](analytics/README.md).
- [Source Connector](workers/source-connector/README.md), [Catalog Sync](workers/catalog-sync/README.md), [Workers](workers/README.md), [Packages](packages/README.md).
- [Vận hành Swarm](SWARM_MIGRATION.md), [Compose rollback](OPERATIONS.md), [tests](../tests/README.md), [autoscaler và watchdog](tools/RESILIENCE.md).
- [Monitoring](MONITORING.md), [hồ sơ Analytics/AI](archive/ANALYTICS_AI_HISTORY.md), [ingestion/recovery](archive/INGESTION_RECOVERY_HISTORY.md), [demo/handoff](archive/DEMO_HANDOFF_HISTORY.md), [UI rollout](archive/UI_HISTORY.md).

Tài liệu component nằm dưới `docs/` theo đường dẫn code tương ứng; code/runtime vẫn ở thư mục cũ. README của npm packages là [ngoại lệ đóng gói](packages/README.md). Tài liệu test nằm ở [tests](../tests/README.md). Các hồ sơ trong [archive](archive/README.md) giữ evidence và hướng dẫn lịch sử theo chủ đề/mốc; không chạy lại lệnh cũ trên project hiện hành. V1 dưới [`docs/legacy/`](legacy/README.md) chỉ dùng truy vết. Không đưa `.env`, log, token hoặc backup thật vào Git/tài liệu.
