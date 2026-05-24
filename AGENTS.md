# Agent context

**Đọc spec:** [`docs/PROJECT.md`](docs/PROJECT.md) · **Map repo:** [`docs/REPO_MAP.md`](docs/REPO_MAP.md)

## Mục tiêu

Refactor pipeline cũ (business event demo) → **hệ thống tracking realtime** cho website TMĐT demo:

- **Behavior events** từ Browser Behavior SDK (xương sống)
- **Commerce events** từ Demo Commerce Backend → RabbitMQ → Commerce Connector → schema chung
- **Kafka + Streaming Processor** → PostgreSQL + insight → **Qdrant**
- **Dashboard + Chatbot AI** (RAG: Postgres số liệu + Qdrant ngữ cảnh)

## Kiến trúc (tóm tắt)

```text
Bot/User → Demo Web + SDK → Tracking API → Kafka → Streaming → PostgreSQL
Commerce Backend → RabbitMQ → Connector ─┘                              ↓
                                                              Insight → Qdrant
                                                              Dashboard + Chatbot
```

## Stack / pattern

- Event-Driven + Pub/Sub + Pipeline (parse → validate → clean → aggregate → persist → insight)
- Backend API: Controller–Service–Repository/Producer
- Streaming: pipeline modules (`consumer`, `parser`, `aggregator`, `sink_postgres`, …)
- Chatbot: Service layer + RAG

## Triển khai demo (xem doc mạng)

- **Laptop 1 (WSL2):** backend stack (API, Kafka, RabbitMQ, streaming, Postgres, Qdrant, dashboard)
- **Laptop 2 (Windows):** web demo + Bot Simulator (Playwright); SDK gửi event qua tailnet về Laptop 1
- **Server:** Headscale + DERP (+ bot backup)

## Repo vs spec

| Có sẵn | Shell / phase sau |
|--------|------------------|
| Phase 1–6: tracking, streaming, dashboard, commerce, chatbot+Qdrant | Phase 4: `bot-simulator` |
| `infra/` Kafka, Postgres, RabbitMQ, Qdrant, compose | Bot simulator (Playwright) |
| `services/dashboard-api/`, `clients/dashboard/` | `POST /api/chat`, insight → Qdrant |

Chi tiết path + phase: [`docs/REPO_MAP.md`](docs/REPO_MAP.md).

## Rules

- `/.cursor/rules/clean-code.mdc`
- `/.cursor/rules/project-context.mdc`
