# Agent context

**Docs:** [`docs/README.md`](docs/README.md) · **Runtime:** [`docs/RUNTIME.md`](docs/RUNTIME.md) · **Stack:** [`docs/TECH_STACK.md`](docs/TECH_STACK.md) · **Spec:** [`docs/SPEC.md`](docs/SPEC.md) · **Map:** [`docs/REPO_MAP.md`](docs/REPO_MAP.md)

## Mục tiêu

Refactor pipeline cũ (business event demo) → **hệ thống tracking realtime** cho website TMĐT demo:

- **Behavior events** từ Browser Behavior SDK (xương sống)
- **Commerce events** từ web-shop (Lap2) qua RabbitMQ + adapter → tracking-api ingest (schema thống nhất)
- **Kafka + Streaming Processor** → PostgreSQL + insight → **Qdrant**
- **Dashboard + Chatbot AI** (RAG: Postgres số liệu + Qdrant ngữ cảnh)

## Kiến trúc (tóm tắt)

```text
Web-shop + SDK → Tracking API → Kafka → Streaming → PostgreSQL + Qdrant insights
                                                      ↓
                                            Dashboard API/UI + Chat (Ollama in k3s)
```

## Stack / pattern

- Event-Driven + Pub/Sub + Pipeline (parse → validate → clean → aggregate → persist → insight)
- Backend API: Controller–Service–Repository/Producer
- Streaming: pipeline modules (`consumer`, `parser`, `aggregator`, `sink_postgres`, …)
- Chatbot: Service layer + RAG

## Triển khai demo (xem doc mạng)

- **Laptop 1 (WSL2):** **k3s** — tracking, Kafka, streaming, Postgres, Qdrant, Ollama, dashboard (`k3s kubectl apply -k infra/k8s/sprint3`)
- **Laptop 2 (Windows):** web demo + Bot Simulator (Playwright); SDK gửi event qua tailnet về Laptop 1
- **Server:** Headscale + DERP (+ bot backup)

## Repo vs spec

| Có sẵn | Shell / phase sau |
|--------|------------------|
| Phase 1–6: tracking, streaming, dashboard, chatbot+Qdrant (commerce qua RabbitMQ path) | Phase 4: `bot-simulator` |
| `infra/k8s/sprint3` + `infra/PORTS.md` | RabbitMQ + commerce-backend trên k3s; adapter/worker trên Lap2 |
| `services/dashboard-api/`, `clients/dashboard/` | `POST /api/chat`, insight → Qdrant |

Chi tiết path + phase: [`docs/REPO_MAP.md`](docs/REPO_MAP.md).

## Rules

- `/.cursor/rules/clean-code.mdc`
- `/.cursor/rules/project-context.mdc`
