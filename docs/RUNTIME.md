# Runtime — nguồn chân lý (k3s)

Tài liệu này mô tả **cách project chạy thật hôm nay**. Spec chi tiết lịch sử: [`PROJECT.md`](PROJECT.md), [`Refactor_tracking_pipeline.md`](Refactor_tracking_pipeline.md).

## Triển khai

| | |
|---|---|
| **Runtime** | k3s trên WSL2 (Laptop 1) |
| **Apply** | `k3s kubectl apply -k infra/k8s/sprint3` (full stack + commerce path) |
| **Không dùng** | Docker Compose deploy |

Ports & URL: [`infra/PORTS.md`](../infra/PORTS.md) · Deploy: [`infra/k8s/README.md`](../infra/k8s/README.md)

## Luồng event

```text
Web-shop (browser) + Browser SDK
        │  behavior: POST /track
        │  commerce: commerce-backend -> RabbitMQ -> connector
        ▼
  tracking-api  ◄──── commerce-connector
        │
        └───────►  Kafka (tracking_events_raw)
        ▲                    │
        │                    ▼
        │           streaming-processor
        │                    │
        │         ┌──────────┴──────────┐
        │         ▼                     ▼
        │   PostgreSQL            Qdrant (insights)
        │   (clean + KPI)                │
        │         │                     │
        └─────────┴── dashboard-api ◄──┘
                      │  /api/*
                      ▼
               dashboard-ui (:30809)
                      │
               Ollama in-cluster (chat)
```

**Commerce** (`checkout_start`, `purchase_succeeded`, …): đi qua `commerce-backend` + RabbitMQ + `commerce-connector`, `event_source: commerce_backend_rabbitmq`.

## Pods (namespace `realtime`)

| Pod | Vai trò |
|-----|---------|
| postgres | DB |
| kafka | Queue raw events |
| tracking-api | Ingest HTTP |
| streaming-processor | Consume Kafka → Postgres + Qdrant |
| dashboard-api | REST + chat |
| dashboard-ui | React + nginx proxy `/api/` |
| qdrant | Vector insights |
| ollama | LLM (`qwen2.5:3b`, PVC `ollama-data`) |

## Client (Laptop 2 / Windows)

```env
# infra/.env
VITE_TRACKING_API_URL=http://<WSL_IP>:31000
```

Dashboard: `http://<WSL_IP>:30809` — không cần gọi thẳng `:32000` từ browser.

## Legacy (không deploy)

| Thành phần | Path | Ghi chú |
|------------|------|---------|
| RabbitMQ | `infra/k8s/data/rabbitmq/` | Queue commerce events |
| commerce-backend | `services/commerce-backend/`, `infra/k8s/apps/commerce-backend/` | Publish AMQP |
| commerce-connector | `services/commerce-connector/`, `infra/k8s/apps/commerce-connector/` | Consume AMQP -> tracking-api |
| Docker Compose stack | `infra/docker-compose.yml` | Build image / tham khảo |

## Secret `app-secrets` (k3s)

Cần: `POSTGRES_*`, `JWT_SECRET`, `DASHBOARD_ADMIN_EMAIL`, `DASHBOARD_ADMIN_PASSWORD`, `RABBITMQ_URL`.
