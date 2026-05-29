# streaming-processor

Kafka `tracking_events_raw` → parse → validate → clean → Postgres (`tracking_events_clean` + KPI).

## Pipeline modules (`lib/`)

| Module | Vai trò |
|--------|---------|
| `parser.py` | JSON bytes → dict |
| `validator.py` | Kiểm tra required fields |
| `cleaner.py` | Normalize timestamp, strip whitespace |
| `aggregator.py` | Tumbling window 1 phút → KPI counters |
| `sink_postgres.py` | Upsert events + KPI tables (idempotent) |
| `insight_generator.py` | Detect anomalies → upsert text insights to Qdrant |
| `qdrant_client.py` | REST client for `pipeline_insights` collection |
| `embed.py` | Deterministic 384-d vectors (shared with dashboard-api) |

## Env

| Var | Default |
|-----|---------|
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` |
| `KAFKA_TOPIC_RAW` | `tracking_events_raw` |
| `KAFKA_GROUP_ID` | `streaming-processor` |
| `FLUSH_INTERVAL_SEC` | `10` (demo; tăng nếu muốn giảm tải DB) |
| `POSTGRES_*` | xem `infra/.env` |
| `QDRANT_URL` | `http://qdrant:6333` |
| `QDRANT_COLLECTION` | `pipeline_insights` |
