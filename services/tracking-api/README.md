# tracking-api

Node.js ingestion API — validate/enrich events → Kafka `tracking_events_raw`.

## Endpoints

- `GET /health`
- `POST /track` — single event
- `POST /track/batch` — `{ "events": [...] }` (max 100)

## Run

```bash
npm install
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 npm run dev
```
