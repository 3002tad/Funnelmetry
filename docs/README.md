# Tài liệu Funnelmetry

Mục lục rà soát 03/10/2026. Có code, đã test, đã triển khai và đang hoạt động là bốn trạng thái khác nhau.

## Đọc theo nhu cầu

| Nhu cầu | Tài liệu | Phạm vi |
|---|---|---|
| Mở lại demo | [Resume demo](../runtime/START_PRIVATE_DEMO.md) | Máy đã cấu hình; không clean install |
| Phân biệt cấu hình / logs / activation | [Mục lục runtime](../runtime/README.md) | Không chia sẻ env/backup thật qua Git |
| Phát triển API/UI | [API](../apps/dashboard-api/README.md), [UI](../apps/dashboard-web/README.md) | UI riêng không tự bật backend |
| Nhận event | [Source Connector](../workers/source-connector/README.md), [Medusa binding](../integrations/medusa/README.md) | Public HTTPS pull; cursor handoff khác checkpoint xử lý |
| Tên sản phẩm | [Catalog sync](../workers/catalog-sync/README.md) | One-shot không có nghĩa đã chạy định kỳ |
| Phân tích / AI | [Analytics](../analytics/README.md), [order ranking](../analytics/ORDER_RANKING_STAGING.md), [product ranking](../analytics/PRODUCT_RANKING_STAGING.md) | Đọc cả activation follow-up, metadata staging |
| Admin | [Registry và diagnostics](../analytics/ADMIN_REGISTRY_READONLY_2026-10-03.md) | Tra cứu, chưa đầy đủ vòng đời quản trị |
| Kiểm thử | [Tests](../tests/README.md), [V2 E2E](../tools/v2-e2e/README.md) | Tách test isolated khỏi dữ liệu demo |
| Hạ tầng | [Infra](../infra/README.md), [PostgreSQL](../infra/postgres/README.md), [Ports](../infra/PORTS.md) | Theo capability, không suy ra full deployment |
| Bàn giao | [Backbone implementation](https://github.com/3002tad/System_Backbone/tree/main/docs/implementation) | Bản 30/9 là lịch sử; bản bổ sung 03/10 cần được push riêng |
| Chuyển máy/server | [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) | Không copy Kafka volume; chưa có clean bootstrap tổng quát |

README theo component giữ cạnh code để tránh nhiều bản hướng dẫn lệch nhau; mục lục này là điểm tìm chung.

## Hiện hành

- [`REPOSITORY_LAYOUT.md`](REPOSITORY_LAYOUT.md): cấu trúc repository V2 và trạng thái migration.
- [`TIME_SEMANTICS_CONTRACT_V1.md`](TIME_SEMANTICS_CONTRACT_V1.md): clock, horizon/grace,
  maturity và late-arrival boundary dùng chung; không chứa numeric default.
- [`../tools/api-docs/public/openapi-v2.yaml`](../tools/api-docs/public/openapi-v2.yaml): OpenAPI
  machine-readable cho Analytics API V2.
- Kiến trúc đích và decision record: repository `../../System_Backbone`.
- Quy tắc phát triển: repository `../../System_Cookbook`.

## Tài liệu V1 giữ để tham khảo

Các file dưới đây mô tả pipeline/k3s cũ đã ngừng duy trì ngày 2026-08-24. Chúng
không phải hướng dẫn chạy V2:

- [`BAO_CAO_DU_AN.md`](../legacy/docs-v1/BAO_CAO_DU_AN.md)
- [`PHU_LUC.md`](../legacy/docs-v1/PHU_LUC.md)
- [`RUNTIME.md`](../legacy/docs-v1/RUNTIME.md)
- [`TECH_STACK.md`](../legacy/docs-v1/TECH_STACK.md)
- [`SPEC.md`](../legacy/docs-v1/SPEC.md)
- [`REPO_MAP.md`](../legacy/docs-v1/REPO_MAP.md)
- [`API.md`](../legacy/docs-v1/API.md)

Code và tài liệu tương ứng được giữ trong `../legacy/` để đối chiếu migration.

## Nhật ký và bằng chứng có thời điểm

Không chạy lại lệnh kích hoạt/replay chỉ vì chúng xuất hiện trong lịch sử:

- [Archive backend 30/08](archive/V2_BACKEND_CHANGELOG_2026-08-30.md).
- [Master alignment 11/09 — archive](archive/MASTER_ALIGNMENT_REVIEW_2026-09-11.md), [Integration/AI 12/09](INTEGRATION_AI_ACTIVATION_2026-09-12.md).
- [Behavior V2](BEHAVIOR_V2_ONLY_2026-09-20.md), [UI workspace 20/09 — archive](archive/UI_WORKSPACE_V2_2026-09-20.md).
- [Source activation](SOURCE_CONNECTOR_ACTIVATION_2026-09-20.md), [bounded Kafka recovery](KAFKA_RECOVERY_2026-09-20.md).
- [Order placement migration](ORDER_PLACEMENT_MIGRATION_2026-09-23.md), [order activation](../runtime/ORDER_ANALYTICS_ACTIVATION_2026-09-27.md).
- [Qwen eval](../analytics/QWEN_EVAL_2026-09-25.md), [staging readiness](../analytics/STAGING_READINESS_2026-09-25.md).
- [Replay 41 event](UNSUPPORTED_REPLAY_PLAN_2026-09-29.md), [non-AI rollout](NON_AI_FEATURE_ROLLOUT.md).

Ngày trong tên không tự chứng minh file có thể xóa. File trộn hướng dẫn và follow-up giữ vị trí cũ; đọc đúng mốc cập nhật.

## Quy tắc lưu tài liệu và cấu hình

1. Hướng dẫn component đặt cạnh code; mục lục trỏ đến bản đó, không sao chép toàn bộ.
2. Nhật ký thuần lịch sử đặt trong `docs/archive/`, ghi ngày/commit/test/deployed/evidence/giới hạn.
3. Khi chuyển file, kiểm tra backlink và link tương đối; giữ chỉ dẫn đường dẫn cũ khi cần.
4. `.env`, logs và backups là cấu hình/dữ liệu local; không đưa nội dung vào Git hoặc tài liệu. Dùng `.env.example` làm mẫu.
5. Không di chuyển script/SQL/env trong một đợt dọn Markdown. Tên `private` là đường dẫn tương thích, không chứng minh runtime cần VPN.
