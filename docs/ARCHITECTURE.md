# 🏗️ KIẾN TRÚC REALTIME PIPELINE

Tài liệu giải thích chi tiết kiến trúc, luồng dữ liệu, và các thành phần trong pipeline.

---

## 📊 Tổng Quan Kiến Trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                    E-COMMERCE REALTIME PIPELINE                  │
└──────────────────────────────────────────────────────────────────┘

┌─────────────┐      ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Generator  │─────▶│    Kafka    │─────▶│    Spark    │─────▶│ PostgreSQL  │
│  (Python)   │ JSON │   Topic     │Stream│  Streaming  │ JDBC │  Database   │
│             │      │ events_raw  │      │   (Local)   │      │             │
└─────────────┘      └─────────────┘      └─────────────┘      └─────────────┘
      │                                           │                      │
      │ 5 events/sec                              │ UC03-UC06            │
      │ Order, Payment                            │ Validate, KPI        │ 2 tables
      │                                           │                      │
                                                                         ▼
                                                                  ┌──────────────┐
                                                                  │   Frontend   │
                                                                  │ React + Vite │
                                                                  │ (localhost)  │
                                                                  └──────────────┘
```

---

## 🔄 Luồng Dữ Liệu Chi Tiết

### 1️⃣ Event Generation

**Component**: `backend/generator.py`

```python
Event {
  id: UUID
  eventTime: ISO-8601 UTC
  eventType: order_created | payment_initiated | payment_success | payment_failed | order_cancelled
  orderId: ORD123456
  userId: USR1234
  amount: 1234567.89
  currency: VND | USD
  status: success | failed | pending
}
```

**Đặc điểm**:
- Weighted random distribution (70% success, 20% pending, 10% failed)
- Configurable rate (mặc định 5 events/sec)
- 1% invalid events để test validation
- Kafka producer với `acks=all` đảm bảo delivery

---

### 2️⃣ Kafka Topic

**Topic**: `events_raw`
- **Partitions**: 3 (có thể scale)
- **Replication Factor**: 1 (local setup)
- **Retention**: 24 hours
- **Format**: JSON string

**Kafka Configuration**:
```yaml
bootstrap.servers: localhost:9092
listener: PLAINTEXT
auto.create.topics: true
```

---

### 3️⃣ Spark Structured Streaming

**Component**: `backend/spark_stream.py`

#### UC03 - Parse & Validate

```python
Read Kafka → Parse JSON → Validate Schema
                     ↓
          id, eventTime, eventType, orderId != null
          amount >= 0
                     ↓
          Valid Events → Next stage
          Invalid Events → Logged (không persist)
```

**Schema Enforcement**:
```python
StructType([
  StructField('id', StringType(), nullable=False),
  StructField('eventTime', StringType(), nullable=False),
  StructField('eventType', StringType(), nullable=False),
  StructField('orderId', StringType(), nullable=False),
  StructField('userId', StringType(), nullable=False),
  StructField('amount', DoubleType(), nullable=False),
  StructField('currency', StringType(), nullable=False),
  StructField('status', StringType(), nullable=False),
])
```

#### UC04 - Clean & Deduplicate

```python
Valid Events
    ↓ to_timestamp(eventTime)
Event with timestamp
    ↓ current_timestamp()
Add ingest_time
    ↓ withWatermark('event_time', '5 minutes')
Late data handling
    ↓ dropDuplicates(['id'])
Deduplicated Events → events_clean
```

**Watermarking**:
- Events muộn hơn 5 phút sẽ bị drop
- Đảm bảo consistency trong window aggregation

#### UC05 - Calculate KPIs

```python
Clean Events
    ↓ window(event_time, '1 minute')
Windowed Stream
    ↓ groupBy + agg
KPI Calculations:
  - revenue = SUM(amount) WHERE event_type = 'payment_success'
  - orders_created = COUNT WHERE event_type = 'order_created'
  - payment_success = COUNT WHERE event_type = 'payment_success'
  - payment_failed = COUNT WHERE event_type = 'payment_failed'
  - success_rate = (payment_success / total_payments) * 100
    ↓
KPI Windows (1 minute) → kpi_1m
```

**Window Semantics**:
- **Window Size**: 1 minute
- **Sliding**: Non-overlapping (tumbling window)
- **Output Mode**: Update (cho aggregations)

#### UC06 - Persist to PostgreSQL

```python
2 Streaming Queries:

Query 1: events_clean
  - Output Mode: append
  - Checkpoint: ./checkpoints/spark_stream/events_clean
  - Trigger: default (as soon as possible)
  - Method: foreachBatch + JDBC

Query 2: kpi_1m
  - Output Mode: update
  - Checkpoint: ./checkpoints/spark_stream/kpi_1m
  - Trigger: default
  - Method: foreachBatch + JDBC
```

**Checkpoint**:
- Đảm bảo exactly-once semantics
- Recovery khi crash
- Offset management tự động

---

### 4️⃣ PostgreSQL Database

**Database**: `realtime` | User: `app` | Password: `app`

#### Table: events_clean
```sql
CREATE TABLE events_clean (
    id VARCHAR(50) PRIMARY KEY,
    event_time TIMESTAMP NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    order_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL,
    ingest_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_events_clean_event_time ON events_clean(event_time DESC);
CREATE INDEX idx_events_clean_event_type ON events_clean(event_type);
CREATE INDEX idx_events_clean_order_id ON events_clean(order_id);
```

**Purpose**: Store all cleaned events for audit, traceability

#### Table: kpi_1m
```sql
CREATE TABLE kpi_1m (
    window_start TIMESTAMP PRIMARY KEY,
    window_end TIMESTAMP NOT NULL,
    revenue DECIMAL(18, 2) NOT NULL DEFAULT 0,
    orders_created INTEGER NOT NULL DEFAULT 0,
    payment_success INTEGER NOT NULL DEFAULT 0,
    payment_failed INTEGER NOT NULL DEFAULT 0,
    success_rate DECIMAL(5, 2) DEFAULT 0,
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_kpi_1m_window_start ON kpi_1m(window_start DESC);
```

**Purpose**: Pre-aggregated KPIs for fast dashboard queries

#### Views: v_kpi_15m, v_kpi_1h, v_kpi_24h
```sql
CREATE VIEW v_kpi_15m AS
SELECT 
  SUM(revenue) as total_revenue,
  SUM(orders_created) as total_orders,
  ...
FROM kpi_1m
WHERE window_start >= NOW() - INTERVAL '15 minutes';
```

**Purpose**: Quick aggregation for different time ranges

---

### 5️⃣ Frontend Dashboard

**Stack**: React 18 + Vite + TypeScript + TailwindCSS

#### Architecture
```
src/
├── features/
│   ├── dashboard/      # Business KPI page
│   ├── events/         # Events table page
│   └── ops/            # Operations console
├── components/
│   ├── ui/             # Reusable UI components
│   └── layout/         # Layout components
└── lib/
    └── api.ts          # API client (MOCK/REAL mode)
```

#### API Layer
```typescript
// api.ts
export const api = {
  getKpi(timeRange): Promise<BusinessKPI>
  getTimeSeries(timeRange): Promise<TimeSeriesData[]>
  getEvents(params): Promise<EventsResponse>
  getSystemHealth(): Promise<SystemHealth>
}

// Modes
USE_MOCK = true   → Mock data generator
USE_MOCK = false  → Real API (PostgreSQL)
```

---

## ⚡ Performance Characteristics

### Throughput
- **Generator**: 5-10 events/sec (configurable)
- **Kafka**: Hàng nghìn events/sec (single broker)
- **Spark**: 100-500 events/sec (local mode, 4 cores)
- **PostgreSQL**: 500+ inserts/sec

### Latency (End-to-End)
```
Event Generated → Kafka → Spark → PostgreSQL → Dashboard
     0ms           ~10ms    ~1s      ~100ms      ~10s (polling)
                                                  
Total: ~1-2 seconds từ event tạo đến database
```

### Resource Usage
- **Docker (Kafka + Postgres)**: ~2GB RAM
- **Spark Local**: ~2-4GB RAM
- **Generator**: ~50MB RAM
- **Total**: ~5GB RAM recommended

---

## 🔒 Reliability & Fault Tolerance

### Exactly-Once Semantics
```
Kafka Producer (acks=all)
    ↓
Spark Checkpointing
    ↓
JDBC Transactional Write
    ↓
PostgreSQL ACID
```

### Failure Scenarios

#### 1. Generator Crash
- **Impact**: No new events
- **Recovery**: Restart generator, no data loss
- **Duration**: Immediate

#### 2. Kafka Broker Down
- **Impact**: Producer cannot send, Spark cannot read
- **Recovery**: Restart Kafka, replay from checkpoint
- **Duration**: 1-2 minutes

#### 3. Spark Job Crash
- **Impact**: No processing, events accumulate in Kafka
- **Recovery**: Restart Spark, resume from checkpoint
- **Duration**: 30 seconds - 1 minute
- **Data Loss**: None (exactly-once)

#### 4. PostgreSQL Down
- **Impact**: Spark cannot write, buffering in memory
- **Recovery**: Restart PostgreSQL, Spark retries
- **Duration**: 30 seconds
- **Data Loss**: None (checkpoint-based)

---

## 📈 Scalability

### Current Setup (Local)
- 1 Kafka broker
- 1 Spark local executor (4 cores)
- 1 PostgreSQL instance
- **Capacity**: ~10-50 events/sec

### Scale-Out Strategy

#### Phase 1: Vertical Scaling
- Tăng RAM cho Spark (4GB → 8GB)
- Tăng PostgreSQL connection pool
- **Capacity**: ~100 events/sec

#### Phase 2: Horizontal Scaling
- 3 Kafka brokers (replication factor 3)
- Spark cluster mode (3 executors)
- PostgreSQL read replicas
- **Capacity**: ~1000 events/sec

#### Phase 3: Cloud Native
- Kafka → AWS MSK / Confluent Cloud
- Spark → AWS EMR / Databricks
- PostgreSQL → AWS RDS / Aurora
- **Capacity**: ~10,000+ events/sec

---

## 🔐 Security Considerations

### Current (Development)
- ❌ No authentication
- ❌ PLAINTEXT connections
- ❌ Default passwords

### Production Requirements
- ✅ Kafka SASL/SSL
- ✅ PostgreSQL SSL + strong passwords
- ✅ Spark authentication
- ✅ API authentication (JWT)
- ✅ Network segmentation

---

## 📚 Technology Choices

| Component | Technology | Why? |
|-----------|-----------|------|
| **Message Queue** | Kafka | Industry standard, high throughput, replay capability |
| **Stream Processing** | Spark Structured Streaming | Unified batch/stream, SQL-like API, mature ecosystem |
| **Database** | PostgreSQL | ACID compliance, mature, great for analytics |
| **Language** | Python | Easy for students, rich libraries |
| **Frontend** | React + Vite | Fast dev experience, component-based |

---

## 🎓 Học Từ Kiến Trúc Này

### Data Engineering Concepts
1. **Lambda Architecture**: Batch + Stream processing
2. **Event Sourcing**: Immutable event log
3. **CQRS**: Command (events_clean) vs Query (kpi_1m)
4. **Windowing**: Tumbling windows cho aggregation
5. **Watermarking**: Late data handling

### Best Practices
1. **Idempotency**: Duplicate detection qua unique ID
2. **Checkpointing**: Fault tolerance
3. **Schema Evolution**: Structured data với validation
4. **Monitoring**: Logs, metrics, health checks
5. **Documentation**: Comprehensive docs cho maintainability

---

**📖 Xem thêm**:
- [BACKEND_SETUP.md](BACKEND_SETUP.md) - Setup guide
- [QUICKSTART.md](QUICKSTART.md) - Quick start
- [../README.md](../README.md) - Project overview
