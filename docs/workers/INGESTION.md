# Ingestion workers: normalize, telemetry, ledger

> Các worker này cùng xử lý đoạn Raw Kafka → canonical outcome/ledger. Mỗi phần vẫn có contract và giới hạn riêng; không suy từ một worker READY rằng toàn chuỗi đã hoàn tất.

## Mục lục

- [Canonical normalizer](#canonical-normalizer)
- [Ingress telemetry writer](#ingress-telemetry-writer)
- [Canonical ledger writer](#canonical-ledger-writer)


---

<a id="canonical-normalizer"></a>

## Canonical normalizer

> Nguồn gốc trước khi gộp: `docs/workers/canonical-normalizer/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

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

Provision các topic được khai báo trong `runtime/v2-dev.env.example`, sau đó:

```powershell
cd workers/canonical-normalizer
npm install
npm start
```

- canonical và quarantine topic dùng delete retention;
- canonicalization outcome topic dùng compaction;
- `CANONICAL_NORMALIZER_INSTANCE_ID` phải duy nhất và ổn định cho transactional producer;
- consumer group phải ổn định qua restart để raw offset tiếp tục đúng vị trí.

### Opt-in identity cho replica Docker

`CANONICAL_NORMALIZER_INSTANCE_ID_MODE=explicit` (mặc định) giữ nguyên ID cấu hình.
Base ID được kiểm tra 1–128 ký tự chữ/số/dấu chấm/gạch dưới/gạch ngang.
Chế độ `container` nối base `CANONICAL_NORMALIZER_INSTANCE_ID` với hostname mặc định
dạng container ID của Docker. Hai container có ID khác nhau; restart cùng container
giữ ID. Không dùng `hostname:` cố định/chung khi scale. Container bị recreate có ID
mới: transaction cũ có thể cần timeout, không claim ID ổn định qua recreate hoặc host
migration. Vẫn giữ consumer group và committed offsets; không đổi source event IDs.

Tính năng này chưa bật trong Compose demo/live. Xem
[sandbox autoscaling](../tools/RESILIENCE.md#autoscaler); không tự tăng replica nếu
chưa kiểm tra partition, consumer membership, replay và graceful shutdown.


---

<a id="ingress-telemetry-writer"></a>

## Ingress telemetry writer

> Nguồn gốc trước khi gộp: `docs/workers/ingress-telemetry-writer/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# @funnelmetry/ingress-telemetry-writer

Durable audit projection for evidence already present on Kafka:

```text
accepted receipt topic ─┐
                       ├─> PostgreSQL ingress/canonicalization telemetry
canonical outcome topic ┘
```

The writer persists one immutable accepted receipt per `(source_id,event_id)` and versioned terminal
canonicalization outcomes per `(source_id,source_event_id,mapping_version)`. PostgreSQL commit happens
before Kafka offset commit; redelivery is idempotent and conflicting immutable documents stop the
offset from advancing.

This worker does not infer duplicate attempts, rejected ingress, retryable failures, pre-SDK loss or
queue drops: the current durable topics do not contain those observations. Outcome history from a
running writer is retained by mapping version, while a rebuild from a compacted Kafka topic can only
recover the latest record still present for each key.

Apply `infra/postgres/v2/005_ingress_telemetry.sql`, provision the receipt/outcome topics, then run:

```powershell
cd workers/ingress-telemetry-writer
npm install
npm start
```


---

<a id="canonical-ledger-writer"></a>

## Canonical ledger writer

> Nguồn gốc trước khi gộp: `docs/workers/canonical-ledger-writer/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# @funnelmetry/canonical-ledger-writer

Persistence boundary cho `CanonicalEvent v1`:

```text
canonical Kafka topic
  → validate contract + Kafka key
  → PostgreSQL transaction
  → commit database
  → Kafka transaction: canonical-persisted handoff + canonical offset
```

`canonical_event_id` là primary key. Redelivery/re-normalization có nội dung giống nhau,
ngoại trừ `ingested_at`/`normalized_at` do xử lý lại, là no-op. Bản ghi đầu tiên và các
mốc thời gian gốc được giữ nguyên; persisted handoff luôn dùng document đã lưu, không
dùng document của lần retry. Những field khác (kể cả event-time, raw hash/reference,
identity, quality và dữ liệu nghiệp vụ) vẫn phải trùng khớp.
Cùng ID nhưng nội dung khác gây conflict/rollback và không commit Kafka offset. Vì vậy crash
sau database commit nhưng trước offset commit không tạo row thứ hai khi message được đọc lại.

Nếu Kafka transaction lỗi sau database commit, canonical offset chưa commit; lần retry xem
row là duplicate rồi phát lại persisted handoff an toàn. Consumer mới đọc topic từ đầu để
có thể rebuild ledger; consumer group ổn định tiếp tục từ
offset đã commit. PostgreSQL là structured source of truth, còn canonical Kafka topic là
stream/rebuild input trong retention đã công bố.

## Khởi tạo schema

Áp dụng [`../../infra/postgres/v2/001_canonical_ledger.sql`](../../infra/postgres/v2/001_canonical_ledger.sql)
vào database V2 trước khi chạy worker.

```powershell
cd workers/canonical-ledger-writer
npm install
npm start
```
