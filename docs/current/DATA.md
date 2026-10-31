# Dữ liệu và contract hiện hành

## Behavioral input

Browser SDK và storefront hooks gửi event qua HTTP tới Source Ingress. Source Connector đọc Event Feed HTTPS bằng token và cursor, bàn giao Kafka trước khi tiến cursor cục bộ. Downstream xử lý at-least-once với idempotent effects; HTTP 200 ở source chưa chứng minh event đã thành fact/metric. Đây vẫn là đường behavioral hiện hành cho đến khi Gateway HTTP có cutover riêng.

## Medusa business/master data qua CDC

CDC đọc PostgreSQL logical WAL theo publication/slot allowlist và snapshot ban đầu, rồi ghi Kafka. Ba profile được tách riêng:

| Profile | Projection hiện hành | Giới hạn ngữ nghĩa |
| --- | --- | --- |
| `reference.medusa.order_recorded_state.v2` | Current journey/order state ON/OFF, coverage epoch, offset/inbox | Không phải `order.placed`, conversion, payment hoặc revenue; snapshot không tạo ON lịch sử. |
| `reference.medusa.catalog_master_data.v1` | Product, variant, category và quan hệ hiện tại | Không phải lịch sử giá trị đơn hàng. |
| `reference.medusa.inventory_price_context.v2` | Current offer theo variant, sales channel, region, currency; quality lease | Tồn kho khả dụng cần location/reservation/channel; giá phụ thuộc currency, price list và rule. Ngoài shape đã kiểm chứng là `UNVERIFIED`. |

Pipeline PostgreSQL giữ **projection phục vụ phân tích**, không phải bản sao nguyên dạng mọi bảng Medusa. WAL gap không thể replay được ghi `historical_gap_status=INCOMPLETE`; phục hồi bằng coverage epoch mới và snapshot đối soát. Quality lease lỗi trả `BLOCKED_BY_QUALITY`. Contract, deployment và giới hạn chi tiết ở [Medusa CDC hiện hành](MEDUSA_REFERENCE_CDC_CURRENT.md), [Backbone CDC summary](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/MEDUSA_REFERENCE_CDC_CONSOLIDATED_2026-10-31.md).

## Analytical semantics

Historical `commerce-conversion@2.0.0` dựa trên `order.placed` vẫn là một contract riêng cho dữ liệu lịch sử; CDC current-state v2 không được alias làm terminal funnel hoặc doanh thu. Current-offer semantic metadata đã được publish với quality gate; tool/Agent mới thuộc kế hoạch DB-GPT sau này. Không đổi lại giá đơn lịch sử từ giá catalog hiện tại. Chi tiết thời gian ở [Time semantics v1](TIME_SEMANTICS_CONTRACT_V1.md).
