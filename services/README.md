# Services

| Path | Spec component | Status |
|------|----------------|--------|
| [tracking-api/](tracking-api/) | Tracking API — ingest `/track` → Kafka | có |
| [commerce-backend/](commerce-backend/) | Web Demo API stand-in — `POST /api/orders` → RabbitMQ | có |
| [web-demo-worker/](web-demo-worker/) | Order processing queue consumer | có |
| [commerce-connector/](commerce-connector/) | Tracking business consumer → tracking-api | có |
| [streaming-processor/](streaming-processor/) | Kafka → Postgres + Qdrant | có |
| [dashboard-api/](dashboard-api/) | Dashboard + Chatbot API | có |

RabbitMQ topology: `docs/RabbitMQ Integration Guide.docx` · [RUNTIME.md](../docs/RUNTIME.md) §6.

Mapping: [docs/REPO_MAP.md](../docs/REPO_MAP.md)
