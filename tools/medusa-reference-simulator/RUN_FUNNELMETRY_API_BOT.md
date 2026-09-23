# Chạy Funnelmetry API Bot trên Source host

> **Trạng thái: tạm di chuyển, chưa được nối lại vào runtime.**
>
> Tài liệu và mã nguồn bot được chuyển nguyên trạng khỏi `Medusa_Reference` vào
> `Streaming_Pipeline/tools/medusa-reference-simulator` ngày 2026-09-23 để tách
> test harness khỏi source reference. Compose service, Docker build stage và các
> package script cũ đã bị gỡ khỏi Medusa. Các lệnh dựa vào profile
> `funnelmetry-test` bên dưới chỉ còn mang tính lịch sử và chưa thể dùng cho tới
> khi simulator được thiết kế lại. Logic event hiện tại chưa được nâng cấp.

## Mục đích

Bot tạo journey nhanh ở phía Source mà không cần trình duyệt hoặc Pipeline đang
online:

```text
Source Ingress smoke: behavior.product_viewed → checkout.started
Medusa: create cart → add real variant → address → shipping → payment → complete cart
Backend subscriber: order.placed → medusa.order_placed → Source Ingress
```

Behavior event dùng cùng `anonymous_id`, `session_id` và `correlation_id`, tuân
theo `IngressEvent v1`. Full mode tạo order bằng Store API của Medusa, vì vậy
business fact vẫn do native `order.placed` subscriber phát; bot không tự dựng
`medusa.order_placed`.

API bot không phát `cart.add_clicked`. Trong catalog V2, `cart.item_added` chỉ
được source/server xác nhận; full mode tạo line item thật cho checkout nhưng
không dùng API bot để claim delivery của frontend server-side cart hook.

Bot chỉ chứng minh **Source durable acceptance**: mỗi receipt có
`accepted|duplicate`, `event_feed_id` từ readiness và `ingress_seq`. Nó không
chứng minh Pipeline đã pull, Kafka đã durable-publish hay canonical analytics
đã cập nhật. Những bước đó thuộc acceptance của Pipeline Source Connector.

## Chạy bằng container trên server

Bot thuộc Compose profile `funnelmetry-test`, là one-shot container và tự bị
xóa sau mỗi lượt. Container gọi Medusa qua `http://backend:9000`, behavior
event đi qua public Source Ingress/Cloudflare theo đúng đường browser reference.

`runtime/server.env` phải có các credential/configuration cần thiết nhưng không
được in giá trị thật:

```bash
cd /home/ntd/dtc-starter-funnelmetry
grep -E '^(NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY|NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY|FUNNELMETRY_SOURCE_INGRESS_URL)=' runtime/server.env \
  | sed 's/=.*/=<configured>/'
```

Build bot:

```bash
docker compose --env-file runtime/server.env \
  -f runtime/docker-compose.yml \
  --profile funnelmetry-test \
  build funnelmetry-api-bot
```

Chạy 10 journey đầy đủ:

```bash
docker compose --env-file runtime/server.env \
  -f runtime/docker-compose.yml \
  --profile funnelmetry-test \
  run --rm --no-deps funnelmetry-api-bot \
  --mode full --journeys 10 --concurrency 2 --step-delay-ms 20
```

`--no-deps` không recreate Medusa. Nếu cần giới hạn product, truyền product ID
hoặc handle bằng `--product-ids`.

Chỉ kiểm tra Source Ingress behavior, không tạo order:

```bash
docker compose --env-file runtime/server.env \
  -f runtime/docker-compose.yml \
  --profile funnelmetry-test \
  run --rm --no-deps funnelmetry-api-bot \
  --mode behavior --journeys 100 --concurrency 10
```

Trong mode `behavior`, event có `source_metadata.synthetic=true` để không lẫn
với traffic thật.

## Đọc kết quả

Summary trả số journey, `events_source_accepted`, event feed lineage tại thời
điểm bắt đầu, số Medusa order, retry, throughput và latency.
`medusa_order_evidence` giữ snapshot `cart_id`, `order_id`, `currency_code` và
`total_amount` do Store API trả về lúc complete cart. Thành công ở đây
không cho phép claim end-to-end analytics; Pipeline phải pull `/v1/events` với
Bearer credential riêng và chứng minh Kafka/canonical downstream theo contract.

### Xác minh liên kết cart–order và money contract

Khi backend integration `0.2.3` đã deploy, đối chiếu từng phần tử trong
`medusa_order_evidence` với record `medusa.order_placed` trên Source Feed. Dùng
feed token chỉ-đọc; không in token hoặc commit token:

```bash
curl -fsS \
  -H "Authorization: Bearer $SOURCE_EVENT_FEED_TOKEN" \
  "https://ingest-test.entidi.io.vn/v1/events?after_seq=0&limit=100&wait=0" \
  | jq '.events[] | select(.source_event_type == "medusa.order_placed")'
```

Một record đạt yêu cầu khi tất cả điều kiện sau đúng:

- `source_payload.order_id` bằng `order_id` của bot.
- `source_payload.cart_id` bằng `cart_id` của bot.
- `correlation_id` bằng `cart:<cart_id>`; `checkout.started` và
  `cart.item_added` của cùng cart cũng dùng giá trị này.
- `source_payload.currency_code` là mã ISO ba ký tự dạng lowercase và bằng
  `currency_code` của Medusa order.
- So sánh decimal, `source_payload.total_amount` bằng `total_amount` của
  Medusa order; `amount_unit` phải là `major` và `amount_semantics` phải là
  `medusa.order.total`.
- Record không có `total_minor`. Không nhân/chia 100; không cộng amount
  giữa các `currency_code` khác nhau.

Subscriber lấy `order.total`, `order.currency_code` và quan hệ `order.cart.id`
trong cùng một Query. Nếu thiếu hoặc sai format bất kỳ giá trị bắt buộc
nào, nó bỏ qua event và ghi warning theo cơ chế fail-open thay vì phát
record money không xác định.

Chạy unit test local không cần server:

```bash
node --test tools/funnelmetry-api-bot.test.mjs
```
