# @funnelmetry/canonical-normalizer

Worker bất đồng bộ sau raw durable ingress:

```text
raw topic
  → supported mapping → canonical topic + normalized outcome
  → unknown mapping   → quarantine topic + unsupported outcome
  → mapping invalid   → quarantine topic + quarantined outcome
```

Output, terminal outcome và raw consumer offset được commit trong cùng Kafka transaction.
Downstream phải đọc với `read_committed`/`readUncommitted: false`.

## Mapping boundary

Core chỉ có profile passthrough cho các canonical semantic đã được duyệt. Mapping native
của từng source được thêm qua `createMappingRegistry`; không đưa logic Medusa hoặc schema
host vào streaming/KPI core.

`occurred_at` fallback lần lượt từ `produced_at` rồi `ingested_at`. Fallback luôn gắn
`quality.authoritative_event_time=false` và không được giả làm source occurrence time.

Mapping source-native được nạp tùy chọn qua `CANONICAL_NORMALIZER_MAPPING_CONFIG_PATH`.
Reference Medusa dùng artifact versioned trong `integrations/medusa` cho
`medusa.order_placed` schema 2.0 -> `order.placed` (mapping `medusa-order-placed-v2`). Schema 1.0
không còn active native order mapping; cần kế hoạch replay riêng, không đoán đơn vị tiền. Ingress vẫn
giữ native event type và `mapping_version` là provenance của canonical semantics. `cart.item_added`
chỉ được passthrough khi source-side hook phát sau source-confirmed line-item result; không đổi
browser add-click thành business fact. `order.accepted`, payment và refund chỉ bật sau native hook
và conformance test chứng minh authoritative transition.

## Chạy

Provision các topic được khai báo trong `infra/.env.example`, sau đó:

```powershell
cd workers/canonical-normalizer
npm install
npm start
```

- canonical và quarantine topic dùng delete retention;
- canonicalization outcome topic dùng compaction;
- `CANONICAL_NORMALIZER_INSTANCE_ID` phải duy nhất và ổn định cho transactional producer;
- consumer group phải ổn định qua restart để raw offset tiếp tục đúng vị trí.
