# Medusa Reference CDC — luồng hiện hành

**Cập nhật 2026-10-31, sau CDC-14.** Tài liệu này mô tả runtime Medusa
reference đã kiểm chứng trên VPS `kltn`. Quyết định và giới hạn ngữ nghĩa nằm
trong [Backbone CDC summary](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/MEDUSA_REFERENCE_CDC_CONSOLIDATED_2026-10-31.md),
DEC-119/135/140–142 và contract order-state v2. Các báo cáo CDC-10/11/12/13
ghi lại những checkpoint lịch sử; trạng thái `SHADOW_ONLY` trong profile và
tên vật lý `cdc_shadow_*` không mô tả quyền đọc phân tích hiện tại.

## Dữ liệu đi đâu

```text
Medusa PostgreSQL (logical WAL; 3 publication/slot theo allowlist)
  → Debezium Connect trên mạng riêng → Kafka CDC topics
  → catalog writer / inventory-price writer → Pipeline PostgreSQL projections
  → order mapper + mapper PostgreSQL → Kafka order-state fact topic
    → order sink → Pipeline PostgreSQL current state, inbox, offsets
  → quality monitor → quality leases → Dashboard API / semantic metadata

Browser SDK và storefront behavioral hooks
  → Source Ingress → HTTPS Event Feed → Source Connector → Kafka behavioral
```

CDC **không** đi qua Source Ingress/Event Feed. Gateway HTTP ở phía Pipeline
chưa cutover; luồng browser/storefront vẫn dùng HTTP path hiện hành. Medusa
Admin/Store API vẫn phục vụ cửa hàng; `catalog-sync` bằng Admin API không còn
là đường đồng bộ phân tích. Installer không sinh backend `order.placed` sender.

## Ba profile và ranh giới semantic

| Profile | Nguồn/cách dựng | Kết quả được dùng |
|---|---|---|
| Order `reference.medusa.order_recorded_state.v2` | `order`, `order_cart`, `cart`; transaction `END`, initial snapshot và coverage epoch. | Current state ON/OFF có thể rút lại; profile `reference-commerce-current-state@2.0.0`, metric journey count riêng. Không alias thành historical `order.placed`, conversion, payment hay revenue. |
| Catalog `reference.medusa.catalog_master_data.v1` | Initial snapshot rồi CDC của product, variant, category và quan hệ category-product. | Tên/thực thể sản phẩm hiện hành, quality-gated; không viết lại giá đơn lịch sử. |
| Inventory/price `reference.medusa.inventory_price_context.v2` | Initial snapshot rồi CDC của 16 bảng giá, tồn kho, location, reservation, region/currency và sales channel. | Current-offer metadata `asset.reference_medusa_current_offer@1.0.0`, grain source × variant × sales channel × region × currency. Shape ngoài phạm vi đối chiếu trả `UNVERIFIED`; lease lỗi trả `BLOCKED_BY_QUALITY`. |

Snapshot mở coverage epoch hiện tại và tạo baseline, **không** phát ON cho đơn
cũ. ON/OFF chỉ là transition sau activation. Slot mất khiến khoảng WAL không
quan sát được giữ `historical_gap_status=INCOMPLETE`; phục hồi bằng epoch mới
và snapshot/đối soát, không tạo lại slot `no_data` rồi nhận là liên tục.
Mapper và sink lưu offset/inbox để replay hoặc duplicate delivery không tạo
hiệu ứng logic thứ hai. Source ngoài Medusa cần conformance riêng.

## Deployment và owner

- Stack CDC chính: [`infra/swarm-cdc-live.yml`](../infra/swarm-cdc-live.yml),
  `funnelmetry_cdc` gồm Connect, catalog writer, inventory/price writer,
  order mapper, mapper DB, order sink (mỗi service `1/1` trong CDC-14).
  Main Pipeline là stack `funnelmetry_vps_live`; Medusa và Source Ingress có
  deployment riêng.
- [`runtime/cdc-live.mjs`](../runtime/cdc-live.mjs) đọc
  `runtime/cdc-live.env` cục bộ (ignored), pin image digest và kiểm tra
  mapper volume/identity; `deploy` chặn nếu old target còn desired replica.
  Không chạy hai Connect hoặc writer cùng slot/group.
- Mapper volume vật lý
  `funnelmetry_cdc_target_shadow_order-mapper-data`, topic/slot/group có chữ
  `shadow` và profile field `SHADOW_ONLY` được giữ để bảo toàn state/offset và
  tương thích source provisioning. Worker runtime mode là
  `ACTIVE_REFERENCE_V2`. Đổi tên vật lý đòi hỏi migration epoch/snapshot riêng.
- Medusa source owner cấp logical replication, role/publication/slot theo
  allowlist; Pipeline operator quản lý Connect/Kafka/mapper/sink, backup,
  quality monitor và binding. Installer CI đọc
  [`funnelmetry.integration.yaml`](https://github.com/3002tad/dtc-starter-funnelmetry/blob/feature/cdc-medusa-v1/funnelmetry.integration.yaml)
  để sinh profile/hook trên nhánh tích hợp, không tự cấp quyền DB hay vận hành
  connector. Xem [installer CDC](../tools/medusa-ci-installer/CDC_DEVELOPMENT.md).
- Quality monitor systemd `funnelmetry-cdc-quality.service` dùng
  [`tools/cdc-operations/monitor-quality.py`](../tools/cdc-operations/monitor-quality.py)
  và profile ở `/etc/funnelmetry/cdc/profiles`. Lệnh vận hành nằm trong
  [CDC operations README](../tools/cdc-operations/README.md).

## Bằng chứng và điều còn giới hạn

[CDC-14 execution](CDC14_RUNTIME_EXECUTION_2026-10-31.md) ghi backup restore,
stop-first, dọn clone và đối chiếu sau cutover: 104 sản phẩm, 16 bảng
inventory/price, 187 order current-state, fact offset 376,
`PASS_ACTIVE_LEASE`, ba public health HTTP 200. Một cart rỗng mới làm topic
cart và mapper applied offset cùng tăng 559→560, không sinh order fact.
[CDC-13 retirement](CDC13_RETIREMENT_2026-10-31.md) ghi việc gỡ Backend
Adapter và Admin API catalog pull. [CDC-12 order profile](CDC12_ORDER_REFERENCE_PROFILE_2026-10-30.md)
và [current-offer metadata](CDC12_REFERENCE_CURRENT_OFFER_METADATA_2026-10-30.md)
ghi activation/binding riêng. [CDC-11 runbook](CDC11_THREE_STREAM_CUTOVER_RUNBOOK.md)
và CDC-10 probe là lịch sử conformance/recovery, không phải lệnh deploy
runtime hiện hành.

Không suy từ mẫu tải reference thành SLO flash-sale, HA nhiều node, tính
đúng cho mọi shape price/inventory, hay semantic payment/refund/fulfillment.
Gateway HTTP và kế hoạch DB-GPT/Agent nằm ngoài cutover CDC này.
