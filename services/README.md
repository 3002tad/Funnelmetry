# Services

| Path | Spec component | Status |
|------|----------------|--------|
| [tracking-api/](tracking-api/) | Tracking API — ingest `/track` → Kafka | có |
| [commerce-backend/](commerce-backend/) | Order API stand-in trên k3s (tuỳ chọn; demo chính = web-shop Lap2) | có |
| [streaming-processor/](streaming-processor/) | Kafka → Postgres + Qdrant | có |
| [dashboard-api/](dashboard-api/) | Dashboard + Chatbot API | có |

RabbitMQ / adapter: [`docs/RabbitMQ_Adapter_Integration_Standard_Windows_K8s_Tailscale.docx`](../docs/RabbitMQ_Adapter_Integration_Standard_Windows_K8s_Tailscale.docx) · [RUNTIME.md](../docs/RUNTIME.md) §6–7.

Mapping: [docs/REPO_MAP.md](../docs/REPO_MAP.md)
