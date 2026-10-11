# Funnelmetry Streaming Pipeline

Repository Pipeline cho ingestion, canonical/trust, analytics, Admin/DA UI và AI tool integration. Kiến trúc và quyết định hệ thống nằm ở [System Backbone](https://github.com/3002tad/System_Backbone); repo này sở hữu code và runbook triển khai tương ứng.

## Bắt đầu

| Mục đích | Tài liệu |
|---|---|
| Chạy hoặc tiếp tục phát triển cùng một bộ Compose | [Vận hành](docs/OPERATIONS.md) |
| Biết chức năng nào có code/demo và còn thiếu gì | [Trạng thái chức năng](docs/FEATURE_STATUS.md) |
| Chạy test và ghi bằng chứng demo | [Kiểm thử](docs/TESTING.md) |
| Tìm tài liệu kỹ thuật và lịch sử | [Mục lục docs](docs/README.md) |
| Tìm module trong repo | [Repository layout](docs/REPOSITORY_LAYOUT.md) |

Deployment hiện hành dùng [`infra/compose.yaml`](infra/compose.yaml) và một `runtime/deploy.env` tạo từ [`runtime/deploy.env.example`](runtime/deploy.env.example). Không dùng launcher, overlay V2/handoff/private-ingress hoặc env mẫu cũ trên project hiện hành. Dữ liệu và credential local không đưa lên Git. Chọn mode theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md); fresh demo không phải authoritative state migration.

README chi tiết của API/UI, analytics, packages, workers, tools và infra nằm cạnh code. Các tài liệu theo ngày, `docs/archive/` và `legacy/` giữ provenance nhưng không phải runbook hiện hành. Đừng suy “đã có file” thành “đã hoàn tất Master” hoặc “đã nghiệm thu production”.
