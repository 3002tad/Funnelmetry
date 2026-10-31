# Funnelmetry Streaming Pipeline

Repository Pipeline cho ingestion, canonical/trust, analytics, Admin/DA UI và AI tool integration. Kiến trúc và quyết định hệ thống nằm ở [System Backbone](https://github.com/3002tad/System_Backbone); repo này sở hữu code và runbook triển khai tương ứng.

## Bắt đầu

| Mục đích | Tài liệu |
|---|---|
| Hiểu hệ thống đang phát triển | [Tài liệu hiện hành](docs/current/README.md) |
| Triển khai/kiểm thử Docker Swarm | [Triển khai](docs/current/DEPLOYMENT.md) và [vận hành](docs/current/OPERATIONS.md) |
| Biết chức năng và giới hạn | [Năng lực hiện hành](docs/current/CAPABILITIES.md) |
| Tìm tài liệu kỹ thuật và lịch sử | [Mục lục docs](docs/README.md) |
| Hiểu CDC Medusa reference đang chạy | [CDC hiện hành](docs/current/MEDUSA_REFERENCE_CDC_CURRENT.md) |
| Tìm module trong repo | [Kiến trúc và ownership](docs/current/SYSTEM.md) |

Triển khai Pipeline dùng Docker Swarm: [`runtime/swarm.mjs`](runtime/swarm.mjs), các stack YAML trong [`infra/`](infra/) và `runtime/deploy.env` cục bộ tạo từ [`runtime/deploy.env.example`](runtime/deploy.env.example). CDC Medusa có stack và launcher riêng. Xem [triển khai](docs/current/DEPLOYMENT.md) trước khi chạy. Dữ liệu và credential local không đưa lên Git. Chọn mode theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md); fresh demo không phải authoritative state migration.

README chi tiết của API/UI, analytics, packages, workers, tools và infra nằm cạnh code. Các tài liệu theo ngày và `docs/archive/` giữ provenance nhưng không phải runbook hiện hành. Đừng suy “đã có file” thành “đã hoàn tất Master” hoặc “đã nghiệm thu production”.
