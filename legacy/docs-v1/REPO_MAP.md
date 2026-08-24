# Spec → Repo mapping

> **LEGACY V1:** Tài liệu này mô tả pipeline/k3s cũ đã ngừng duy trì ngày 2026-08-24. Các đường dẫn cũ chỉ dùng tham khảo; xem [`REPOSITORY_LAYOUT.md`](../../docs/REPOSITORY_LAYOUT.md) cho cấu trúc hiện hành.

> **Runtime thật (k3s):** [`RUNTIME.md`](RUNTIME.md) — ingest qua `tracking-api` only; commerce từ Lap2 adapter.

Ánh xạ [`SPEC.md`](SPEC.md) vào cấu trúc repo. Cách chạy: [`RUNTIME.md`](RUNTIME.md).

**Chú thích status:** `có` = đã có code/infra · `shell` = thư mục/README, chưa implement · `spec` = chỉ trong tài liệu · `đổi tên` = tên repo khác tên spec

---

## 1. Kiến trúc → thư mục

| Thành phần (spec) | Path trong repo | Status | Ghi chú |
|-------------------|-----------------|--------|---------|
| Browser Behavior SDK | `sdk/browser-behavior-sdk/` | có | `createBehaviorSdk()` → Tracking API |
| Demo Web TMĐT | `../Simulate_Demo/` | có | Static + Express backend + SDK; dev `:3000` |
| Demo Commerce Backend | `services/commerce-backend/` | có | Deploy, publish commerce events vào RabbitMQ |
| Tracking API | `services/tracking-api/` | có | `POST /track` + `POST /api/ingest/business-events` → Kafka |
| Kafka | `infra/k8s/data/kafka/` | có | Topic: `tracking_events_raw` |
| Streaming Processor | `services/streaming-processor/` | có | Python consumer: Kafka → Postgres + KPI + Qdrant |
| PostgreSQL | `infra/postgres/`, `infra/k8s/data/postgres/` | có | Schema + k8s init |
| Qdrant | `infra/k8s/data/qdrant/` | có | Collection `pipeline_insights`; RAG chatbot |
| Ollama | `infra/k8s/apps/ollama/` | có | LLM in-cluster; PVC `ollama-data` |
| RabbitMQ | `infra/k8s/data/rabbitmq/` | có | Queue nội bộ cho commerce events |
| Dashboard API + Chatbot API | `services/dashboard-api/` | có | `GET /api/*`, `POST /api/chat`, `GET /api/chat/insights` |
| Dashboard + Chatbot UI | `clients/dashboard/` | có | `/shop/*` analytics + `/shop/chat`; admin `/admin/system` |
| API docs (Swagger) | `clients/api-docs/` | có | localhost:5190 — không gắn dashboard UI |
| Bot Simulator | `bot-simulator/` | shell | Playwright; chạy Laptop 2 (spec mạng) |
| API Gateway / Nginx | `infra/nginx/` (TBD) | spec | Gom `/track`, `/api`, `/commerce`, dashboard |

---

## 2. Module cũ → module mới (spec §9)

| Module cũ | Path mới (repo) | Tận dụng |
|-----------|-----------------|----------|
| `generator-api` | `services/tracking-api/` | Nhận request, publish Kafka; đổi schema + topic |
| `clients/generator` | `../Simulate_Demo/` | Web TMĐT + SDK |
| `spark-streaming` | `services/streaming-processor/` | Đổi tên; **runtime Python** (không Spark); Kafka/Postgres + KPI |
| `dashboard-api` | `services/dashboard-api/` | Thêm overview, funnel, products, chat |
| `clients/dashboard` | `clients/dashboard/` | Đổi KPI sang behavior analytics |
| `infra` docker/k8s | `infra/k8s/` | k3s sprint1–3 |
| `producer-poller` | — | Bỏ; Tracking API publish thẳng Kafka |

---

## 3. Luồng dữ liệu → service

```text
[Laptop 2] ../Simulate_Demo/ + sdk/  →  POST /track (behavior)
       ▼
[Laptop 2] web-shop → RabbitMQ → adapter → POST ingest (Lap1 tracking-api)
[Laptop 1 k3s] tracking-api → Kafka (tracking_events_raw)
       → streaming-processor → PostgreSQL + Qdrant
       → dashboard-api → dashboard-ui (+ ollama chat)
```

| Bước | Topic / API | Owner path |
|------|-------------|------------|
| Ingest (behavior + commerce) | `POST /track`, `/track/batch` | `services/tracking-api/` |
| Raw events | Kafka `tracking_events_raw` | `infra` + producers |
| Clean + KPI | Python streaming job | `services/streaming-processor/` |
| Serving | `GET /api/overview`, `/api/funnel`, … | `services/dashboard-api/` |
| Chat | `POST /api/chat` | `services/dashboard-api/` (module chatbot) |

---

## 4. PostgreSQL (spec §6, §13)

| Bảng (spec) | File đích | Status |
|-------------|-----------|--------|
| `tracking_events_clean` | `infra/postgres/001_tracking_schema.sql` | có (init on fresh volume) |
| `tracking_kpi_1m` | `001_tracking_schema.sql` | có |
| `product_kpi_1m` | ↑ | có |
| `banner_kpi_1m` | ↑ | có |
| `product_revenue_kpi_1m` | ↑ | có |
| `products_catalog` | `002_products_catalog.sql` | có |
| `dashboard_users` | `003_dashboard_users.sql` | có |
| `chat_sessions`, `chat_messages` | `004_chat_history.sql` | có |
| `remove_from_cart` KPI cols | `005_remove_from_cart_kpi.sql` | có (migration; PVC cũ) |

`init.sql` giữ extension bootstrap; migration numbered chạy sau init.

---

## 5. `services/dashboard-api/` (spec §0.2, §8)

| Module spec | Path gợi ý | Endpoint |
|-------------|------------|----------|
| tracking | *tách sang `tracking-api/`* | `/track`, `/track/batch` |
| dashboard | `routes/overview.*`, `routes/products.*` | `/api/overview`, `/api/events/recent`, `/api/funnel`, `/api/products/top` |
| chatbot | `routes/chat.js`, `lib/chat/*` | `/api/chat`, `/api/chat/sessions` |
| health | `routes/health.*` | `/health` |

---

## 6. `services/streaming-processor/` pipeline (spec §0.2)

| Module | Path repo | Ghi chú |
|--------|-----------|---------|
| Kafka consumer loop | `main.py` | `kafka-python` consumer group |
| `parser.py` | `lib/parser.py` | |
| `validator.py` | `lib/validator.py` | |
| `cleaner.py` | `lib/cleaner.py` | |
| `aggregator.py` | `lib/aggregator.py` | Tumbling 1 phút |
| `sink_postgres.py` | `lib/sink_postgres.py` | Idempotent upsert |
| `insight_generator.py` | `lib/insight_generator.py` | → Qdrant |
| `qdrant_client.py`, `embed.py` | `lib/` | Vector insight |

**k8s:** `readinessProbe` / `livenessProbe` **chưa** khai báo cho deployment này (khác tracking-api/dashboard-api).

---

## 7. `clients/dashboard/` (spec §7)

| Feature | Path thực tế (React) |
|---------|---------------------|
| Overview | `src/pages/OverviewPage.jsx` |
| Revenue | `src/pages/RevenuePage.jsx` |
| Products / anomalies | `src/pages/ProductsPage.jsx` |
| Funnel | `src/pages/FunnelPage.jsx` |
| Live events + SSE | `src/pages/EventsPage.jsx`, `context/LiveStreamContext.jsx` |
| Search / filters | `src/pages/SearchPage.jsx` |
| Banners | `src/pages/BannersPage.jsx` |
| Chat + history | `src/pages/ChatPage.jsx` |
| Admin pipeline | `src/pages/SystemPage.jsx` |
| Admin users / setup / insights | `src/pages/UsersPage.jsx`, `AdminSetupPage.jsx`, `AdminInsightsPage.jsx` |
| Period `minutes` / `date` | `src/hooks/useManagerPeriod.js`, `src/lib/period.js` |

---

## 8. Infra & môi trường demo (spec mạng)

| Môi trường | File | Ghi chú |
|------------|------|---------|
| **k3s (runtime)** | `infra/k8s/sprint3/` | `k3s kubectl apply -k infra/k8s/sprint3` — NodePort 31000, 32000, 30809 |
| Runtime doc | `docs/RUNTIME.md` | Nguồn chân lý deploy |
| Port map | `docs/RUNTIME.md` §5 | NodePort, CORS, tailnet |
| Headscale / Tailscale | — | `docs/RUNTIME.md` §8 |
| Laptop 1 backend | WSL2 + k3s | |
| Laptop 2 demo + bot | `../Simulate_Demo`, `bot-simulator/` | `TRACKING_FORWARD_URL` → `http://lap1:31000/track` |

---

## 9. Roadmap implement theo repo

| Phase | Việc | Path chính |
|-------|------|------------|
| 0 | Infra Kafka + Postgres + streaming | `infra/`, `services/streaming-processor/` | **Done** |
| 1 | Schema Postgres + Tracking API + SDK + web-shop | `infra/postgres/`, `tracking-api/`, `sdk/`, `../Simulate_Demo/` | **Done** |
| 2 | Streaming: consume `tracking_events_raw`, sink clean + KPI | `services/streaming-processor/lib/` | **Done** |
| 3 | Dashboard API + UI overview/funnel/events/products | `dashboard-api/`, `clients/dashboard/` | **Done** |
| 4 | Bot simulator | `bot-simulator/` |
| 5 | Commerce backend + RabbitMQ; adapter/worker trên Lap2 (web-shop) | `services/commerce-backend/`, `infra/k8s/data/rabbitmq/`, `../Simulate_Demo/` | **Done** |
| 6 | Chatbot + Qdrant | `dashboard-api/`, `infra/` | **Done** |

---

## 10. Cây thư mục mục tiêu

```text
Funnelmetry/
├── Streaming_Pipeline/              # Thư mục local; GitHub repository: Funnelmetry
│   ├── AGENTS.md
│   ├── bot-simulator/              # Playwright bot (Laptop 2)
│   ├── clients/
│   │   ├── dashboard/              # Analytics + chatbot UI
│   │   └── api-docs/               # Swagger localhost :5190
│   ├── docs/                       # Tài liệu runtime/spec của pipeline
│   ├── infra/
│   │   ├── postgres/
│   │   └── k8s/
│   ├── sdk/
│   │   └── browser-behavior-sdk/
│   └── services/
│       ├── tracking-api/
│       ├── commerce-backend/
│       ├── streaming-processor/
│       └── dashboard-api/
└── Simulate_Demo/                  # Repo web mô phỏng; npm run dev|worker|adapter
```
