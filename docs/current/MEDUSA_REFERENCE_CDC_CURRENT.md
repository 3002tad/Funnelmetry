# Medusa reference CDC hiện hành

Tài liệu này mô tả contract và topology CDC đang dùng cho Medusa reference. Quyết định ngữ nghĩa thuộc [Backbone CDC summary](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/MEDUSA_REFERENCE_CDC_CONSOLIDATED_2026-10-31.md) và DEC-119/135/140–142.

## Luồng và profile

Medusa PostgreSQL logical WAL được Debezium Connect đọc qua bốn publication/slot theo allowlist. Kafka CDC topics cấp dữ liệu cho catalog writer, inventory/price writer, cart line item mapper và order mapper/sink. Pipeline PostgreSQL giữ các projection phục vụ phân tích, coverage epoch, inbox/offset và quality lease; không giữ bản sao nguyên dạng toàn bộ Medusa database.

| Profile | Kết quả | Giới hạn |
| --- | --- | --- |
| `reference.medusa.order_recorded_state.v2` | Current-state ON/OFF tại grain journey, có thể rút lại; `reference-commerce-current-state@2.0.0` và metric count riêng. | Không phải `order.placed`, payment, conversion hay doanh thu. Initial snapshot tạo baseline, không phát ON lịch sử. |
| `reference.medusa.catalog_master_data.v1` | Product, variant, category và quan hệ hiện tại. | Không dùng giá catalog để viết lại giá trị đơn hàng lịch sử. |
| `reference.medusa.inventory_price_context.v2` | Current offer theo source × variant × sales channel × region × currency, có quality gate. | Cần location/reservation/inventory management, currency/price list/rules; ngoài shape đã đối soát là `UNVERIFIED`, lease lỗi là `BLOCKED_BY_QUALITY`. |
| `reference.medusa.cart_line_item_added.v1` | Snapshot `cart_line_item` chỉ tạo baseline; insert hoặc tăng quantity sau snapshot phát `cart.item_added` với cart/line/variant/quantity. | Event không mang session browser. `context.cart_linked` từ SDK chỉ là evidence cart–session; metric search→cart chưa kích hoạt khi projection chưa nối hai journey có kiểm chứng. |

Khi mất slot/WAL, khoảng không thể quan sát giữ `historical_gap_status=INCOMPLETE`. Phục hồi bằng coverage epoch mới, snapshot và đối soát; không tạo ON giả hoặc tuyên bố replay liên tục. Offset/inbox giúp duplicate/replay không tạo hiệu ứng logic lần hai.

## Runtime và quyền sở hữu

- Stack `funnelmetry_cdc` có bảy service: Connect, order mapper DB, catalog writer, inventory/price writer, cart line item mapper, order mapper, order sink. Manifest: [`infra/swarm-cdc-live.yml`](../../infra/swarm-cdc-live.yml); launcher: [`runtime/cdc-live.mjs`](../../runtime/cdc-live.mjs). Runtime env cục bộ và secret không vào Git.
- Quality monitor dùng [`tools/cdc-operations/monitor-quality.py`](../../tools/cdc-operations/monitor-quality.py) và profile/lease. Lệnh, phạm vi quyền và phục hồi ở [CDC operations](../../tools/cdc-operations/README.md).
- Medusa source owner cấp logical replication, publication/slot và allowlist. Pipeline operator quản lý Connect, Kafka, writer/sink, quality và backup. [CDC installer](../../tools/medusa-ci-installer/CDC_DEVELOPMENT.md) sinh cấu hình tích hợp qua CI, không tự vận hành DB/Connect.
- Tên volume/topic/slot có chữ `shadow` được giữ để bảo toàn state và offset; worker runtime là `ACTIVE_REFERENCE_V2`. Không đổi tên vật lý nếu chưa có migration epoch/snapshot riêng.

Browser SDK/storefront behavioral hooks vẫn dùng Source Ingress → HTTPS Event Feed → Source Connector → Kafka. CDC không đi qua Event Feed. Admin/Store API vẫn phục vụ cửa hàng; Admin API `catalog-sync` không còn là đường phân tích. Native backend `order.placed` sender đã bỏ; các funnel lịch sử dựa trên event đó không được tự động chuyển thành CDC conversion. Gateway HTTP phía Pipeline chưa cutover.

Đường kiểm chứng hiện hành ở [vận hành](OPERATIONS.md). Các hồ sơ canary, cutover và dọn runtime đã chuyển vào [archive](../archive/README.md); không dùng giá trị đếm/offset của chúng làm trạng thái mới nhất.
