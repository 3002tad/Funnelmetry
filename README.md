# Funnelmetry Streaming Pipeline

Repository Pipeline cho ingestion, canonical/trust, analytics, Admin/DA UI và AI tool integration. Kiến trúc và quyết định hệ thống nằm ở [System Backbone](https://github.com/3002tad/System_Backbone); repo này sở hữu code và runbook triển khai tương ứng.

## Bắt đầu

| Mục đích | Tài liệu |
|---|---|
| Triển khai/kiểm thử Docker Swarm | [Vận hành Swarm](docs/SWARM_MIGRATION.md) |
| Xem hướng dẫn Compose cũ khi cần rollback có kiểm soát | [Vận hành legacy](docs/OPERATIONS.md) |
| Biết chức năng nào có code/demo và còn thiếu gì | [Trạng thái chức năng](docs/FEATURE_STATUS.md) |
| Chạy test và ghi bằng chứng demo | [Kiểm thử](docs/TESTING.md) |
| Tìm tài liệu kỹ thuật và lịch sử | [Mục lục docs](docs/README.md) |
| Tìm module trong repo | [Repository layout](docs/REPOSITORY_LAYOUT.md) |

Deployment mới dùng Docker Swarm: [`runtime/swarm.mjs`](runtime/swarm.mjs), các stack YAML trong [`infra/`](infra/) và một `runtime/deploy.env` cục bộ tạo từ [`runtime/deploy.env.example`](runtime/deploy.env.example). Xem [runbook Swarm](docs/SWARM_MIGRATION.md) trước khi chạy; candidate `OFFLINE_DEMO` trên máy local đã kiểm thử API/UI/worker và HTTPS `funnelmetry.local`, nhưng **chưa bật Medusa Live Feed**. HTTPS local này không tự hoạt động trên máy khác nếu thiếu hostname/certificate riêng. [`infra/legacy/compose.yaml`](infra/legacy/compose.yaml) và [`runtime/deploy.mjs`](runtime/deploy.mjs) chỉ giữ cho rollback/provenance DEC-125, không còn là đường demo mới; launcher Compose từ chối chạy mặc định. Dữ liệu và credential local không đưa lên Git. Chọn mode theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md); fresh demo không phải authoritative state migration.

README chi tiết của API/UI, analytics, packages, workers, tools và infra nằm cạnh code. Các tài liệu theo ngày, `docs/archive/` và `legacy/` giữ provenance nhưng không phải runbook hiện hành. Đừng suy “đã có file” thành “đã hoàn tất Master” hoặc “đã nghiệm thu production”.
