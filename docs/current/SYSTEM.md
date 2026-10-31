# Kiến trúc Pipeline hiện hành

Pipeline triển khai bằng **Docker Swarm**. Trên VPS reference, main stack `funnelmetry_vps_live` chạy nền tảng PostgreSQL/Kafka, workers và Dashboard API/Web; stack `funnelmetry_cdc` chạy sáu service CDC Medusa. Medusa và Source Ingress có deployment riêng. Các stack và runtime không biến source app thành một phần của Pipeline Swarm.

## Hai đường dữ liệu đang dùng

```text
Browser SDK / storefront hooks
  → Source Ingress + Event Feed HTTPS
  → Source Connector → Kafka behavioral
  → normalizer / ledger / journey / funnel / KPI → Pipeline PostgreSQL

Medusa PostgreSQL logical WAL
  → Debezium Connect → Kafka CDC
  → catalog writer / inventory-price writer → Pipeline PostgreSQL projections
  → order mapper → order-state fact → order sink → current-state projection
```

Browser SDK và các hook storefront tiếp tục đi qua Source Ingress/Event Feed. Business/master data Medusa reference dùng CDC; backend `order.placed` sender và Admin API `catalog-sync` đã được gỡ khỏi đường live. Gateway HTTP phía Pipeline có code và tài liệu component, nhưng **chưa cutover** để thay Source Ingress/Event Feed. Không nhập hai đường này làm một khi mô tả runtime.

## Ownership và thành phần

- [`infra/swarm-stack.yml`](../../infra/swarm-stack.yml), [`infra/swarm-workers.yml`](../../infra/swarm-workers.yml), [`infra/swarm-app.yml`](../../infra/swarm-app.yml), [`infra/swarm-live.yml`](../../infra/swarm-live.yml): data, workers, API/Web và behavioral Source Connector của main stack.
- [`infra/swarm-cdc-live.yml`](../../infra/swarm-cdc-live.yml): Connect, order mapper DB, catalog writer, inventory/price writer, order mapper và order sink của CDC stack.
- [`runtime/swarm.mjs`](../../runtime/swarm.mjs) và [`runtime/cdc-live.mjs`](../../runtime/cdc-live.mjs): launcher tương ứng. Env/credential thật được giữ ngoài Git.
- [`apps/`](../../apps/): HTTP/UI; [`workers/`](../../workers/): xử lý nền; [`packages/`](../../packages/): contract/SDK; [`analytics/`](../../analytics/): metadata và analytical assets; [`tools/`](../../tools/): installer, API docs và vận hành.

Single-node Swarm là profile phát triển/demo. Health của service không chứng nhận stateful HA, khả năng chịu flash-sale hoặc restore toàn hệ thống. Xem [dữ liệu](DATA.md), [triển khai](DEPLOYMENT.md) và [năng lực](CAPABILITIES.md) để biết giới hạn cụ thể.
