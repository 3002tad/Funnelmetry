# README_UPDATE — Lịch sử thay đổi & Bug Fixes

> Ghi lại toàn bộ thay đổi đã được test và xác nhận chạy thành công.

---

## Tổng quan

| Hạng mục | Trước | Sau |
|----------|-------|-----|
| Container status | `dashboard-api` build fail; `frontend` + `generator-ui` unhealthy | Tất cả 9 containers **healthy** |
| Dashboard data | Hiển thị mock data cứng (MockDataGenerator) | Live data từ PostgreSQL |
| Pipeline Spark | Bị stuck ở 14 events, không cập nhật | Đang ghi liên tục, 3200+ events |
| Spark kpi_1m | Lỗi duplicate key, job crash | Upsert thành công với `ON CONFLICT DO UPDATE` |
| Generator UI event log | Luôn hiển thị 0 events | Poll live data từ dashboard-api mỗi 3s |
| Generator UI statistics | Success/Pending/Failed chỉ đếm 50 rows page hiện tại | Lấy từ `kpi_1m` — toàn bộ DB |
| Total Events count | Bị cap ở 50 (page size) | Số thực từ `COUNT(*)` PostgreSQL |
| Batch Emit / Auto Emit | Không hoạt động | Hoạt động qua event queue |
| Success Rate dashboard | Có thể > 100% (chia cho `orders_created`) | Luôn ≤ 100% (chia cho `success + failed`) |
| Nginx frontend proxy | 502 Bad Gateway khi `dashboard-api` được recreate | Tự re-resolve DNS qua Docker resolver |

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

### 7. Event Queue Architecture — `generator-api`

**File:** `services/generator-api/server.js`

**Vấn đề / Thiết kế lại:** Cần tách rõ hai luồng:
- **Production path**: `producer-poller` (Python) → Kafka (luôn chạy)
- **Dev/manual path**: Generator UI → `generator-api` → Kafka (thông qua poller)

`generator-api` không nên kết nối Kafka trực tiếp. Thay vào đó dùng in-memory queue.

**Fix:**
```javascript
const eventQueue = [];
const MAX_QUEUE_SIZE = 10000;

// POST /gen/emit → đẩy vào queue
app.post("/gen/emit", (req, res) => {
  const event = generateEvent(req.body);
  eventQueue.push(event);
  res.json({ ...event, _queued: true, queueSize: eventQueue.length });
});

// POST /gen/emit-batch → đẩy nhiều events vào queue  
app.post("/gen/emit-batch", (req, res) => {
  const { count = 10 } = req.body;
  const events = Array.from({ length: count }, () => generateEvent({}));
  eventQueue.push(...events);
  res.json({ count: events.length, queueSize: eventQueue.length, events });
});

// GET /gen/event → poller lấy từ queue; 204 nếu queue rỗng (không generate ngẫu nhiên)
app.get("/gen/event", (req, res) => {
  if (eventQueue.length === 0) return res.status(204).end();
  res.json(eventQueue.shift());
});
```

**Loại bỏ:** `kafkajs` dependency khỏi `generator-api` (không cần thiết).

---

### 8. `producer-poller` — xử lý 204 (queue rỗng)

**File:** `services/producer-poller/producer.py`

**Vấn đề:** Khi queue rỗng, `GET /gen/event` trả về 204 No Content → poller trước đó crash hoặc generate event ngẫu nhiên.

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
| `services/dashboard-api/server.js` | statusCounts dùng `kpi_1m`; success rate formula fix; thêm field `statusCounts` vào `/api/events` response |
| `services/generator-api/server.js` | Event queue architecture; `GET /gen/event` trả 204 khi rỗng; `POST /gen/emit-batch`; xóa kafkajs |
| `services/generator-api/package.json` | Xóa dependency `kafkajs` |
| `services/generator-api/Dockerfile` | `npm install --omit=dev` |
| `services/producer-poller/producer.py` | Xử lý HTTP 204 → idle (không crash, không generate random) |
| `services/spark-streaming/spark_stream.py` | `upsert_kpi_to_postgres()` dùng psycopg2 + `ON CONFLICT DO UPDATE`; thêm `POSTGRES_HOST/PORT/DB` vars |
| `frontend/Dockerfile` | Healthcheck dùng `127.0.0.1` thay `localhost` |
| `frontend/nginx.conf` | `resolver 127.0.0.11 valid=5s`; `set $dashboard_api` để re-resolve DNS động |
| `frontend/src/lib/api.ts` | Export `USE_MOCK`; mock banner conditional |
| `generator-ui/Dockerfile` | Healthcheck dùng `127.0.0.1` thay `localhost` |
| `generator-ui/src/services/generatorApi.ts` | `getLiveEvents()` trả `{ events, total, statusCounts }`; thêm `emitEvent()`, `emitBatch()` |
| `generator-ui/src/App.tsx` | `totalEvents` state riêng; `statusCounts` state từ DB; poll live data mỗi 3s |
| `generator-ui/src/components/EventLogTable.tsx` | Thêm prop `totalEvents`; header hiển thị `showing N of X` |
| `generator-ui/src/components/AutoEmit.tsx` | Dùng `emitEvent({})` → POST queue (không gọi `getEvent()`) |
| `generator-ui/src/components/BatchEmit.tsx` | Dùng `emitBatch(count)` → POST queue (không gọi `getEvents()`) |
| `infra/docker-compose.yml` | `api-generator` bỏ `depends_on: kafka`; bỏ `KAFKA_BROKER` env var |

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

**Lưu ý:** `producer-poller` là gateway duy nhất đẩy vào Kafka. Khi dừng (`docker stop producer-poller`), không có data mới nào vào pipeline dù Generator UI vẫn enqueue events.
