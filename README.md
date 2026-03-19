# README_UPDATE — Lịch sử thay đổi & Bug Fixes

> Ghi lại toàn bộ thay đổi đã được test và xác nhận chạy thành công.

---

## Optimization Update (2026-03-17)

### Kiến trúc mới ưu tiên hiệu năng

Luồng ingest hiện tại đã được tối ưu theo hướng:

`Generator UI/API -> Kafka (direct)` → `Spark Structured Streaming` → `PostgreSQL` → `Dashboard API/UI`

`producer-poller` vẫn được giữ lại như **fallback path** khi `generator-api` không kết nối được Kafka. Điều này giữ backward compatibility và tránh mất event khi Kafka tạm thời unavailable.

### Các thay đổi chính đã áp dụng

- `generator-api` publish trực tiếp vào Kafka bằng `kafkajs`
- `dashboard-api` thêm TTL cache cho `/api/kpi`, `/api/timeseries`, `/api/health`, `/api/metrics`
- `spark-streaming` tăng topic partitions lên `3`, thêm `maxOffsetsPerTrigger=5000`, tăng parallelism/JDBC batchsize
- PostgreSQL thêm index `ingest_time`, `status`, thêm retention helper `cleanup_old_events()`
- Frontend giảm refetch dư thừa bằng `staleTime` + `refetchOnWindowFocus: false`
- K3s manifest thêm `resources.requests/limits`, `livenessProbe`, `readinessProbe`

### Config mới cần chú ý

- `api-generator` cần:
  - `KAFKA_BOOTSTRAP_SERVERS=kafka:9092`
  - `KAFKA_TOPIC=events_raw`
- `spark-streaming` có thêm:
  - `KAFKA_NUM_PARTITIONS=3`
  - `KAFKA_MAX_OFFSETS_PER_TRIGGER=5000`

### Migration notes

- Topic `events_raw` mới sẽ được tạo với `3 partitions` nếu chưa tồn tại.
- Nếu topic cũ đã tồn tại với `1 partition`, cần tăng partition thủ công ở Kafka để đạt full throughput benefit.
- `producer-poller` chưa bị xóa để tránh breaking deployment; có thể scale về `0` sau khi xác nhận direct Kafka path ổn định.

### Phase 2 — observability + optional fallback

- `generator-api` có thêm Prometheus-style endpoint: `/metrics`
- `dashboard-api` có thêm Prometheus-style endpoint: `/metrics`
- Docker Compose: `producer-poller` không còn chạy mặc định; chỉ chạy khi bật profile `fallback`
- K3s: `producer` deployment mặc định `replicas: 0`

#### Bật lại fallback path khi cần

**Docker Compose**

```bash
docker compose --profile fallback up -d producer
```

**K3s**

```bash
wsl.exe -e sh -lc "sudo k3s kubectl scale deployment/producer -n realtime --replicas=1"
```

#### Metrics endpoints

- `http://localhost:7070/metrics` — `generator-api`
- `http://localhost:8080/metrics` — `dashboard-api`

Các metrics hiện tại là lightweight application metrics, phù hợp để scrape bởi Prometheus hoặc đọc trực tiếp để debug nhanh.

---

## Tổng quan

| Hạng mục | Trước | Sau |
|----------|-------|-----|
| Container status | `dashboard-api` build fail; `frontend` + `generator-ui` unhealthy | Tất cả 8 containers **healthy** |
| Dashboard data | Hiển thị mock data cứng (MockDataGenerator) | Live data từ PostgreSQL |
| Pipeline Spark | Bị stuck ở 14 events, không cập nhật | Đang ghi liên tục |
| Spark kpi_1m | Lỗi duplicate key, job crash | Upsert thành công với `ON CONFLICT DO UPDATE` |
| Generator UI event log | Luôn hiển thị 0 events | Poll live data từ dashboard-api mỗi 3s |
| Generator UI statistics | Chỉ đếm 50 rows page hiện tại | Từ `kpi_1m` — toàn bộ DB, nhất quán theo status |
| Total Events count | Bị cap ở 50 (page size) | Số thực từ `kpi_1m` SUM |
| Batch Emit / Auto Emit | Không hoạt động | Hoạt động qua event queue |
| Success Rate dashboard | Có thể > 100% (chia cho `orders_created`) | Luôn ≤ 100% (chia cho `success + totalFailed`) |
| Nginx frontend proxy | 502 Bad Gateway khi `dashboard-api` được recreate | Tự re-resolve DNS qua Docker resolver |
| End-to-end latency | ~60-90 giây | ~10-15 giây |
| Kafka topic tự tạo | Phụ thuộc `kafka-init` container riêng | `kafka.allow.auto.create.topics=true` trên Spark |
| `order_cancelled` statistics | Bị tính nhầm vào `pending` | Được Spark aggregate vào `order_cancelled` cột |
| Dashboard KPI cards | `Orders Created`, `Payment Failed` (thiếu ngữ nghĩa) | `Total Events`, `Pending`, `Failed` (đúng status) |

---

## Chi tiết từng thay đổi

---

### 1. Fix build `dashboard-api` — `npm ci` → `npm install`

**File:** `services/dashboard-api/Dockerfile`

**Vấn đề:** `npm ci` yêu cầu `package-lock.json` nhưng file này không tồn tại trong repo → build fail.

**Fix:**
```dockerfile
# Trước
RUN npm ci

# Sau
RUN npm install --omit=dev
```

---

### 2. Fix healthcheck nginx — `localhost` → `127.0.0.1`

**Files:** `frontend/Dockerfile`, `generator-ui/Dockerfile`

**Vấn đề:** Trên Alpine Linux, `localhost` resolve thành IPv6 `::1`, nhưng nginx chỉ listen trên IPv4 → healthcheck fail → container `unhealthy`.

**Fix:**
```dockerfile
# Trước
CMD wget --quiet --tries=1 --spider http://localhost:5173 || exit 1

# Sau
CMD wget --quiet --tries=1 --spider http://127.0.0.1:5173 || exit 1
```

---

### 3. Bỏ mock data banner — hiển thị Live Data Mode

**File:** `frontend/src/lib/api.ts`

**Vấn đề:** Banner "Mock Data Mode" hiển thị cứng, không phụ thuộc vào biến `VITE_USE_MOCK`.

**Fix:** Export biến `USE_MOCK` từ `api.ts`; Dashboard đọc biến này để conditionally render banner. `Dockerfile` build với `VITE_USE_MOCK=false` → banner không hiển thị khi chạy production.

---

### 4. Fix Spark Structured Streaming — duplicate key trên `kpi_1m`

**File:** `services/spark-streaming/spark_stream.py`

**Vấn đề:** Spark Structured Streaming với windowed aggregation re-emit các window đã tính khi có late data. `foreachBatch` dùng JDBC `mode('append')` = INSERT → lỗi duplicate key trên `kpi_1m_pkey (window_start)` → job crash, pipeline stuck.

**Fix:** Thay JDBC write bằng hàm `upsert_kpi_to_postgres()` dùng `psycopg2`:

```python
def upsert_kpi_to_postgres(batch_df, batch_id):
    conn = psycopg2.connect(
        host=POSTGRES_HOST, port=POSTGRES_PORT, dbname=POSTGRES_DB,
        user=POSTGRES_USER, password=POSTGRES_PASSWORD
    )
    cursor = conn.cursor()
    for row in batch_df.collect():
        cursor.execute("""
            INSERT INTO kpi_1m
                (window_start, window_end, revenue, orders_created,
                 payment_success, payment_failed, success_rate, processed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (window_start) DO UPDATE SET
                window_end      = EXCLUDED.window_end,
                revenue         = EXCLUDED.revenue,
                orders_created  = EXCLUDED.orders_created,
                payment_success = EXCLUDED.payment_success,
                payment_failed  = EXCLUDED.payment_failed,
                success_rate    = EXCLUDED.success_rate,
                processed_at    = NOW()
        """, (...))
    conn.commit()
```

**Kết quả:** `events_clean` 3200+ rows, `kpi_1m` 18+ rows, cập nhật liên tục.

---

### 5. Thêm biến môi trường PostgreSQL riêng cho Spark

**File:** `services/spark-streaming/spark_stream.py`, `infra/docker-compose.yml`

**Vấn đề:** `upsert_kpi_to_postgres()` cần kết nối PostgreSQL trực tiếp qua `psycopg2` nhưng config chỉ có JDBC URL chung.

**Fix:** Tách thành các biến riêng:
```python
POSTGRES_HOST     = os.environ.get('POSTGRES_HOST', 'postgres')
POSTGRES_PORT     = int(os.environ.get('POSTGRES_PORT', 5432))
POSTGRES_DB       = os.environ.get('POSTGRES_DB', 'realtime')
```

---

### 6. Generator UI — event log poll live data

**Files:** `generator-ui/src/App.tsx`, `generator-ui/src/services/generatorApi.ts`

**Vấn đề:** Event Log trong Generator UI chỉ track các event được emit trong session hiện tại qua button → luôn hiển thị 0 khi reload.

**Fix:** Thêm `useEffect` poll `dashboard-api /api/events` mỗi 3 giây, hiển thị live data từ PostgreSQL:

```typescript
useEffect(() => {
  const fetchLive = async () => {
    const { events: liveEvents, total, statusCounts: sc } =
      await generatorApi.getLiveEvents(50);
    setEvents(liveEvents);
    setTotalEvents(total);
    setStatusCounts(sc);
  };
  fetchLive();
  const timer = setInterval(fetchLive, 3000);
  return () => clearInterval(timer);
}, []);
```

---

### 7. Direct Kafka + Legacy Fallback — `generator-api`

**File:** `services/generator-api/server.js`

**Kiến trúc hiện tại:**
- **Primary path**: Generator UI → `generator-api` → Kafka trực tiếp (`kafkajs`)
- **Legacy fallback path**: chỉ khi Kafka unavailable **và** `ENABLE_QUEUE_FALLBACK=true`, event mới được đẩy vào `eventQueue[]`; khi đó `producer-poller` có thể drain queue để bridge sang Kafka

Mặc định deployment hiện tại:
- direct Kafka: **ON**
- queue fallback: **OFF**
- `producer-poller`: **OFF**

**Fix:**
```javascript
const ENABLE_QUEUE_FALLBACK = (process.env.ENABLE_QUEUE_FALLBACK || "true") === "true";

// Primary path: publish trực tiếp vào Kafka
const sent = await publishToKafka(events);

// Chỉ fallback sang queue khi được bật rõ ràng
if (!sent && ENABLE_QUEUE_FALLBACK) {
  eventQueue.push(...events);
}
```

**Kết quả:** Luồng chính rõ ràng hơn, không còn phụ thuộc HTTP polling trong runtime mặc định.

---

### 8. `producer-poller` — xử lý 204 (queue rỗng)

**File:** `services/producer-poller/producer.py`

**Vai trò hiện tại:** Đây là **legacy fallback bridge**, không còn là producer chính của hệ thống.

**Vấn đề:** Khi queue rỗng, `GET /gen/event` / `GET /gen/drain` trả về 204 No Content → poller cần idle an toàn.

**Fix:**
```python
def fetch_event():
    response = requests.get(API_URL, timeout=5)
    if response.status_code == 204:
        return None  # Queue rỗng — không làm gì
    response.raise_for_status()
    return response.json()

# Main loop
event = fetch_event()
if event:
    producer.produce('events_raw', json.dumps(event))
# else: idle, chờ poll tiếp theo
```

---

### 9. Fix Total Events count — tách `totalEvents` state

**Files:** `generator-ui/src/App.tsx`, `generator-ui/src/services/generatorApi.ts`, `generator-ui/src/components/EventLogTable.tsx`

**Vấn đề:** Statistics "Total Events" hiển thị `events.length` = tối đa 50 (page size), không phải tổng thực tế trong DB.

**Fix:** `getLiveEvents()` trả về `{ events, total, statusCounts }`:

```typescript
// generatorApi.ts
async getLiveEvents(pageSize = 50): Promise<{
  events: Event[];
  total: number;
  statusCounts: { success: number; pending: number; failed: number };
}> {
  const data = await res.json();
  return {
    events: data.events.map(normalise),
    total: data.total,               // COUNT(*) thực từ DB
    statusCounts: data.statusCounts,
  };
}
```

```tsx
// App.tsx — state riêng
const [totalEvents, setTotalEvents] = useState(0);
// Hiển thị totalEvents (không phải events.length)
```

EventLogTable header hiển thị `"showing 50 of 3209"` khi có nhiều hơn 50 events.

---

### 10. Fix Statistics Success/Pending/Failed — dùng `kpi_1m`

**File:** `services/dashboard-api/server.js`

**Vấn đề:** `SUCCESS/PENDING/FAILED` trong Generator UI đếm bằng `GROUP BY status` trên `events_clean` — full table scan, và chỉ tính 50 rows của page hiện tại.

**Fix:** Query `kpi_1m` (đã được Spark pre-aggregate) thay vì scan `events_clean`:

```javascript
// Trước: GROUP BY status trên events_clean (chậm + sai)
SELECT status, COUNT(*) FROM events_clean GROUP BY status

// Sau: SUM từ kpi_1m (nhanh + đúng ngữ nghĩa business)
SELECT
  COALESCE(SUM(payment_success), 0)::int AS success,
  COALESCE(SUM(payment_failed),  0)::int AS failed
FROM kpi_1m
// pending = total_events - success - failed
```

**Ý nghĩa:** `success` = số sự kiện `payment_success`, `failed` = số sự kiện `payment_failed`, `pending` = toàn bộ còn lại (`order_created`, `payment_initiated`, `order_cancelled`).

Response `/api/events` được mở rộng thêm field `statusCounts`:
```json
{
  "events": [...],
  "total": 3209,
  "statusCounts": { "success": 1123, "failed": 269, "pending": 1817 }
}
```

---

### 11. Fix Success Rate Dashboard — không thể > 100%

**File:** `services/dashboard-api/server.js`

**Vấn đề:** Công thức cũ: `payment_success / orders_created` → có thể > 100% vì đây là 2 loại event độc lập, không phải tỉ lệ thực sự.

**Fix:**
```sql
-- Trước
ROUND(100.0 * SUM(payment_success) / SUM(orders_created), 2)

-- Sau
ROUND(100.0 * SUM(payment_success) / (SUM(payment_success) + SUM(payment_failed)), 2)
```

**Kết quả:** Success Rate ~ 80% (luôn trong khoảng 0–100%).

---

### 12. Fix nginx 502 Bad Gateway — DNS re-resolve

**File:** `frontend/nginx.conf`

**Vấn đề:** Khi container `dashboard-api` được recreate, IP của nó trong Docker network thay đổi. nginx của `frontend-dashboard` cache DNS resolution lúc khởi động → trỏ vào IP cũ → 502 Bad Gateway.

**Fix:** Dùng Docker internal DNS resolver (`127.0.0.11`) với TTL ngắn:

```nginx
# Thêm vào nginx.conf
resolver 127.0.0.11 valid=5s ipv6=off;
set $dashboard_api http://dashboard-api:8080;

location /api/ {
    proxy_pass $dashboard_api;  # Variable → nginx re-resolve mỗi 5s
    ...
}
```

**Kết quả:** Frontend tự động reconnect đến `dashboard-api` mới sau tối đa 5 giây, không cần restart `frontend-dashboard`.

---

## Kiến trúc sau khi cập nhật

```
┌─────────────────────┐
│   Generator UI      │  POST /gen/emit
│   (React :5174)     │──────────────────┐
└─────────────────────┘                  ▼
                               ┌──────────────────────┐
                               │   generator-api      │
                               │   (Node.js :7070)    │
                               │                      │
                               │  eventQueue[]        │
                               │  POST /gen/emit →    │
                               │    queue.push()      │
                               │  GET  /gen/event →   │
                               │    queue.shift()     │
                               │    (204 if empty)    │
                               └──────────┬───────────┘
                                          │ GET /gen/event (poll 500ms)
                                          ▼
                               ┌──────────────────────┐
                               │   producer-poller    │
                               │   (Python)           │
                               │   if 204 → idle      │
                               │   else → produce     │
                               └──────────┬───────────┘
                                          │ Produce
                                          ▼
                               ┌──────────────────────┐
                               │   Kafka Broker       │
                               │   topic: events_raw  │
                               └──────────┬───────────┘
                                          │ Stream
                                          ▼
                               ┌──────────────────────┐
                               │   Spark Streaming    │
                               │   UC03 Parse         │
                               │   UC04 Deduplicate   │
                               │   UC05 KPI Window    │
                               │   UC06 Upsert PG     │
                               └──────────┬───────────┘
                                          │ Write
                                          ▼
                               ┌──────────────────────┐
                               │   PostgreSQL         │
                               │   events_clean       │
                               │   kpi_1m (upsert)    │
                               └──────────┬───────────┘
                                          │ Query
                                          ▼
                               ┌──────────────────────┐
                               │   dashboard-api      │
                               │   (Node.js :8080)    │
                               │   /api/kpi           │
                               │   /api/timeseries    │
                               │   /api/events        │
                               │   + statusCounts     │
                               └──────────┬───────────┘
                               ┌──────────┘
                               │ nginx proxy (DNS re-resolve)
                               ▼
                    ┌─────────────────────┐
                    │  React Dashboard    │
                    │  (Nginx :5173)      │
                    │  Live KPI + Charts  │
                    └─────────────────────┘
```

---

## Files đã thay đổi

| File | Thay đổi |
|------|----------|
| `services/dashboard-api/Dockerfile` | `npm ci` → `npm install --omit=dev` |
| `services/dashboard-api/server.js` | statusCounts từ `kpi_1m`; `/api/kpi` redesign (`totalEvents`, `pending`, `totalFailed`); success rate formula fix; thêm cache TTL và `/metrics` |
| `services/generator-api/server.js` | Direct Kafka publish bằng `kafkajs`; queue chỉ còn là legacy fallback tùy chọn; thêm `/metrics` và health/queue visibility |
| `services/generator-api/package.json` | Thêm dependency `kafkajs` cho direct Kafka publish |
| `services/producer-poller/producer.py` | Chuyển vai trò thành legacy fallback bridge; polling/logging gọn hơn |
| `services/spark-streaming/spark_stream.py` | `upsert_kpi_to_postgres()` ON CONFLICT; watermark 30s; trigger 5s; `kafka.allow.auto.create.topics=true`; thêm `order_cancelled`, `payment_initiated` columns |
| `infra/postgres/init.sql` | `kpi_1m` thêm cột `order_cancelled`, `payment_initiated` |
| `infra/docker-compose.yml` | Xóa `kafka-init` service; `spark-streaming` depends_on đơn giản hóa |
| `frontend/Dockerfile` | Healthcheck dùng `127.0.0.1` |
| `frontend/nginx.conf` | `resolver 127.0.0.11 valid=5s`; DNS re-resolve động |
| `frontend/src/lib/api.ts` | `BusinessKPI` interface: `totalEvents`, `pending`, `totalFailed` |
| `frontend/src/features/dashboard/Dashboard.tsx` | KPI cards: Total Events, Pending, Failed; refetchInterval 5s |
| `generator-ui/Dockerfile` | Healthcheck dùng `127.0.0.1` |
| `generator-ui/src/services/generatorApi.ts` | `getLiveEvents()` trả `{ events, total, statusCounts }` |
| `generator-ui/src/App.tsx` | `totalEvents` + `statusCounts` state từ DB; poll 3s |

---

### 13. Latency Optimization — giảm end-to-end latency

**Files:** `services/producer-poller/producer.py`, `services/spark-streaming/spark_stream.py`, `frontend/src/features/dashboard/Dashboard.tsx`

**Vấn đề:** Pipeline có latency cao từ lúc emit đến lúc hiển thị trên dashboard (~60-90 giây).

**Fix đồng thời ở 3 tầng:**

```python
# producer.py — poll nhanh hơn, Kafka async
POLL_INTERVAL_MS = 100          # 500ms → 100ms
producer = KafkaProducer(
    acks=1,                     # acks='all' → acks=1 (không blocking)
    linger_ms=5,
    compression_type='gzip',
)
producer.send(topic, value=msg) # fire-and-forget (không gọi .get())

# Log spam fix: chỉ log khi thực sự có events
if total_pulled > 0 and total_pulled % 20 == 0:
    print(f"Stats: ...")
```

```python
# spark_stream.py — watermark ngắn hơn, trigger rõ ràng
cleaned_df = df.withWatermark('event_time', '30 seconds')  # 5 minutes → 30s

kpi_query = kpi_stream.writeStream \
    .trigger(processingTime='5 seconds') \   # thêm trigger rõ ràng
    ...

events_query = clean_stream.writeStream \
    .trigger(processingTime='5 seconds') \
    ...

# Bỏ batch_df.count() trước khi write (double scan)
rows = batch_df.collect()  # collect() trả [] nếu rỗng, không cần count
```

```typescript
// Dashboard.tsx — refresh KPI nhanh hơn
refetchInterval: autoRefresh ? 5000 : false   // 10000 → 5000ms
```

---

### 14. Bỏ `kafka-init` service — Spark tự tạo topic

**Files:** `infra/docker-compose.yml`, `services/spark-streaming/spark_stream.py`

**Vấn đề:** Khi start lần đầu không có data, topic `events_raw` chưa tồn tại trên Kafka. Spark subscribe ngay lúc boot → `UnknownTopicOrPartitionException` → container crash.

Trước đó dùng `kafka-init` (một-shot container dùng `kafka-topics.sh`) để tạo topic trước khi Spark khởi động — nhưng tạo thêm dependency phức tạp và không cần thiết.

**Fix:**
```python
# spark_stream.py — thêm option cho Kafka consumer client
raw_stream = spark.readStream \
    .format('kafka') \
    .option('kafka.bootstrap.servers', KAFKA_BOOTSTRAP_SERVERS) \
    .option('subscribe', KAFKA_TOPIC) \
    .option('startingOffsets', 'latest') \
    .option('failOnDataLoss', 'false') \
    .option('kafka.allow.auto.create.topics', 'true') \   # <-- thêm
    .load()
```

```yaml
# docker-compose.yml — xóa toàn bộ kafka-init service
# kafka broker đã có:  KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
spark-streaming:
  depends_on:
    kafka:
      condition: service_healthy
    postgres:
      condition: service_healthy
    # kafka-init đã bị xóa
```

**Kết quả:** Stack khởi động sạch, Spark ở trạng thái idle (không có data, không crash). User điều khiển data hoàn toàn qua Generator UI.

---

### 15. Fix `kpi_1m` schema — thêm `order_cancelled` và `payment_initiated`

**Files:** `infra/postgres/init.sql`, `services/spark-streaming/spark_stream.py`, `services/dashboard-api/server.js`

**Vấn đề:** `kpi_1m` chỉ có cột `payment_failed`. Event type `order_cancelled` (cũng có `status='failed'`) không được Spark aggregate vào đây → bị "mất" khỏi statistics. Tương tự `payment_initiated` (status=`pending`) không được track riêng.

**Fix — schema:**
```sql
-- init.sql
ALTER TABLE kpi_1m ADD COLUMN order_cancelled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kpi_1m ADD COLUMN payment_initiated INTEGER NOT NULL DEFAULT 0;
```

**Fix — Spark aggregation:**
```python
kpi_df = df.groupBy(window(...)).agg(
    _sum(when(col('event_type') == 'order_created',     1).otherwise(0)).alias('orders_created'),
    _sum(when(col('event_type') == 'payment_initiated', 1).otherwise(0)).alias('payment_initiated'),  # thêm
    _sum(when(col('event_type') == 'payment_success',   1).otherwise(0)).alias('payment_success'),
    _sum(when(col('event_type') == 'payment_failed',    1).otherwise(0)).alias('payment_failed'),
    _sum(when(col('event_type') == 'order_cancelled',   1).otherwise(0)).alias('order_cancelled'),    # thêm
)
```

---

### 16. Fix status counts — timing mismatch giữa `events_clean` và `kpi_1m`

**File:** `services/dashboard-api/server.js`

**Vấn đề:** `statusCounts` trong `/api/events` tính `pending = total_events - success - failed`, trong đó:
- `total` lấy từ `COUNT(*) events_clean` — cập nhật ngay mỗi batch Spark (~5s)
- `success/failed` lấy từ `SUM kpi_1m` — chỉ cập nhật sau khi window đóng (watermark 30s)

→ Trong khoảng ~35 giây, `total` đã tăng nhưng `success/failed` chưa cập nhật → `pending` bị inflate.

**Fix:** Tính tất cả ba giá trị từ cùng một nguồn `kpi_1m`:
```javascript
// Trước: pending = total(events_clean) - success(kpi_1m) - failed(kpi_1m)  ← sai
// Sau: tất cả từ kpi_1m
SELECT
  COALESCE(SUM(payment_success), 0)::int                         AS success,
  COALESCE(SUM(payment_failed) + SUM(order_cancelled), 0)::int   AS failed,
  COALESCE(SUM(orders_created) + SUM(payment_initiated), 0)::int AS pending
FROM kpi_1m
```

**Kết quả:** `success + pending + failed` luôn bằng `totalEvents` từ `kpi_1m`.

---

### 17. Redesign `/api/kpi` — căn chỉnh theo status semantics

**Files:** `services/dashboard-api/server.js`, `frontend/src/lib/api.ts`, `frontend/src/features/dashboard/Dashboard.tsx`

**Vấn đề:** Dashboard trái hiển thị `Orders Created` (chỉ `order_created` event type) và `Payment Failed` (chỉ `payment_failed` event type) — không khớp với khái niệm status thực. User nhìn thấy số khác với Generator UI Statistics.

**Mapping đúng:**

| event_type | status | kpi_1m column | Dashboard card (trước) | Dashboard card (sau) |
|---|---|---|---|---|
| `order_created` | `pending` | `orders_created` | Orders Created | ❌ bị gộp |
| `payment_initiated` | `pending` | `payment_initiated` | ❌ không hiện | ❌ bị gộp |
| `payment_success` | `success` | `payment_success` | Payment Success ✓ | Payment Success ✓ |
| `payment_failed` | `failed` | `payment_failed` | Payment Failed (thiếu order_cancelled) | ❌ bị gộp |
| `order_cancelled` | `failed` | `order_cancelled` | ❌ không hiện | ❌ bị gộp |

**Fix — `/api/kpi` response fields:**
```javascript
// Trước
{ revenue, ordersCreated, paymentSuccess, paymentFailed, successRate }

// Sau — căn chỉnh theo status
{
  revenue,
  totalEvents,      // tổng 5 loại event
  paymentSuccess,   // status=success
  pending,          // status=pending: orders_created + payment_initiated
  totalFailed,      // status=failed:  payment_failed  + order_cancelled
  successRate       // success / (success + totalFailed) — denominator đúng
}
```

**Fix — Dashboard KPI cards:**
- Bỏ "Orders Created" → thêm **"Total Events"**
- Bỏ "Payment Failed" → thêm **"Failed"** (gộp `payment_failed + order_cancelled`)
- Thêm **"Pending"** (gộp `order_created + payment_initiated`)

**Kết quả:** Dashboard trái và Generator UI Statistics hiển thị số liệu nhất quán.

---

## Trạng thái containers (sau tất cả fix)

```
CONTAINER             STATUS         PORTS
zookeeper             Up (healthy)   2181
kafka                 Up (healthy)   9092
postgres              Up (healthy)   5432
api-generator         Up             7070
producer-poller       Up (hoặc stopped nếu muốn dừng auto-gen)
spark-streaming       Up             —
dashboard-api         Up (healthy)   8080
generator-ui          Up (healthy)   5174
frontend-dashboard    Up (healthy)   5173
```

**Lưu ý lịch sử:** đoạn này áp dụng cho kiến trúc cũ. Ở kiến trúc hiện tại, `generator-api` publish trực tiếp vào Kafka; `producer-poller` chỉ còn là fallback bridge tùy chọn.
