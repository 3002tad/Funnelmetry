# Spec → Repo mapping

> **Runtime thật (k3s):** [`RUNTIME.md`](RUNTIME.md) — không RabbitMQ; commerce qua SDK.

Ánh xạ [`Refactor_tracking_pipeline.md`](Refactor_tracking_pipeline.md) và [`Thiet_lap_mang_moi_truong.md`](Thiet_lap_mang_moi_truong.md) vào cấu trúc repo.

**Chú thích status:** `có` = đã có code/infra · `shell` = thư mục/README, chưa implement · `spec` = chỉ trong tài liệu · `đổi tên` = tên repo khác tên spec

---

## 1. Kiến trúc → thư mục

| Thành phần (spec) | Path trong repo | Status | Ghi chú |
|-------------------|-----------------|--------|---------|
| Browser Behavior SDK | `sdk/browser-behavior-sdk/` | có | `createBehaviorSdk()` → Tracking API |
| Demo Web TMĐT | `clients/demo-shop/` | có | React + SDK; Docker `:8080` hoặc Vite `:5173` |
| Demo Commerce Backend | `services/commerce-backend/` | legacy | Không deploy; thay bằng SDK commerce events |
| Commerce Connector | `services/commerce-connector/` | legacy | Không deploy |
| Tracking API | `services/tracking-api/` | có | `POST /track`, `/track/batch` → Kafka `tracking_events_raw` |
| Kafka | `infra/k8s/data/kafka/` | có | Topic: `tracking_events_raw` |
| Streaming Processor | `services/streaming-processor/` | có (placeholder) | Spark job: Kafka → Postgres + KPI |
| PostgreSQL | `infra/postgres/`, `infra/k8s/data/postgres/` | có | Schema + k8s init |
| Qdrant | `infra/k8s/data/qdrant/` | có | Collection `pipeline_insights`; RAG chatbot |
| Ollama | `infra/k8s/apps/ollama/` | có | LLM in-cluster; PVC `ollama-data` |
| RabbitMQ | `infra/k8s/data/rabbitmq/` | legacy | Không deploy |
| Dashboard API + Chatbot API | `services/dashboard-api/` | có | `GET /api/*`, `POST /api/chat`, `GET /api/chat/insights` |
| Dashboard + Chatbot UI | `clients/dashboard/` | có | Overview, funnel, product, `/admin/chat`, `/shop/chat` |
| Bot Simulator | `bot-simulator/` | shell | Playwright; chạy Laptop 2 (spec mạng) |
| API Gateway / Nginx | `infra/nginx/` (TBD) | spec | Gom `/track`, `/api`, `/commerce`, dashboard |

---

## 2. Module cũ → module mới (spec §9)

| Module cũ | Path mới (repo) | Tận dụng |
|-----------|-----------------|----------|
| `generator-api` | `services/tracking-api/` | Nhận request, publish Kafka; đổi schema + topic |
| `clients/generator` | `clients/demo-shop/` | React demo TMĐT + SDK |
| `spark-streaming` | `services/streaming-processor/` | Đã đổi tên; giữ Spark/Kafka/Postgres; đổi logic KPI |
| `dashboard-api` | `services/dashboard-api/` | Thêm overview, funnel, products, chat |
| `clients/dashboard` | `clients/dashboard/` | Đổi KPI sang behavior analytics |
| `infra` docker/k8s | `infra/k8s/` | k3s sprint1–3; Compose legacy |
| `producer-poller` | — | Bỏ; Tracking API publish thẳng Kafka |

---

## 3. Luồng dữ liệu → service

```text
[Laptop 2] clients/demo-shop/ + sdk/  →  POST /track (behavior + commerce)
       ▼
[Laptop 1 k3s] tracking-api → Kafka (tracking_events_raw)
       → streaming-processor → PostgreSQL + Qdrant
       → dashboard-api → dashboard-ui (+ ollama chat)
```

| Bước | Topic / API | Owner path |
|------|-------------|------------|
| Ingest (behavior + commerce) | `POST /track`, `/track/batch` | `services/tracking-api/` |
| Raw events | Kafka `tracking_events_raw` | `infra` + producers |
| Clean + KPI | Spark job | `services/streaming-processor/` |
| Serving | `GET /api/overview`, `/api/funnel`, … | `services/dashboard-api/` |
| Chat | `POST /api/chat` | `services/dashboard-api/` (module chatbot) |

---

## 4. PostgreSQL (spec §6, §13)

| Bảng (spec) | File đích | Status |
|-------------|-----------|--------|
| `tracking_events_clean` | `infra/postgres/001_tracking_schema.sql` | có (init on fresh volume) |
| `tracking_kpi_1m` | ↑ | shell |
| `product_kpi_1m` | ↑ | shell |
| `banner_kpi_1m` | ↑ (§13) | shell |
| `product_revenue_kpi_1m` | ↑ (§13) | shell |

`init.sql` giữ extension bootstrap; migration numbered chạy sau init.

---

## 5. `services/dashboard-api/` (spec §0.2, §8)

| Module spec | Path gợi ý | Endpoint |
|-------------|------------|----------|
| tracking | *tách sang `tracking-api/`* | `/track`, `/track/batch` |
| dashboard | `routes/overview.*`, `routes/products.*` | `/api/overview`, `/api/events/recent`, `/api/funnel`, `/api/products/top` |
| chatbot | `routes/chat.*`, `lib/chat/`, `lib/rag/` | `/api/chat` |
| health | `routes/health.*` | `/health` |

---

## 6. `services/streaming-processor/` pipeline (spec §0.2)

| File spec | Path repo (tạo dần) |
|-----------|---------------------|
| `consumer.py` | `lib/consumer.py` |
| `parser.py` | `lib/parser.py` |
| `validator.py` | `lib/validator.py` |
| `cleaner.py` | `lib/cleaner.py` |
| `aggregator.py` | `lib/aggregator.py` |
| `sink_postgres.py` | `lib/sink_postgres.py` |
| `insight_generator.py` | `lib/insight_generator.py` |

Entrypoint hiện tại: `main.py` (placeholder health wait).

---

## 7. `clients/dashboard/` (spec §7)

| Feature spec | Path gợi ý |
|--------------|------------|
| Overview cards | `src/features/overview/` |
| Realtime event stream | `src/features/events/` |
| Conversion funnel | `src/features/funnel/` |
| Product analytics | `src/features/products/` |
| Banner performance (§13) | `src/features/banners/` |
| Chatbot UI | `src/features/chatbot/` |
| System status | `src/features/system-status/` |

---

## 8. Infra & môi trường demo (spec mạng)

| Môi trường | File | Ghi chú |
|------------|------|---------|
| **k3s (runtime)** | `infra/k8s/sprint3/` | `k3s kubectl apply -k infra/k8s/sprint3` — NodePort 31000, 32000, 30809 |
| Runtime doc | `docs/RUNTIME.md` | Nguồn chân lý deploy |
| Port map | `infra/PORTS.md` | NodePort, CORS, tailnet |
| Docker Compose (legacy) | `infra/docker-compose.yml` | Không deploy |
| Headscale / Tailscale | — | `docs/Thiet_lap_mang_moi_truong.md` |
| Laptop 1 backend | WSL2 + k3s | |
| Laptop 2 demo + bot | `clients/demo-shop`, `bot-simulator/` | `VITE_TRACKING_API_URL` → WSL IP `:31000` (k3s) |

---

## 9. Roadmap implement theo repo

| Phase | Việc | Path chính |
|-------|------|------------|
| 0 | Infra Kafka + Postgres + streaming shell | `infra/`, `services/streaming-processor/` | **Done** |
| 1 | Schema Postgres + Tracking API + SDK + demo-shop | `infra/postgres/`, `tracking-api/`, `sdk/`, `clients/demo-shop/` | **Done** |
| 2 | Streaming: consume `tracking_events_raw`, sink clean + KPI | `services/streaming-processor/lib/` | **Done** |
| 3 | Dashboard API + UI overview/funnel/events/products | `dashboard-api/`, `clients/dashboard/` | **Done** |
| 4 | Bot simulator | `bot-simulator/` |
| 5 | Commerce via SDK (legacy `commerce-*` code) | `clients/demo-shop/`, `sdk/` |
| 6 | Chatbot + Qdrant | `dashboard-api/`, `infra/` | **Done** |

---

## 10. Cây thư mục mục tiêu

```text
.
├── AGENTS.md
├── bot-simulator/              # Playwright bot (Laptop 2)
├── clients/
│   ├── demo-shop/              # Web TMĐT demo
│   └── dashboard/              # Analytics + chatbot UI
├── docs/
│   ├── RUNTIME.md              # deploy thật (k3s)
│   ├── PROJECT.md
│   ├── REPO_MAP.md             # file này
│   ├── Refactor_tracking_pipeline.md
│   └── Thiet_lap_mang_moi_truong.md
├── infra/
│   ├── docker-compose.yml
│   ├── postgres/
│   └── k8s/
├── sdk/
│   └── browser-behavior-sdk/
└── services/
    ├── tracking-api/
    ├── commerce-backend/
    ├── commerce-connector/
    ├── streaming-processor/
    └── dashboard-api/
```
