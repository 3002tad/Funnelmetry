# Kiểm thử Pipeline và mức bằng chứng

> **CURRENT TEST MAP — 2026-10-11.** Chạy từ root `Streaming_Pipeline`. Không dùng DB/volume demo thật cho test có ghi dữ liệu; không gửi event thật hoặc dùng key live khi test không yêu cầu. Một lệnh `npm test`/build thành công không chứng nhận end-to-end, production hoặc toàn bộ Master.

## Kiểm tra nhanh không làm thay đổi dữ liệu demo

| Mục tiêu | Lệnh / vị trí | Kết luận tối đa |
|---|---|---|
| Cú pháp Compose hiện hành | `docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet` | Chỉ chứng minh render hợp lệ; cần env local, không in config đã render |
| Quy tắc Compose/monitoring runtime | `node --test runtime/unified-compose.test.mjs runtime/monitoring-rotation.test.mjs` | Test cấu hình/hành vi fixture, không bật dịch vụ |
| Dashboard API | `npm test --prefix apps/dashboard-api` | Unit/route tests; các bài PostgreSQL tùy cấu hình có thể skip |
| Dashboard Web | `npm run build --prefix apps/dashboard-web` và `node --test apps/dashboard-web/test/navigation.test.mjs` | Build/navigation, chưa phải browser với API thật |
| Contracts/packages | `npm test --prefix packages` | Test package, không kiểm tra Kafka/DB live |
| Analytical registry/assets | `node --test analytics/test/semantic-registry.test.mjs analytics/test/order-summary.test.mjs analytics/test/analysis-run.test.mjs` | Tool/metadata logic; kiểm tra output skip nếu thiếu DB |
| Bootstrap/observability artifacts | `node --test infra/bootstrap/bootstrap-handoff.test.mjs infra/observability/artifacts.test.mjs` | Schema/config artifact fixtures |
| Autoscaler policy/observer | `node --test tools/autoscaler/policy.test.mjs tools/autoscaler/observe.test.mjs` | Decision/observer tests; **không** chứng nhận actuator tự scale |

Các lệnh Node/npm cần dependency đã cài; `config --quiet` cần `deploy.env` thật nhưng không được in secret. Không dùng `--profile live` trong test đơn thuần nếu chưa được phép đọc Feed. Xem [`tests/README.md`](../tests/README.md) và README cạnh từng component cho test sâu hơn.

Hai bài Compose trong `runtime/unified-compose.test.mjs` tự SKIP nếu `TEST_COMPOSE_EXE` chưa trỏ tới Docker CLI; đặt biến đó bằng đường dẫn executable hợp lệ trước khi chạy để kiểm tra đủ cả profile. Không cần bật container để chạy `config` fixtures.

## Acceptance khi bật demo

1. Ghi commit hoặc image digest, project, profile và nguồn dữ liệu; phân biệt `OFFLINE_DEMO`, `PARALLEL_LIVE`, `RESTORE_REHEARSAL`, `MIGRATION_CUTOVER` theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md).
2. Kiểm tra service health/readiness, nhưng không dừng ở HTTP 200. Với event có `source_id`/`event_id` cụ thể, xác nhận Source Feed → Connector cursor/Kafka ACK → canonical outcome/ledger → projection và quality/reconciliation tương ứng. Không trừ sequence/offset để suy số event bị mất.
3. Với Catalog, đối chiếu product ID/name và snapshot/freshness; không lấy giá catalog hiện tại làm giá lịch sử.
4. Với AI, kiểm tra câu trả lời được route qua tool có quyền, provenance, warning, window/currency/grain; câu hỏi không được hỗ trợ phải nói rõ thiếu tool/dữ liệu, không bịa số.
5. Với monitoring, provision credential mới, kiểm tra quyền Admin/machine, metrics scrape, trạng thái unknown và cảnh báo; một trang mở/Prometheus UP không chứng minh toàn Pipeline khỏe.
6. Ghi rõ PASS/FAIL/SKIP, thời điểm, dữ liệu test và giới hạn. Không biến một demo thành claim production hoặc restore tổng quát.

## Hướng dẫn test cũ chưa dùng trực tiếp

[`tools/v2-e2e/README.md`](../tests/tools/v2-e2e/README.md) hiện còn lệnh `infra/compose.v2.yml` và profile `smoke` đã bị loại khỏi bộ Compose thống nhất. Đó là hướng dẫn cho topology cũ, **không chạy nguyên lệnh trên deployment hiện tại**. Trước khi có runner E2E mới cho `infra/compose.yaml`, dùng project test riêng và acceptance có kiểm soát; không reset cursor/volume demo để chạy lại bài test cũ. Các ghi nhận test ngày 08–10/10 trong [hồ sơ Admin/monitoring](archive/MONITORING_HISTORY.md) là bằng chứng theo phiên bản, không phải kết quả chạy hôm nay.

Nguồn chuẩn cho semantics/test acceptance: [Master Specification](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md) và [Core Implementation Contracts](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/CORE_IMPLEMENTATION_CONTRACTS_V1.md).
