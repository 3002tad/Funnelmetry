# Business Data Streaming & Processing Pipeline

> Tài liệu kỹ thuật đầy đủ — mô tả toàn bộ cấu trúc, luồng dữ liệu, API, schema và cách triển khai hệ thống.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Kiến trúc & Luồng dữ liệu](#2-kiến-trúc--luồng-dữ-liệu)
3. [Cấu trúc thư mục](#3-cấu-trúc-thư-mục)
4. [Services chi tiết](#4-services-chi-tiết)
   - [4.1 Generator API (Node.js)](#41-generator-api-nodejs---port-7070)
   - [4.2 Producer Poller (Python)](#42-producer-poller-python)
   - [4.3 Spark Streaming (PySpark)](#43-spark-streaming-pyspark)
   - [4.4 Dashboard API (Node.js)](#44-dashboard-api-nodejs---port-8080)
   - [4.5 Frontend Dashboard (React)](#45-frontend-dashboard-react---port-5173)
   - [4.6 Generator UI (React)](#46-generator-ui-react---port-5174)
5. [Hạ tầng](#5-hạ-tầng)
   - [5.1 Kafka](#51-kafka)
   - [5.2 PostgreSQL](#52-postgresql)
   - [5.3 Docker Compose](#53-docker-compose)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
   - [7.1 Generator API Endpoints](#71-generator-api-endpoints)
   - [7.2 Dashboard API Endpoints](#72-dashboard-api-endpoints)
8. [Event Schema](#8-event-schema)
9. [Frontend & UI](#9-frontend--ui)
10. [Triển khai](#10-triển-khai)
    - [10.1 Docker Compose](#101-docker-compose-local)
    - [10.2 K3s / Kubernetes (WSL)](#102-k3s--kubernetes-wsl)
11. [Biến môi trường](#11-biến-môi-trường)
12. [Các vấn đề đã giải quyết](#12-các-vấn-đề-đã-giải-quyết)

---

## 1. Tổng quan hệ thống

Hệ thống mô phỏng một pipeline xử lý dữ liệu thời gian thực cho sàn thương mại điện tử:

- **Tạo sự kiện**: UI cho phép người dùng tạo và gửi sự kiện đơn hàng/thanh toán vào hàng đợi
- **Thu thập**: Producer Python lấy từng batch từ hàng đợi và đẩy vào Kafka mỗi 20ms
- **Xử lý**: PySpark Structured Streaming đọc từ Kafka, validate, deduplicate và tính KPI theo cửa sổ 1 phút
- **Lưu trữ**: Kết quả ghi vào PostgreSQL (bảng `events_clean` và `kpi_1m`)
- **Hiển thị**: React Dashboard hiển thị KPI, biểu đồ thời gian thực, bảng sự kiện và trạng thái hệ thống

### Công nghệ sử dụng

| Layer | Công nghệ |
|---|---|
| Message Broker | Apache Kafka (Confluent 7.5.0) + ZooKeeper |
| Stream Processing | PySpark 3.5.0 (Structured Streaming) |
| Database | PostgreSQL 15-alpine |
| Backend API | Node.js + Express |
| Producer | Python 3.11 + kafka-python |
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Containerization | Docker Compose / K3s (Kubernetes on WSL2) |

---

## 2. Kiến trúc & Luồng dữ liệu

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACES                                  │
│                                                                            │
│   ┌─────────────────────┐          ┌──────────────────────────────────┐   │
│   │   Generator UI       │          │      Dashboard UI                 │   │
│   │   React (port 5174)  │          │      React (port 5173)           │   │
│   │   - Quick/Batch emit │          │      - KPI Cards                 │   │
│   │   - Auto emit loop   │          │      - Revenue/Orders charts     │   │
│   │   - Config editor    │          │      - Events table              │   │
│   │   - Event log        │          │      - System health             │   │
│   └──────────┬──────────┘          └───────────────┬──────────────────┘   │
└──────────────┼─────────────────────────────────────┼────────────────────┘
               │ POST /gen/emit                       │ GET /api/*
               │ POST /gen/emit-batch                 │ (every 5s)
               ▼                                      ▼
┌─────────────────────────┐          ┌──────────────────────────────────┐
│   Generator API          │          │       Dashboard API               │
│   Node.js (port 7070)    │          │       Node.js (port 8080)        │
│                           │          │                                   │
│   eventQueue[]            │          │   /api/kpi        (aggregated)   │
│   MAX_QUEUE = 10,000      │          │   /api/timeseries (chart data)   │
│   GET /gen/drain?limit=N  │          │   /api/events     (paginated)    │
│   ← returns batch of N    │          │   /api/health     (Kafka/PG/Sp)  │
└──────────┬──────────────┘          │   /api/metrics    (EPS, lag)     │
           │ GET /gen/drain           │   /api/alerts                    │
           │ every 20ms               │   /api/simulate   (fault inject) │
           ▼                          └───────────────┬──────────────────┘
┌─────────────────────────┐                          │ SELECT
│   Producer Poller        │                          │ FROM events_clean
│   Python 3.11            │                          │ FROM kpi_1m
│                           │                          ▼
│   POLL_INTERVAL = 20ms    │          ┌──────────────────────────────────┐
│   BATCH_LIMIT = 100       │          │         PostgreSQL 15             │
│   acks=1, linger=5ms      │          │                                   │
│   compression=gzip        │          │   events_clean (append)          │
└──────────┬──────────────┘          │   kpi_1m (upsert ON CONFLICT)    │
           │ produce                  │                                   │
           ▼                          │   Views: v_kpi_15m/1h/24h        │
┌─────────────────────────┐          └───────────────▲──────────────────┘
│   Kafka                  │                          │ JDBC write (UPSERT)
│   Confluent 7.5.0         │                          │
│   Topic: events_raw       │          ┌──────────────┴──────────────────┐
│   1 partition             │          │       Spark Streaming             │
│   retention: 24h          │          │       PySpark 3.5.0               │
└──────────┬──────────────┘          │                                   │
           │ readStream               │   UC03: parse_and_validate()     │
           └─────────────────────────►   UC04: clean_and_deduplicate()  │
                                      │   UC05: calculate_kpis()         │
                                      │   UC06: write_to_postgres()       │
                                      │                                   │
                                      │   Trigger: 2 seconds             │
                                      │   Watermark: 30 seconds           │
                                      │   Window: 1 minute tumbling       │
                                      └───────────────────────────────────┘
```

### Latency end-to-end (ước tính)

| Giai đoạn | Thời gian |
|---|---|
| UI → Generator API queue | < 10ms |
| Producer poll → Kafka | 20–50ms |
| Kafka → Spark micro-batch | 2–4s |
| Spark → PostgreSQL | 100–500ms |
| PostgreSQL → Dashboard API | < 50ms |
| **Tổng end-to-end** | **~3–5 giây** |

---

## 3. Cấu trúc thư mục

```
Business-Data-Streaming---Processing-Pipeline/
│
├── docs/                          # Tài liệu kỹ thuật
│   ├── INTRODUCTION.md
│   ├── ARCHITECTURE.md
│   ├── COMMANDS.md
│   └── UPDATE.md
│
├── infra/                         # Hạ tầng
│   ├── docker-compose.yml         # Docker Compose stack (9 services)
│   └── postgres/
│       └── init.sql               # DDL: events_clean, kpi_1m, views
│
├── services/                      # Backend services
│   ├── generator-api/             # Node.js event generator (port 7070)
│   │   ├── server.js
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── producer-poller/           # Python Kafka producer
│   │   ├── producer.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   ├── spark-streaming/           # PySpark structured streaming
│   │   ├── spark_stream.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   └── dashboard-api/             # Node.js REST API (port 8080)
│       ├── server.js
│       ├── package.json
│       └── Dockerfile
│
├── frontend/                      # React Dashboard UI (port 5173)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── features/
│   │   │   ├── dashboard/Dashboard.tsx  # KPI + charts
│   │   │   ├── events/Events.tsx        # Events table
│   │   │   └── ops/Ops.tsx              # System health + fault injection
│   │   ├── components/
│   │   │   ├── layout/Layout.tsx
│   │   │   └── ui/                      # KPICard, Card, Modal, ...
│   │   └── lib/api.ts                   # API client + types
│   ├── nginx.conf                 # Proxy /api/ → dashboard-api:8080
│   └── Dockerfile
│
└── generator-ui/                  # React Generator UI (port 5174)
    ├── src/
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── QuickEmit.tsx            # Single event emit
    │   │   ├── BatchEmit.tsx            # Batch emit
    │   │   ├── AutoEmit.tsx             # Auto loop emit
    │   │   ├── DistributionEditor.tsx   # Event type weights
    │   │   ├── EventLogTable.tsx        # Live event log
    │   │   └── ConnectionStatus.tsx     # API health indicator
    │   ├── services/generatorApi.ts     # API client (relative URLs)
    │   └── types/index.ts
    ├── nginx.conf                 # Proxy /api-generator/ + /dashboard-api/
    └── Dockerfile
```

---

## 4. Services chi tiết

### 4.1 Generator API (Node.js) — port 7070

**File:** `services/generator-api/server.js`

Service tạo sự kiện thương mại điện tử ngẫu nhiên và quản lý một hàng đợi in-memory. Producer Poller sẽ drain hàng đợi này để đẩy vào Kafka.

#### Phân phối sự kiện (mặc định)

| Event Type | Tỷ lệ | Amount | Status |
|---|---|---|---|
| `order_created` | 30% | 50k – 3M VND | `pending` |
| `payment_initiated` | 25% | 50k – 3M VND | `pending` |
| `payment_success` | 35% | 50k – 5M VND | `success` |
| `payment_failed` | 8% | 0 VND | `failed` |
| `order_cancelled` | 2% | 0 VND | `failed` |

#### Direct Kafka + Legacy Fallback Queue

```
POST /gen/emit, POST /gen/emit-batch
                   ← publish trực tiếp vào Kafka (primary path)

eventQueue[]       ← chỉ dùng khi Kafka unavailable và ENABLE_QUEUE_FALLBACK=true
                   ← đọc bởi: GET /gen/drain?limit=N  (producer-poller legacy fallback)
MAX_QUEUE_SIZE = 10,000
```

#### Dependencies

```json
"express": "^4.18.2",
"uuid": "^9.0.1",
"cors": "^2.8.5",
"dotenv": "^16.3.1"
```

---

### 4.2 Producer Poller (Python, Legacy Fallback)

**File:** `services/producer-poller/producer.py`

Worker fallback tùy chọn: gọi `/gen/drain?limit=100` mỗi 20ms, nhận batch sự kiện từ queue legacy và đẩy từng sự kiện vào Kafka topic `events_raw`.

**Mặc định deployment hiện tại:** service này không chạy; `generator-api` publish trực tiếp vào Kafka.

#### Cấu hình Kafka Producer

```python
KafkaProducer(
    bootstrap_servers = KAFKA_BOOTSTRAP_SERVERS,
    acks              = 1,          # Leader ack only (1 broker)
    retries           = 3,
    linger_ms         = 5,          # Micro-batch tối đa 5ms
    compression_type  = 'gzip',     # Nén payload
    value_serializer  = lambda v: json.dumps(v).encode('utf-8'),
    key_serializer    = lambda k: k.encode('utf-8'),
)
```

Message key = `orderId` → đảm bảo các sự kiện của cùng đơn hàng vào cùng partition.

#### Vòng lặp chính

```
while True:
    events = GET /gen/drain?limit=100
    if 204 → sleep 20ms (queue empty)
    else   → for event in events: produce_to_kafka(event)
    sleep remaining time to maintain 20ms interval
```

#### Dependencies (requirements.txt)

```
kafka-python==2.0.2
requests==2.31.0
pyspark==3.5.0
psycopg2-binary==2.9.9
```

---

### 4.3 Spark Streaming (PySpark)

**File:** `services/spark-streaming/spark_stream.py`

PySpark Structured Streaming job xử lý sự kiện từ Kafka theo pipeline UC03→UC04→UC05→UC06.

#### Spark Session Config

```python
SparkSession.builder
  .appName('EcommerceRealtimePipeline')
  .master('local[*]')
  .config('spark.sql.shuffle.partitions', 4)
  .config('spark.jars.packages',
          'org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,'
          'org.postgresql:postgresql:42.6.0')
```

#### Startup Guard — `ensure_kafka_topic()`

Trước khi gọi `readStream`, hàm này:
1. Kết nối KafkaAdminClient với timeout 180 giây
2. Nếu topic đã tồn tại → tiếp tục
3. Nếu chưa → tạo topic với 1 partition, replication_factor=1
4. Retry mỗi 3 giây

Mục đích: tránh `UnknownTopicOrPartitionException` khi Spark khởi động trước Kafka.

#### Pipeline xử lý

**UC03 — Parse & Validate**

```python
def parse_and_validate(df):
    # Parse JSON từ Kafka value
    # Validate: id, eventTime, eventType, orderId != null AND amount >= 0
    # Trả về chỉ các event hợp lệ (is_valid == True)
```

**UC04 — Clean & Deduplicate**

```python
def clean_and_deduplicate(df):
    # Convert eventTime string → timestamp
    # Thêm ingest_time = current_timestamp()
    # withWatermark('event_time', '30 seconds')  ← xử lý late data
    # dropDuplicates(['id'])
    # Rename: eventType→event_type, orderId→order_id, userId→user_id
```

**UC05 — Calculate KPIs**

```python
def calculate_kpis(df):
    # groupBy(window(event_time, '1 minute'))
    # revenue = SUM(amount) WHERE event_type='payment_success'
    # orders_created, payment_initiated, payment_success, payment_failed, order_cancelled
    # success_rate = payment_success / (payment_success + payment_failed) * 100
```

**UC06 — Persist to PostgreSQL**

Hai streaming queries chạy song song:

| Query | Bảng | Mode | Trigger |
|---|---|---|---|
| `events_query` | `events_clean` | append | 2 seconds |
| `kpi_query` | `kpi_1m` | update (upsert) | 2 seconds |

KPI upsert dùng `ON CONFLICT (window_start) DO UPDATE SET ...` vì Spark có thể re-emit cùng cửa sổ khi cập nhật.

#### Checkpoint paths

```
/app/checkpoints/spark_stream/events_clean
/app/checkpoints/spark_stream/kpi_1m
```

#### Environment variables

| Biến | Mặc định | Mô tả |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | |
| `KAFKA_TOPIC` | `events_raw` | |
| `CHECKPOINT_DIR` | `/app/checkpoints/spark_stream` | |
| `POSTGRES_HOST` | `postgres` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | `realtime` | |
| `POSTGRES_USER` | `app` | |
| `POSTGRES_PASSWORD` | `app` | |
| `KAFKA_TOPIC_WAIT_TIMEOUT_SEC` | `180` | Timeout chờ Kafka sẵn sàng |
| `KAFKA_TOPIC_WAIT_INTERVAL_SEC` | `3` | Interval retry |

---

### 4.4 Dashboard API (Node.js) — port 8080

**File:** `services/dashboard-api/server.js`

REST API phục vụ dữ liệu từ PostgreSQL cho React Dashboard. Cũng kiểm tra trạng thái Kafka bằng KafkaJS admin client.

#### EMA Smoothing

Metric `processedEventsPerSec` được làm mượt bằng Exponential Moving Average:

```
α = 0.35
S_t = α × X_t + (1 - α) × S_{t-1}
```

`X_t` = số events trong `events_clean` trong 10 giây gần nhất / 10

#### Spark Health Check

Dashboard API tự kiểm tra Spark bằng cách query PostgreSQL:

```sql
SELECT COUNT(*) FROM kpi_1m WHERE processed_at >= NOW() - INTERVAL '5 minutes'
```

- `count > 0` → Spark healthy
- `count = 0` nhưng có data → Spark degraded (no recent write)
- Không có data nào → Spark degraded (waiting for first batch)

#### In-memory Alert Store

Lưu tối đa 50 alerts. Hỗ trợ `POST /api/simulate` để inject lỗi giả:
- `kafka_down` — giả lập Kafka không kết nối được
- `spark_crash` — giả lập Spark bị crash
- `reset` — khôi phục trạng thái bình thường

#### Dependencies

```json
"express": "^4.18.2",
"cors": "^2.8.5",
"pg": "^8.11.3",
"kafkajs": "^2.2.4"
```

---

### 4.5 Frontend Dashboard (React) — port 5173

**File:** `frontend/src/`

React 18 + TypeScript + Vite + TailwindCSS + Recharts + React Query.

#### Trang Dashboard (`features/dashboard/Dashboard.tsx`)

- 4 KPI Cards: Revenue, Total Events, Payment Success, Success Rate
- LineChart: Revenue theo thời gian (Recharts)
- BarChart: Success vs Failed orders
- Bộ lọc thời gian: 15m / 1h / 24h
- Auto-refresh mỗi 5 giây (React Query `refetchInterval`)

#### Trang Events (`features/events/Events.tsx`)

- Bảng sự kiện phân trang (20/50/100 per page)
- Lọc theo `eventType` và `status`
- Hiển thị: id, eventTime, eventType, orderId, userId, amount, currency, status

#### Trang Ops (`features/ops/Ops.tsx`)

- Status badges: Kafka / Spark / PostgreSQL (healthy / degraded / down)
- Metrics: processedEventsPerSec, kafkaLag
- Alert feed
- Fault injection buttons: Kafka Down, Spark Crash, Reset

#### Nginx proxy (frontend)

```nginx
# /api/* → dashboard-api:8080
location /api/ {
    proxy_pass http://dashboard-api:8080;
}
```

#### Mock mode

```typescript
// frontend/src/lib/api.ts
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
```

Build production (`VITE_USE_MOCK=false`) → dùng real API.

---

### 4.6 Generator UI (React) — port 5174

**File:** `generator-ui/src/`

React + TypeScript + Vite + TailwindCSS. Giao diện để tạo và gửi sự kiện vào pipeline.

#### Components

| Component | Chức năng |
|---|---|
| `QuickEmit.tsx` | Tạo 1 sự kiện tuỳ chỉnh (chọn eventType, amount...) |
| `BatchEmit.tsx` | Tạo batch N sự kiện ngẫu nhiên |
| `AutoEmit.tsx` | Tự động emit sự kiện với tần suất cài sẵn |
| `DistributionEditor.tsx` | Chỉnh tỷ lệ phân phối các event type |
| `EventLogTable.tsx` | Bảng log sự kiện real-time từ PostgreSQL |
| `ConnectionStatus.tsx` | Badge trạng thái kết nối API |

#### Nginx proxy (generator-ui)

```nginx
# /api-generator/* → api-generator:7070
location /api-generator/ {
    proxy_pass http://api-generator:7070/;
}

# /dashboard-api/* → dashboard-api:8080
location /dashboard-api/ {
    proxy_pass http://dashboard-api:8080/;
}
```

API client dùng relative URL:

```typescript
const API_BASE_URL   = "/api-generator";
const DASHBOARD_API_URL = "/dashboard-api";
```

---

## 5. Hạ tầng

### 5.1 Kafka

| Thuộc tính | Giá trị |
|---|---|
| Image | `confluentinc/cp-kafka:7.5.0` |
| Broker ID | 1 |
| Listener | `PLAINTEXT://kafka:9092` |
| Topic | `events_raw` |
| Partitions | 1 |
| Replication Factor | 1 |
| Log Retention | 24 giờ |
| Auto Create Topics | enabled |

ZooKeeper: `confluentinc/cp-zookeeper:7.5.0` — port 2181

**Lưu ý K3s:** Kafka Deployment cần `enableServiceLinks: false` để tránh xung đột biến môi trường `KAFKA_*` được Kubernetes inject tự động.

### 5.2 PostgreSQL

| Thuộc tính | Giá trị |
|---|---|
| Image | `postgres:15-alpine` |
| Database | `realtime` |
| User | `app` |
| Password | `app` |
| Port | 5432 |
| Init SQL | `infra/postgres/init.sql` |

### 5.3 Docker Compose

**File:** `infra/docker-compose.yml`

| Service | Image/Build | Port | Depends On |
|---|---|---|---|
| `zookeeper` | confluentinc/cp-zookeeper:7.5.0 | 2181 | — |
| `kafka` | confluentinc/cp-kafka:7.5.0 | 9092 | zookeeper |
| `postgres` | postgres:15-alpine | 5432 | — |
| `api-generator` | build: services/generator-api | 7070 | — |
| `producer` | build: services/producer-poller | — | api-generator, kafka |
| `spark-streaming` | build: services/spark-streaming | — | kafka, postgres |
| `dashboard-api` | build: services/dashboard-api | 8080 | postgres, kafka |
| `generator-ui` | build: generator-ui | 5174 | api-generator |
| `frontend` | build: frontend | 5173 | dashboard-api |

Tất cả trong network `realtime-network` (bridge).

---

## 6. Database Schema

### Bảng `events_clean`

```sql
CREATE TABLE events_clean (
    id          VARCHAR(50)    PRIMARY KEY,
    event_time  TIMESTAMP      NOT NULL,
    event_type  VARCHAR(50)    NOT NULL,  -- CHECK IN (5 loại)
    order_id    VARCHAR(50)    NOT NULL,
    user_id     VARCHAR(50)    NOT NULL,
    amount      DECIMAL(15,2)  NOT NULL,  -- CHECK >= 0
    currency    VARCHAR(10)    NOT NULL,
    status      VARCHAR(20)    NOT NULL,  -- CHECK IN (success, failed, pending)
    ingest_time TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_events_clean_event_time ON events_clean(event_time DESC);
CREATE INDEX idx_events_clean_event_type ON events_clean(event_type);
CREATE INDEX idx_events_clean_order_id   ON events_clean(order_id);
```

Ghi bởi: Spark `events_query` (append mode, 2s trigger).

### Bảng `kpi_1m`

```sql
CREATE TABLE kpi_1m (
    window_start       TIMESTAMP PRIMARY KEY,  -- 1-minute tumbling window
    window_end         TIMESTAMP NOT NULL,
    revenue            DECIMAL(18,2)  NOT NULL DEFAULT 0,
    orders_created     INTEGER        NOT NULL DEFAULT 0,
    payment_initiated  INTEGER        NOT NULL DEFAULT 0,
    payment_success    INTEGER        NOT NULL DEFAULT 0,
    payment_failed     INTEGER        NOT NULL DEFAULT 0,
    order_cancelled    INTEGER        NOT NULL DEFAULT 0,
    success_rate       DECIMAL(5,2)   DEFAULT 0,  -- CHECK BETWEEN 0 AND 100
    processed_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_kpi_1m_window_start ON kpi_1m(window_start DESC);
```

Ghi bởi: Spark `kpi_query` (upsert `ON CONFLICT (window_start) DO UPDATE`, 2s trigger).

### Views

| View | Mô tả |
|---|---|
| `v_kpi_15m` | Tổng hợp KPI 15 phút gần nhất |
| `v_kpi_1h` | Tổng hợp KPI 1 giờ gần nhất |
| `v_kpi_24h` | Tổng hợp KPI 24 giờ gần nhất |

---

## 7. API Reference

### 7.1 Generator API Endpoints

**Base URL:** `http://localhost:7070` (Docker) hoặc `http://<WSL_IP>:30070` (K3s)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus-style metrics |
| `GET` | `/gen/event` | Lấy 1 event từ queue fallback legacy (204 nếu trống) |
| `GET` | `/gen/drain?limit=N` | Drain N events từ queue fallback legacy (204 nếu trống) |
| `GET` | `/gen/events?count=N` | Preview N events ngẫu nhiên (không ảnh hưởng queue) |
| `GET` | `/gen/queue` | Trạng thái queue fallback hiện tại |
| `GET` | `/gen/config` | Xem cấu hình hiện tại |
| `POST` | `/gen/config` | Cập nhật distribution/defaultCount/ratePerSec |
| `POST` | `/gen/emit` | Tạo 1 event tuỳ chỉnh → publish Kafka trực tiếp; fallback queue nếu được bật |
| `POST` | `/gen/emit-batch` | Tạo N events ngẫu nhiên → publish Kafka trực tiếp; fallback queue nếu được bật |

#### `GET /gen/drain?limit=N`

```json
// Response 200
{
  "count": 50,
  "queueSize": 120,
  "events": [ ...array of event objects... ]
}

// Response 204 (No Content) — queue trống
```

#### `POST /gen/emit`

```json
// Request body
{
  "eventType": "payment_success",
  "amount": 1500000,
  "orderId": "ORD-CUSTOM-001",
  "userId": "USR9999",
  "lateMinutes": 0
}

// Response
{
  "id": "uuid-v4",
  "eventTime": "2026-03-17T10:30:00.000Z",
  "eventType": "payment_success",
  "orderId": "ORD-CUSTOM-001",
  "userId": "USR9999",
  "amount": 1500000,
  "currency": "VND",
  "status": "success",
  "metadata": { "device": "mobile", "ip": "...", "sessionId": "..." },
  "_path": "kafka",
  "fallbackEnabled": false,
  "queueSize": 0
}
```

#### `POST /gen/config`

```json
// Request
{
  "distribution": {
    "order_created": 20,
    "payment_initiated": 20,
    "payment_success": 50,
    "payment_failed": 8,
    "order_cancelled": 2
  },
  "defaultCount": 20
}
```

---

### 7.2 Dashboard API Endpoints

**Base URL:** `http://localhost:8080` (Docker) hoặc `http://<WSL_IP>:30080` (K3s)

#### `GET /api/kpi?timeRange=15m|1h|24h`

```json
{
  "revenue": 125000000.00,
  "totalEvents": 4820,
  "paymentSuccess": 1687,
  "pending": 2650,
  "totalFailed": 483,
  "successRate": 77.76
}
```

#### `GET /api/timeseries?timeRange=15m|1h|24h`

```json
[
  {
    "timestamp": "2026-03-17T10:00:00.000Z",
    "revenue": 5200000.00,
    "ordersCreated": 45,
    "paymentSuccess": 38,
    "paymentFailed": 7
  }
]
```

**Lưu ý:**
- `24h` → bucket vào cửa sổ 30 phút (~48 điểm)
- `1h` / `15m` → trả về 1-minute rows trực tiếp

#### `GET /api/events?page=1&pageSize=20&eventType=...&status=...`

```json
{
  "events": [...],
  "total": 12483,
  "page": 1,
  "pageSize": 20,
  "statusCounts": {
    "success": 4362,
    "pending": 6741,
    "failed": 1380
  }
}
```

`statusCounts` lấy từ `kpi_1m` (không phải `events_clean`) để đảm bảo nhất quán.

#### `GET /api/health`

```json
{
  "kafka":    { "status": "healthy",  "message": "All brokers operational" },
  "spark":    { "status": "healthy",  "message": "Streaming jobs running" },
  "postgres": { "status": "healthy",  "message": "Database responsive" }
}
```

`status` có thể là: `healthy` | `degraded` | `down`

#### `GET /api/metrics`

```json
{
  "kafkaLag": 12,
  "processedEventsPerSec": 34.7,
  "timestamp": "2026-03-17T10:30:05.123Z"
}
```

#### `POST /api/simulate`

```json
// Request
{ "type": "kafka_down" }   // hoặc "spark_crash" | "reset"

// Response: trạng thái health mới
```

---

## 8. Event Schema

Mỗi sự kiện sinh ra bởi Generator API có cấu trúc:

```typescript
interface Event {
  id:        string;    // UUID v4
  eventTime: string;    // ISO 8601, e.g. "2026-03-17T10:30:00.000000Z"
  eventType: "order_created"
           | "payment_initiated"
           | "payment_success"
           | "payment_failed"
           | "order_cancelled";
  orderId:   string;    // "ORD-{timestamp}-{random6}"
  userId:    string;    // "USR{0-9999}"
  amount:    number;    // VND, 0 với failed/cancelled
  currency:  "VND";
  status:    "pending" | "success" | "failed";
  metadata: {
    device:    "mobile" | "desktop" | "tablet";
    ip:        string;  // random IPv4
    sessionId: string;  // "sess_{timestamp}_{random9}"
  };
}
```

### Quy tắc amount

| eventType | amount |
|---|---|
| `payment_success` | 50,000 – 5,000,000 VND |
| `payment_initiated` | 50,000 – 3,000,000 VND |
| `order_created` | 50,000 – 3,000,000 VND |
| `payment_failed` | 0 VND |
| `order_cancelled` | 0 VND |

### Quy tắc status

| eventType | status |
|---|---|
| `order_created`, `payment_initiated` | `pending` |
| `payment_success` | `success` |
| `payment_failed`, `order_cancelled` | `failed` |

---

## 9. Frontend & UI

### Stack chung

```
React 18 + TypeScript + Vite + TailwindCSS + React Query + Recharts
```

### API types (frontend/src/lib/api.ts)

```typescript
type TimeRange     = '15m' | '1h' | '24h';
type EventType     = 'order_created' | 'payment_initiated' | 'payment_success'
                   | 'payment_failed' | 'order_cancelled';
type EventStatus   = 'success' | 'failed' | 'pending';
type ServiceStatus = 'healthy' | 'degraded' | 'down';
type AlertSeverity = 'critical' | 'warning' | 'info';
```

### Chế độ Mock

Khi `VITE_USE_MOCK=true` (dev), frontend dùng `MockDataGenerator` class sinh data ngẫu nhiên mà không cần backend.

Build production (`VITE_USE_MOCK=false`) → gọi real API qua nginx proxy.

---

## 10. Triển khai

### 10.1 Docker Compose (local)

```bash
cd infra
docker compose up -d --build
```

Các URL sau khi khởi động:

| Service | URL |
|---|---|
| Generator UI | http://localhost:5174 |
| Dashboard UI | http://localhost:5173 |
| Generator API | http://localhost:7070 |
| Dashboard API | http://localhost:8080 |
| PostgreSQL | localhost:5432 |
| Kafka | localhost:9092 |

```bash
# Xem logs
docker compose logs -f spark-streaming
docker compose logs -f producer-poller

# Kiểm tra data
docker exec -it postgres psql -U app -d realtime -c "SELECT COUNT(*) FROM events_clean;"
docker exec -it postgres psql -U app -d realtime -c "SELECT * FROM kpi_1m ORDER BY window_start DESC LIMIT 5;"

# Restart 1 service
docker compose restart spark-streaming

# Xoá toàn bộ (kể cả volumes)
docker compose down -v
```

---

### 10.2 K3s / Kubernetes (WSL)

**Manifest:** `k8s/k3s-stack.yaml`

#### Cấu trúc K3s

| Resource | Chi tiết |
|---|---|
| Namespace | `realtime` |
| Secret | `app-secrets` (POSTGRES_DB/USER/PASSWORD) |
| ConfigMap | `postgres-init-sql` (DDL), `frontend-nginx-conf` |
| PVCs | postgres-data (5Gi), kafka-data (5Gi), zookeeper-data (2Gi), spark-checkpoints (5Gi) |

#### NodePort Services

| Service | NodePort | Truy cập |
|---|---|---|
| api-generator | 30070 | `http://<WSL_IP>:30070` |
| dashboard-api | 30080 | `http://<WSL_IP>:30080` |
| frontend | 30173 | `http://<WSL_IP>:30173` |
| generator-ui | 30174 | `http://<WSL_IP>:30174` |

#### ClusterIP Services (nội bộ)

| Service | Port |
|---|---|
| zookeeper | 2181 |
| kafka | 9092 |
| postgres | 5432 |

#### Lấy WSL IP

```powershell
# Từ PowerShell Windows
wsl.exe -e sh -lc "hostname -I" | ForEach-Object { $_.Trim().Split(' ')[0] }
```

#### Lệnh K3s (phải dùng `wsl.exe -e sh -lc "sudo k3s kubectl ..."`)

```bash
# Deploy / update
wsl.exe -e sh -lc "sudo k3s kubectl apply -f /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/k8s/k3s-stack.yaml"

# Kiểm tra pods
wsl.exe -e sh -lc "sudo k3s kubectl get pods -n realtime"

# Logs
wsl.exe -e sh -lc "sudo k3s kubectl logs -n realtime deployment/spark-streaming -f"
wsl.exe -e sh -lc "sudo k3s kubectl logs -n realtime deployment/producer-poller -f"

# Restart
wsl.exe -e sh -lc "sudo k3s kubectl rollout restart deployment/spark-streaming -n realtime"

# Exec vào pod
wsl.exe -e sh -lc "sudo k3s kubectl exec -n realtime -it deployment/postgres -- psql -U app -d realtime"

# Xoá toàn bộ
wsl.exe -e sh -lc "sudo k3s kubectl delete namespace realtime"
```

#### Rebuild image cho K3s

```bash
# Bước 1: Build image trên Windows host (Docker Desktop)
docker build -t spark-streaming:latest services/spark-streaming/

# Bước 2: Export thành tar
docker save spark-streaming:latest | wsl.exe -e sh -lc "sudo k3s ctr images import -"

# Bước 3: Restart pod để pick up image mới
wsl.exe -e sh -lc "sudo k3s kubectl rollout restart deployment/spark-streaming -n realtime"
```

---

## 11. Biến môi trường

### Generator API

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PORT` | `7070` | Port HTTP server |
| `NODE_ENV` | `production` | Node environment |
| `DEFAULT_BATCH_COUNT` | `10` | Số event mặc định cho batch |

### Producer Poller

| Biến | Mặc định | Mô tả |
|---|---|---|
| `API_DRAIN_URL` | `http://localhost:7070/gen/drain` | URL endpoint drain |
| `API_TIMEOUT` | `5` | Timeout HTTP (giây) |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | |
| `KAFKA_TOPIC` | `events_raw` | |
| `POLL_INTERVAL_MS` | `20` | Tần suất polling |
| `POLL_BATCH_LIMIT` | `100` | Max events per poll |
| `MAX_RETRIES` | `3` | |
| `RETRY_DELAY_SEC` | `2` | |

### Spark Streaming

| Biến | Mặc định | Mô tả |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | |
| `KAFKA_TOPIC` | `events_raw` | |
| `CHECKPOINT_DIR` | `/app/checkpoints/spark_stream` | |
| `POSTGRES_HOST` | `postgres` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | `realtime` | |
| `POSTGRES_USER` | `app` | |
| `POSTGRES_PASSWORD` | `app` | |
| `KAFKA_TOPIC_WAIT_TIMEOUT_SEC` | `180` | |
| `KAFKA_TOPIC_WAIT_INTERVAL_SEC` | `3` | |

### Dashboard API

| Biến | Mặc định | Mô tả |
|---|---|---|
| `PORT` | `8080` | |
| `POSTGRES_HOST` | `postgres` | |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | `realtime` | |
| `POSTGRES_USER` | `app` | |
| `POSTGRES_PASSWORD` | `app` | |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | |

---

## 12. Các vấn đề đã giải quyết

| Vấn đề | Nguyên nhân | Giải pháp |
|---|---|---|
| CRLF warnings khi `git add` | `.gitattributes` dùng `text=auto` không có `eol=lf` | Thêm `eol=lf`, chạy `git add --renormalize .` |
| Generator UI hiển thị "API Offline" trên K3s | Client hardcode `localhost:7070` | Đổi sang relative URL + nginx proxy block |
| Kafka CrashLoopBackOff trên K3s | Kubernetes inject `KAFKA_*` env vars tự động → xung đột với Confluent | `enableServiceLinks: false` trên Kafka Deployment |
| Spark crash ngay khi khởi động | `readStream` gọi trước khi topic tồn tại → `UnknownTopicOrPartitionException` | `ensure_kafka_topic()` guard trước `readStream` |
| NodePort không truy cập được qua localhost trên WSL2 | WSL2 có network isolation riêng | Dùng `hostname -I` để lấy WSL IP, không dùng localhost |
| KPI upsert lỗi duplicate key | Spark re-emit cửa sổ khi cập nhật (normal behaviour) | `ON CONFLICT (window_start) DO UPDATE SET ...` |
| `processedEventsPerSec` jitter nhiều | Micro-batch 2s tạo spike/dip rõ rệt | EMA smoothing với α=0.35 trên 10s window |
| `statusCounts` không khớp total | Lấy từ `events_clean` và `kpi_1m` khác nhau do timing | Đồng nhất: `statusCounts` lấy từ `kpi_1m` |

---

*Tài liệu này được tạo ngày 17/03/2026 và phản ánh trạng thái hiện tại của toàn bộ codebase.*
