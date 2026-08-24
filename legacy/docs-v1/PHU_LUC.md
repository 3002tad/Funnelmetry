# Phụ lục — Báo cáo / Luận văn

> **LEGACY V1:** Tài liệu này mô tả pipeline/k3s cũ đã ngừng duy trì ngày 2026-08-24. Các đường dẫn cũ chỉ dùng tham khảo; xem [`REPOSITORY_LAYOUT.md`](../../docs/REPOSITORY_LAYOUT.md) cho cấu trúc hiện hành.

Tài liệu bổ sung cho [`BAO_CAO_DU_AN.md`](BAO_CAO_DU_AN.md). Chi tiết triển khai: [`RUNTIME.md`](RUNTIME.md). API đầy đủ: [`API.md`](API.md).

| Phụ lục | Nội dung |
|---------|----------|
| **A** | Event schema và payload JSON mẫu |
| **B** | API endpoint, request/response, mã lỗi |
| **C** | Cấu trúc thư mục và mô tả service |
| **D** | Checklist triển khai Lap1/Lap2 và demo |
| **E** | Ảnh / log minh chứng (hướng dẫn chụp & lệnh) |

---

## Phụ lục A — Event schema và payload JSON mẫu

### A.1. Schema tracking chung (sau ingest, trên Kafka / Postgres)

Mọi event vào topic **`tracking_events_raw`** dùng cùng cấu trúc (tracking-api enrich trước khi publish).

| Trường | Bắt buộc | Kiểu | Ghi chú |
|--------|----------|------|---------|
| `event_id` | Khuyến nghị | string | API sinh `evt_<uuid>` nếu thiếu |
| `event_type` | **Có** | string | Xem A.2, A.3 |
| `anonymous_id` | **Có** | string | Định danh ẩn danh |
| `session_id` | **Có** | string | Kafka message key |
| `timestamp` | Khuyến nghị | ISO 8601 | API điền `now` nếu thiếu |
| `event_source` | Khuyến nghị | string | Mặc định `browser_sdk` |
| `event_category` | Khuyến nghị | `behavior` \| `commerce` | Suy từ `event_type` / `event_source` |
| `user_id` | Không | string \| null | Khi có login giả |
| `page_url` | Không | string | |
| `product_id` | Không | string | |
| `metadata` | Không | object | `query`, `amount`, `items`, `banner_id`, … |

**Batch SDK:** `POST /track/batch` — tối đa **100** event/request.

---

### A.2. Behavior event (Browser SDK → `POST /track`)

**Endpoint:** `POST http://<WSL_IP>:31000/track` — **không** Bearer (công khai, chỉ validate schema).

**`event_type` hợp lệ:**

`page_view`, `product_view`, `product_click`, `scroll_depth`, `search`, `filter_apply`, `banner_impression`, `banner_click`

**`event_source` thường gặp:** `browser_sdk`

#### Mẫu 1 — `page_view`

```json
{
  "event_id": "evt_pv_001",
  "event_source": "browser_sdk",
  "event_category": "behavior",
  "event_type": "page_view",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "user_id": null,
  "page_url": "/",
  "timestamp": "2026-05-30T08:00:00.000Z",
  "metadata": {
    "referrer": "https://google.com",
    "device": "desktop"
  }
}
```

#### Mẫu 2 — `product_view`

```json
{
  "event_id": "evt_pv_002",
  "event_source": "browser_sdk",
  "event_category": "behavior",
  "event_type": "product_view",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "page_url": "/products/P001",
  "product_id": "P001",
  "timestamp": "2026-05-30T08:01:12.000Z",
  "metadata": {
    "category": "electronics",
    "price": 2500000
  }
}
```

#### Mẫu 3 — `search`

```json
{
  "event_type": "search",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "page_url": "/search",
  "timestamp": "2026-05-30T08:02:00.000Z",
  "metadata": {
    "query": "laptop gaming",
    "result_count": 12
  }
}
```

#### Mẫu 4 — `banner_click`

```json
{
  "event_type": "banner_click",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "page_url": "/",
  "metadata": {
    "banner_id": "hero_home_top",
    "position": "homepage_hero"
  }
}
```

**Response 202:**

```json
{ "accepted": true, "event_id": "evt_pv_001" }
```

---

### A.3. Commerce event (tracking schema — từ SDK hoặc sau map từ business)

**`event_type` hợp lệ:**

`add_to_cart`, `remove_from_cart`, `checkout_start`, `purchase_succeeded`, `payment_failed`, `cart_abandoned`, `order_cancelled`

**`event_source` hợp lệ:** `browser_sdk`, `commerce_backend_rabbitmq`, `web_demo_backend`, `web_demo_worker`, `web_demo_api`, `rabbitmq_adapter`

#### Mẫu — `add_to_cart` (SDK / commerce shortcut)

```json
{
  "event_id": "evt_atc_001",
  "event_source": "browser_sdk",
  "event_category": "commerce",
  "event_type": "add_to_cart",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "product_id": "P001",
  "page_url": "/products/P001",
  "timestamp": "2026-05-30T08:03:00.000Z",
  "metadata": {
    "quantity": 1,
    "price": 2500000
  }
}
```

#### Mẫu — `purchase_succeeded` (sau map từ `order.completed`)

```json
{
  "event_id": "biz_ord_complete_7f3a",
  "event_source": "rabbitmq_adapter",
  "event_category": "commerce",
  "event_type": "purchase_succeeded",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_20260530_001",
  "user_id": "user_demo",
  "product_id": "P001",
  "page_url": "/checkout",
  "timestamp": "2026-05-30T08:10:00.000Z",
  "metadata": {
    "business_event_type": "order.completed",
    "business_event_source": "web_demo_worker",
    "order_id": "ORD-20260530-001",
    "total_amount": 2500000,
    "amount": 2500000,
    "items": [
      { "product_id": "P001", "name": "Laptop Demo", "quantity": 1, "price": 2500000 }
    ]
  }
}
```

---

### A.4. Business event (canonical — Adapter → `POST /api/ingest/business-events`)

**Endpoint:** `POST http://<WSL_IP>:31000/api/ingest/business-events`  
**Auth:** `Authorization: Bearer <TRACKING_INGEST_API_KEY>`

| Trường | Bắt buộc | Ghi chú |
|--------|----------|---------|
| `event_id` | Có | Idempotent dedup |
| `event_type` | Có | Xem bảng dưới |
| `event_source` | Có | VD: `web_demo_api`, `web_demo_worker` |
| `occurred_at` | Có | ISO 8601 |
| `session_id` | Có | |
| `anonymous_id` | Khuyến nghị | |
| `order_id` | Có với `order.*`, `payment.*` | |
| `metadata` | Object | `total_amount`, `items`, `status`, … |

**`event_type` business hợp lệ:**

`order.created`, `order.completed`, `order.cancelled`, `order.processing`, `payment.succeeded`, `payment.failed`, `payment.started`, `inventory.reserved`, `inventory.reserve_failed`

**Map sang tracking (trước Kafka):**

| Business | Tracking Kafka |
|----------|----------------|
| `order.completed` | `purchase_succeeded` |
| `order.created` | `checkout_start` |
| `payment.failed` | `payment_failed` |
| `order.cancelled` | `order_cancelled` |

Các loại khác có thể **accepted** nhưng **không** map → không vào Kafka (processor bỏ qua).

#### Mẫu — `order.created`

```json
{
  "event_id": "biz_ord_created_001",
  "event_type": "order.created",
  "event_source": "web_demo_api",
  "occurred_at": "2026-05-30T08:05:00.000Z",
  "session_id": "sess_20260530_001",
  "anonymous_id": "anon_a1b2",
  "order_id": "ORD-20260530-001",
  "metadata": {
    "status": "pending",
    "total_amount": 2500000,
    "items": [
      { "product_id": "P001", "name": "Laptop Demo", "quantity": 1, "price": 2500000 }
    ]
  }
}
```

#### Mẫu — `order.completed`

```json
{
  "event_id": "biz_ord_complete_001",
  "event_type": "order.completed",
  "event_source": "web_demo_worker",
  "occurred_at": "2026-05-30T08:10:00.000Z",
  "session_id": "sess_20260530_001",
  "anonymous_id": "anon_a1b2",
  "order_id": "ORD-20260530-001",
  "metadata": {
    "status": "completed",
    "total_amount": 2500000,
    "payment_method": "cod"
  }
}
```

**Response 202 (đơn):**

```json
{
  "success": true,
  "accepted_count": 1,
  "duplicate_count": 0,
  "rejected_count": 0,
  "batch_id": "batch_abc123"
}
```

**Batch:** `POST /api/ingest/business-events/batch` — body `{ "events": [ ... ] }`, tối đa 100; có thể **207** khi một phần reject.

---

## Phụ lục B — Danh sách API, request/response, mã lỗi

> Bản đầy đủ + ví dụ curl: [`API.md`](API.md). Swagger Try it out: `clients/api-docs` → `http://localhost:5190`.

### B.1. Port & base URL (NodePort)

| Service | Port | Base URL |
|---------|------|----------|
| tracking-api | 31000 | `http://<WSL_IP>:31000` |
| commerce-backend | 30330 | `http://<WSL_IP>:30330` |
| dashboard-api | 32000 | `http://<WSL_IP>:32000` |
| dashboard-ui | 30809 | `http://<WSL_IP>:30809` (proxy `/api/`) |

### B.2. Xác thực

| API | Cách xác thực |
|-----|----------------|
| `POST /track`, `/track/batch` | Không (SDK public) |
| `POST /api/ingest/business-events*` | `Authorization: Bearer <TRACKING_INGEST_API_KEY>` |
| Dashboard protected | `Authorization: Bearer <JWT>` |
| SSE `GET /api/events/stream` | `?token=<JWT>` |
| commerce-backend | Không (demo nội bộ) |

**Role JWT:** `analyst`, `viewer` → shop analytics + chat; `super_admin` → thêm `/api/system/*`, `/api/users`.

### B.3. tracking-api

| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| GET | `/health` | — | Health |
| POST | `/track` | — | 1 behavior/commerce event |
| POST | `/track/batch` | — | `{ "events": [] }` max 100 |
| POST | `/api/ingest/business-events` | Bearer | 1 business event |
| POST | `/api/ingest/business-events/batch` | Bearer | Batch business |

**`/track` 202:** `{ "accepted": true, "event_id": "..." }`  
**`/track` 400:** `{ "error": "validation_failed", "details": ["..."] }`  
**Ingest 401:** thiếu/sai Bearer  
**Ingest 503:** `{ "error": "business_ingest_disabled" }`

### B.4. dashboard-api — Auth

| Method | Path | Body / Response |
|--------|------|-----------------|
| POST | `/api/auth/login` | Body: `{ "email", "password" }` → 200: `{ "token", "user": { "id", "email", "display_name", "role" } }` |
| GET | `/api/auth/me` | JWT → user hiện tại |
| PATCH | `/api/auth/change-password` | `{ "current_password", "new_password" }` (≥ 6 ký tự) |

### B.5. dashboard-api — Shop analytics

Query chung: `minutes` (0 = tất cả, max 43200), `date=YYYY-MM-DD` (ưu tiên hơn `minutes`).

| Method | Path | Default `minutes` | Ghi chú |
|--------|------|-------------------|---------|
| GET | `/api/overview` | 30 | KPI + trend |
| GET | `/api/funnel` | 60 | Funnel steps |
| GET | `/api/products/top` | 60 | `limit` max 50 |
| GET | `/api/products/anomalies` | 60 | SP xem nhiều, 0 mua |
| GET | `/api/revenue/summary` | 60 | |
| GET | `/api/revenue/by-category` | 60 | |
| GET | `/api/banners` | 60 | |
| GET | `/api/search/top` | 60 | `limit` max 50 |
| GET | `/api/search/filters` | 60 | |
| GET | `/api/events/recent` | — | `limit` max 200 |
| GET | `/api/events/stream` | — | SSE: `events`, `kpi`, `ping` |

**Response wrapper (ví dụ overview):**

```json
{
  "period": { "type": "rolling", "minutes": 60, "label": "60 phút gần đây" },
  "kpi": {
    "total_events": 1200,
    "page_views": 400,
    "product_views": 180,
    "purchases": 5,
    "total_revenue": 12500000,
    "conversion_rate": 0.0125
  },
  "trend": [{ "window_start": "...", "page_views": 10, "purchases": 0, "revenue": 0 }]
}
```

### B.6. dashboard-api — Chat

| Method | Path | Body / ghi chú |
|--------|------|----------------|
| POST | `/api/chat` | `{ "message", "minutes?", "date?", "session_id?" }` → `{ "answer", "intent", "data_from", "session_id" }` |
| GET | `/api/chat/sessions` | Danh sách session |
| POST | `/api/chat/sessions` | Tạo session → 201 |
| GET | `/api/chat/sessions/:id/messages` | Lịch sử |
| DELETE | `/api/chat/sessions/:id` | Xóa session |

### B.7. dashboard-api — Admin (`super_admin`)

| Method | Path |
|--------|------|
| GET | `/api/system/pipeline` |
| GET | `/api/system/setup` |
| GET | `/api/chat/insights` |
| GET/POST/PATCH/DELETE | `/api/users`, `/api/users/:id` |

### B.8. commerce-backend

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/health` | |
| POST | `/api/orders` | Tạo đơn → RabbitMQ |
| POST | `/api/orders/:orderCode/cancel` | Hủy đơn |
| POST | `/commerce/add-to-cart` | Shortcut commerce event |
| POST | `/commerce/checkout-start` | |
| POST | `/commerce/purchase` | |
| POST | `/commerce/payment-failed` | |
| POST | `/commerce/cart-abandoned` | |

**`POST /api/orders` 201:** `{ "orderCode", "status", "totalAmount" }`

### B.9. Mã lỗi HTTP thường gặp

| HTTP | `error` (trường JSON) | Ý nghĩa |
|------|------------------------|---------|
| 400 | `validation_failed`, `missing_fields`, `message_required` | Sai/thiếu input |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token` | Auth |
| 403 | `forbidden` (+ `hint`: `admin_only`, `analyst_only`) | Sai role |
| 404 | `not_found`, `session_not_found` | Không tồn tại |
| 409 | `email_exists`, `order_not_cancellable` | Xung đột |
| 207 | (ingest batch) | Một phần accept/reject |
| 500 | `query_failed`, `chat_failed`, … | Lỗi server |
| 503 | `kafka_unavailable`, `postgres: unavailable`, `business_ingest_disabled` | Dependency |

---

## Phụ lục C — Cấu trúc mã nguồn và mô tả service

### C.1. Cây thư mục chính

```text
Funnelmetry/
├── Streaming_Pipeline/             # Thư mục local; GitHub repository: Funnelmetry
│   ├── docs/                      # BAO_CAO, RUNTIME, API, PHU_LUC, …
│   ├── infra/
│   │   ├── .env                   # WSL_IP, mật khẩu, VITE_*, ingest key
│   │   ├── postgres/              # SQL init + migration (001–005)
│   │   └── k8s/                   # Manifest runtime và công cụ vận hành
│   ├── sdk/
│   │   └── browser-behavior-sdk/  # SDK tracking trình duyệt
│   ├── clients/
│   │   ├── dashboard/             # UI analytics + chat + admin
│   │   └── api-docs/              # Swagger localhost :5190
│   ├── services/
│   │   ├── tracking-api/          # Ingest /track + business ingest → Kafka
│   │   ├── commerce-backend/      # API đơn hàng → RabbitMQ (k3s)
│   │   ├── streaming-processor/   # Kafka → Postgres + Qdrant
│   │   └── dashboard-api/         # REST analytics + chat RAG
│   └── bot-simulator/             # Playwright (shell / phase sau)
└── Simulate_Demo/                 # Web TMĐT demo + worker + adapter (Lap2)
```

### C.2. Mô tả service

| Service | Path | Công nghệ | Vai trò |
|---------|------|-----------|---------|
| **tracking-api** | `services/tracking-api/` | Node.js, Express | Nhận SDK `POST /track`; adapter `POST /api/ingest/business-events`; validate, enrich, publish **Kafka** `tracking_events_raw` |
| **commerce-backend** | `services/commerce-backend/` | Node.js | API đơn hàng demo; publish message **RabbitMQ** `ecommerce.events` (k3s) |
| **streaming-processor** | `services/streaming-processor/` | Python | Consumer Kafka: parse → validate → clean → aggregate KPI 1 phút → **PostgreSQL**; **insight** → **Qdrant** |
| **dashboard-api** | `services/dashboard-api/` | Node.js | JWT auth; `GET /api/overview`, funnel, revenue, …; **chat RAG** (Postgres + Qdrant + Ollama) |
| **dashboard-ui** | `clients/dashboard/` | React, Vite | `/shop/*` analytics; `/shop/chat`; `/admin/*` pipeline |
| **web-shop** | `../Simulate_Demo/` | Express + static | Lap2: web demo, SDK forward, **worker** xử lý đơn, **adapter** ingest business |
| **browser-behavior-sdk** | `sdk/browser-behavior-sdk/` | JS | `page_view`, `product_view`, search, banner, … → Tracking API |
| **Kafka** | `infra/k8s/data/kafka/` | KRaft | Topic `tracking_events_raw` |
| **PostgreSQL** | `infra/postgres/` | 16 | `tracking_events_clean`, `tracking_kpi_1m`, `dashboard_users`, chat, … |
| **Qdrant** | `infra/k8s/data/qdrant/` | | Collection `pipeline_insights` — RAG chatbot |
| **Ollama** | `infra/k8s/apps/ollama/` | | LLM `qwen2.5:3b` — polish câu trả lời chat |
| **RabbitMQ** | `infra/k8s/data/rabbitmq/` | | Queue commerce; **không** có connector in-cluster |

### C.3. Module nội bộ (tham chiếu nhanh)

**tracking-api:** `src/routes/track.js`, `routes/ingest.js`, `tracking.validator.js`, `lib/business-event.mapper.js`

**streaming-processor:** `main.py`, `lib/parser.py`, `validator.py`, `cleaner.py`, `aggregator.py`, `sink_postgres.py`, `insight_generator.py`

**dashboard-api:** `src/routes/*.js`, `src/lib/chat/` (RAG, intent, SQL)

**dashboard-ui:** `src/pages/*`, `src/context/ManagerPeriodContext.jsx`, `src/hooks/useManagerPeriod.js`

Map spec ↔ path: [`REPO_MAP.md`](REPO_MAP.md).

---

## Phụ lục D — Checklist triển khai và demo

### D.1. Laptop 1 (WSL2) — Backend k3s

**Lần đầu**

- [ ] Cài WSL2 Ubuntu, Docker Desktop (WSL integration)
- [ ] Clone repository pipeline và đặt `Simulate_Demo` cùng cấp nếu chạy nguồn mô phỏng
- [ ] `cp infra/.env.example infra/.env` — sửa `POSTGRES_PASSWORD`, `WSL_IP`, `JWT_SECRET`, `TRACKING_INGEST_API_KEY`
- [ ] `bash infra/k8s/install-k3s-wsl.sh`
- [ ] Tạo namespace `realtime` + secret `app-secrets` (xem [`RUNTIME.md` §4](RUNTIME.md))
- [ ] `bash infra/k8s/import-images.sh`
- [ ] `k3s kubectl apply -k infra/k8s/sprint3`
- [ ] Tất cả pod `Running` 1/1: `k3s kubectl -n realtime get pods`
- [ ] Pull Ollama: `k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b`
- [ ] Login dashboard: `http://<WSL_IP>:30809` — `admin@gmail.com` / mật khẩu secret

**Sau khi đổi code**

- [ ] `bash infra/k8s/rebuild-all-dev-images.sh` (hoặc `CLEAN=1` nếu image lỗi)
- [ ] `k3s kubectl -n realtime rollout status deployment/dashboard-ui` (và api nếu cần)

**Kiểm tra nhanh**

- [ ] `curl http://127.0.0.1:31000/health`
- [ ] `curl http://127.0.0.1:32000/health`
- [ ] `curl -X POST .../api/auth/login` → có `token`

---

### D.2. Laptop 2 (Windows) — Web-shop + adapter

- [ ] `cd ..\Simulate_Demo` → `copy .env.example .env`
- [ ] `TRACKING_FORWARD_URL=http://<WSL_IP>:31000/track`
- [ ] `COMMERCE_BACKEND_URL=http://<WSL_IP>:30330`
- [ ] `TRACKING_INGEST_URL=http://<WSL_IP>:31000`
- [ ] `TRACKING_INGEST_API_KEY=` trùng secret k3s
- [ ] `npm install` → `npm run seed` → `npm run dev` (web `:3000`)
- [ ] Terminal 2: `npm run worker`
- [ ] Terminal 3: `npm run adapter`
- [ ] (Tuỳ chọn) Tailscale: `ping lap1`, dùng hostname thay IP

**Kiểm tra**

- [ ] F12 Network: request tới `:31000/track` status 202
- [ ] Đặt đơn test → adapter log ingest accepted
- [ ] Không deploy `commerce-connector` trong k3s (đã bỏ)

---

### D.3. Checklist demo báo cáo (30–45 phút)

**Chuẩn bị (trước khi trình bày)**

- [ ] Lap1 pods all Running; Lap2 dev + worker + adapter chạy
- [ ] Ghi `WSL_IP` lên slide; mở sẵn tab dashboard Overview
- [ ] (Tuỳ chọn) Headlamp: `bash infra/k8s/ops/kubernetes-dashboard/open-headlamp.sh`

**Kịch bản A — Behavior**

1. [ ] Mở web-shop, duyệt trang / xem SP / search
2. [ ] Dashboard **Events** hoặc **Overview** — số event tăng
3. [ ] Chọn period **Tất cả** (`?minutes=0`) → chuyển tab Revenue → period giữ nguyên
4. [ ] (Tuỳ chọn) `k3s kubectl -n realtime logs deploy/tracking-api --tail=20`

**Kịch bản B — Commerce & doanh thu**

5. [ ] Thêm giỏ / checkout trên web-shop
6. [ ] `POST /api/orders` hoặc checkout UI → worker xử lý → `order.completed`
7. [ ] Đợi ~5–10s → **Revenue** / Overview `purchases`, `total_revenue` tăng
8. [ ] Log adapter + streaming-processor (Phụ lục E)

**Kịch bản C — Chatbot**

9. [ ] Login analyst → `/shop/chat`
10. [ ] Hỏi: "Doanh thu 1 giờ qua?" → `data_from: postgresql` trong response (F12)
11. [ ] Admin → Insights (Qdrant) nếu cần minh chứng RAG

**Kịch bản D — Admin / ops**

12. [ ] Admin → System / Pipeline health
13. [ ] Swagger `clients/api-docs` → login 200, thử `/api/overview`
14. [ ] Postgres: `k3s kubectl -n realtime exec deploy/postgres -- psql -U app -d realtime -c '\dt'`

**Ảnh nên có trong Word/PDF:** xem Phụ lục E.

---

## Phụ lục E — Ảnh log và minh chứng (hướng dẫn)

> Repo **không** lưu screenshot (tránh nặng git). Chèn ảnh vào báo cáo Word/PDF sau khi chạy demo. Thư mục gợi ý: `docs/assets/demo/` (tự tạo, không commit nếu team quy định).

### E.1. Danh sách ảnh nên chụp

| STT | Nội dung | Ghi chú |
|-----|----------|---------|
| E-1 | Sơ đồ kiến trúc (từ §3 báo cáo hoặc TECH_STACK) | Export PNG |
| E-2 | `k3s kubectl -n realtime get pods` — all Running | Lap1 |
| E-3 | Web-shop + F12 Network `POST .../track` **202** | Lap2 |
| E-4 | Dashboard **Overview** KPI + period Tất cả | |
| E-5 | Dashboard **Funnel** / **Revenue** | Sau khi mua hàng |
| E-6 | Dashboard **Events** live / recent | |
| E-7 | **Chat** câu hỏi + câu trả lời | |
| E-8 | Admin **Pipeline** / system health | |
| E-9 | Swagger **api-docs** Try it out login 200 | `:5190` |
| E-10 | Headlamp namespace `realtime` (tuỳ chọn) | |
| E-11 | Postgres `\dt` hoặc query `tracking_kpi_1m` | |

### E.2. Lệnh lấy log (WSL — Lap1)

```bash
# Tracking API — ingest SDK / business
k3s kubectl -n realtime logs deploy/tracking-api --tail=50

# Streaming processor — Kafka consume, flush KPI
k3s kubectl -n realtime logs deploy/streaming-processor --tail=50

# Dashboard API — login, chat, analytics
k3s kubectl -n realtime logs deploy/dashboard-api --tail=50
```

**Lap2 — adapter & worker (PowerShell, thư mục `..\Simulate_Demo`):**

```powershell
# Chạy foreground để thấy log trực tiếp:
npm run adapter
npm run worker
```

### E.3. Mẫu log kỳ vọng (minh chứng trong báo cáo)

**tracking-api** — sau `POST /track` hoặc ingest thành công:

```text
POST /track 202 ... 
published event evt_... to tracking_events_raw
```

hoặc ingest:

```text
POST /api/ingest/business-events 202 accepted_count=1
```

**Adapter (Lap2)** — sau `order.completed`:

```text
ingest batch accepted accepted_count=1
POST http://<WSL_IP>:31000/api/ingest/business-events/batch 202
```

**streaming-processor** — consume + flush:

```text
Consumed message ... session_id=sess_...
Flushed KPI window ... purchases=1 revenue=2500000
```

**dashboard-api** — chat:

```text
chat intent=revenue data_from=postgresql
ollama polish skipped | ollama ok
```

*(Nội dung chính xác phụ thuộc phiên bản log — chụp terminal thật khi demo.)*

### E.4. Query Postgres minh chứng dữ liệu

```bash
k3s kubectl -n realtime exec deploy/postgres -- psql -U app -d realtime -c \
  "SELECT event_type, count(*) FROM tracking_events_clean GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"

k3s kubectl -n realtime exec deploy/postgres -- psql -U app -d realtime -c \
  "SELECT window_start, purchases, total_revenue FROM tracking_kpi_1m ORDER BY window_start DESC LIMIT 5;"
```

### E.5. Chú thích ảnh trong luận văn (gợi ý caption)

- *Hình E-2:* Trạng thái triển khai namespace `realtime` trên k3s.  
- *Hình E-3:* SDK gửi behavior event từ web-shop tới tracking-api (HTTP 202).  
- *Hình E-5:* KPI doanh thu sau luồng `order.completed` → `purchase_succeeded`.  
- *Hình E-7:* Chatbot truy vấn số liệu PostgreSQL và trả lời ngôn ngữ tự nhiên.

---

*Phụ lục đồng bộ với codebase: topic `tracking_events_raw`, port NodePort theo [`RUNTIME.md` §5](RUNTIME.md).*
