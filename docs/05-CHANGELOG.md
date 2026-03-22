# 📜 Changelog

## Optimization Update (2026-03-22)

### Performance Enhancements

- Database connection pool: `10 → 20` connections (dashboard-api)
- Kafka producer: Added batching, compression, `maxInFlightRequests`
- Spark shuffle partitions: `6 → 12` for better parallelism
- JDBC batch size: `1000 → 10000` rows per batch
- Cache TTL optimization: Tuned for each endpoint

**Expected impact:** +15-25% throughput, -10-15% latency

---

## Optimization Update (2026-03-17)

### Kiến trúc mới ưu tiên hiệu năng

Luồng ingest đã được tối ưu:

`Generator UI/API → Kafka (direct)` → `Spark Structured Streaming` → `PostgreSQL` → `Dashboard API/UI`

`producer-poller` được giữ lại như **fallback path** khi Kafka không kết nối được.

### Các thay đổi chính

- `generator-api` publish trực tiếp vào Kafka bằng `kafkajs`
- `dashboard-api`: TTL cache cho `/api/kpi`, `/api/timeseries`, `/api/health`, `/api/metrics`
- `spark-streaming`: Topic partitions `3`, `maxOffsetsPerTrigger=5000`, optimized parallelism
- PostgreSQL: Thêm index `ingest_time`, `status`
- Frontend: Giảm refetch dư thừa bằng `staleTime` + `refetchOnWindowFocus: false`
- K3s manifest: Thêm `resources.requests/limits`, health probes

### Config cần chú ý

- `api-generator`:
  - `KAFKA_BOOTSTRAP_SERVERS=kafka:9092`
  - `KAFKA_TOPIC=events_raw`
- `spark-streaming`:
  - `KAFKA_NUM_PARTITIONS=3`
  - `KAFKA_MAX_OFFSETS_PER_TRIGGER=5000`

### Migration notes

- Topic `events_raw` mới được tạo với `3 partitions`
- Nếu topic cũ có `1 partition`, cần tăng thủ công
- `producer-poller` có thể scale về `0` sau khi xác nhận direct Kafka path ổn định

### Metrics Endpoints

- `http://localhost:7070/metrics` — Generator API
- `http://localhost:8080/metrics` — Dashboard API

---

## Previous Updates

### Bug Fixes & Pipeline Optimization (Earlier)

#### 1. Fix dashboard-api build
- `npm ci` → `npm install --omit=dev`

#### 2. Fix frontend healthcheck
- `localhost` → `127.0.0.1` (IPv4 fix)

#### 3. Fix Spark Structured Streaming
- **Issue**: Duplicate key on `kpi_1m` when Spark re-emits updated windows
- **Fix**: `psycopg2` upsert with `ON CONFLICT DO UPDATE`
- **Result**: Pipeline no longer crashes on duplicate keys

#### 4. Fix Generator UI event log
- Now polls `dashboard-api /api/events` every 3s
- Displays live data from PostgreSQL instead of local state

#### 5. Fix total events count
- Was capped at page size (50)
- Now shows actual `COUNT(*)` from database

#### 6. Fix success rate
- Was: `payment_success / orders_created` (could exceed 100%)
- Now: `payment_success / (payment_success + payment_failed)` (0-100%)

#### 7. Fix nginx 502 Bad Gateway
- Added DNS resolver with 5s TTL
- Frontend now re-resolves `dashboard-api` hostname dynamically

#### 8. Kafka topic auto-create
- Removed `kafka-init` service
- Spark uses `kafka.allow.auto.create.topics=true`

#### 9. KPI schema extended
- Added `order_cancelled` and `payment_initiated` columns
- Proper event type aggregation

#### 10. Latency optimization
- Producer poll: `500ms → 100ms`
- Spark watermark: `5 minutes → 30 seconds`
- Spark trigger: `5 seconds`
- Dashboard refetch: `10s → 5s`
- **Result**: End-to-end latency reduced from ~60-90s to ~10-15s

---

## System Status Summary

| Metric | Before | After |
|--------|--------|-------|
| Container health | Some unhealthy | All healthy ✅ |
| Dashboard data | Mock data | Live from PostgreSQL ✅ |
| Pipeline latency | 60-90s | 10-15s ✅ |
| Spark duplicate errors | Job crash | Upsert safe ✅ |
| Total events tracking | Capped at 50 | Real DB count ✅ |
| Success rate | Could exceed 100% | Always 0-100% ✅ |
| End-to-end latency | ~60-90 seconds | ~10-15 seconds ✅ |

---

## Files Consolidated

All markdown documentation has been organized into `/docs/`:

- `00-INTRODUCTION.md` — Project overview
- `01-ARCHITECTURE.md` — Detailed system design
- `02-COMMANDS.md` — CLI commands & deployment
- `03-API-REFERENCE.md` — API endpoints
- `04-DEPLOYMENT.md` — Kubernetes guide
- `05-CHANGELOG.md` — This file

Root-level README now serves as quick-start guide.

---

**Last updated:** 2026-03-22  
**Current version:** Realtime Pipeline v1.0 (Optimized)
