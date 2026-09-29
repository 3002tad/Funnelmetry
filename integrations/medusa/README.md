# Medusa integration

Binding Medusa hiện theo **Behavior Event Catalog v2 / DEC-115**. Core Pipeline không import
Medusa hoặc đọc storage nội bộ Medusa; mọi source event đi qua Source Ingress và Canonical
Normalizer nạp catalog/mapping versioned.

- Browser chỉ phát các observation/intent được phép của Catalog v2; không được phát
  `cart.add_clicked` hoặc `behavior.search_submitted`.
- `cart.item_added` chỉ được source-side hook phát sau khi Medusa xác nhận `createLineItem`.
  Không map add-click thành business fact.
- Search hook chạy tại storefront server sau Search API: normalize/sanitize query, quan sát
  outcome/result count rồi enqueue non-blocking. Tracking outage không làm thay đổi Search API.
- `medusa.order_placed` schema 2.0 → `order.placed` qua mapping `medusa-order-placed-v2`; không suy diễn
  `order.accepted`, payment hoặc refund khi chưa có authoritative transition.

Payload order schema 2.0 giữ `total_amount`/`unit_price_amount` dạng decimal string,
`amount_unit=major`, `amount_semantics=medusa.order.total`, currency và stored cart link.
Không chia 100, không đổi thành minor. Giá trị đơn đã đặt không phải paid/net revenue.
Schema 1.0 cũ không được tự upgrade: trả unsupported và giữ raw record để xử lý có kiểm soát.
Tên file `.v1.json` là version của định dạng mapping artifact, không phải payload version.

`canonical-mappings.v1.json` chỉ chứa source-native mapping cần thiết. Catalog v2 passthrough
mapping validate behavior payload theo package version; producer/consumer phải pin cùng version
trong rollout.
