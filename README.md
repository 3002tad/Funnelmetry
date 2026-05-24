# Business Data Streaming — Processing Pipeline

Realtime e-commerce **behavior tracking** demo: SDK → Tracking API → Kafka → (streaming) → PostgreSQL.

## Phase 1–2 (current)

- Postgres schema: `infra/postgres/001_tracking_schema.sql`
- **Tracking API:** `services/tracking-api` — `POST /track`, `POST /track/batch`, `GET /health`
- **Browser SDK:** `sdk/browser-behavior-sdk`
- **Demo shop:** `clients/demo-shop` — home, products, cart, checkout, thank you
- **Streaming Processor:** `services/streaming-processor` — Kafka → clean events + KPI 1m → Postgres
- **Dashboard API:** `services/dashboard-api` — `GET /api/overview|events|funnel|products/*`
- **Dashboard UI:** `clients/dashboard` — Overview, Events, Funnel, Products (dark theme, auto-refresh)

Spec: [`docs/PROJECT.md`](docs/PROJECT.md) · Map: [`docs/REPO_MAP.md`](docs/REPO_MAP.md)

## Quick start (Docker)

```bash
cd infra
cp .env.example .env
# Edit POSTGRES_PASSWORD in .env

docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Demo shop | http://localhost:8080 |
| Tracking API | http://localhost:3100/health |
| Dashboard UI | http://localhost:8090 |
| Dashboard API | http://localhost:3200/health |
| Kafka | localhost:9092 |
| Postgres | localhost:5432 |

**Fresh DB** (apply new schema): `docker compose down -v` then `up` again.

## Local dev (demo shop + API)

```bash
# Terminal 1 — infra only
cd infra && docker compose up -d zookeeper kafka postgres tracking-api

# Terminal 2 — tracking API hot reload (optional, instead of container)
cd services/tracking-api && npm install && npm run dev

# Terminal 3 — demo shop
cd clients/demo-shop && npm install && npm run dev
# → http://localhost:5173
```

## Test ingest

```bash
curl -s -X POST http://localhost:3100/track \
  -H "Content-Type: application/json" \
  -d "{\"event_type\":\"page_view\",\"anonymous_id\":\"anon_test\",\"session_id\":\"sess_test\",\"page_url\":\"/\"}"
```

Verify Kafka topic (inside kafka container):

```bash
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic tracking_events_raw \
  --from-beginning --max-messages 3
```
