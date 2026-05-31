# API Reference

Tài liệu HTTP API của pipeline demo (k3s). Chi tiết schema event: [`SPEC.md`](SPEC.md). Port & deploy: [`RUNTIME.md`](RUNTIME.md).

## Trang web (Swagger UI — localhost riêng)

**Không** gắn dashboard UI. Chạy:

```bash
cd clients/api-docs && npm install && npm run dev
```

→ **http://localhost:5190** (OpenAPI + Try it out). `cd clients/api-docs && npm run dev` — proxy WSL IP trong `.env`.

**Base URL (NodePort, thay `<WSL_IP>`):**

| Service | URL mẫu |
|---------|---------|
| dashboard-api | `http://<WSL_IP>:32000` |
| dashboard-ui (proxy `/api`) | `http://<WSL_IP>:30809` |
| tracking-api | `http://<WSL_IP>:31000` |
| commerce-backend | `http://<WSL_IP>:30330` |

**Content-Type:** `application/json` (trừ SSE).

---

## Xác thực

| API | Cách xác thực |
|-----|----------------|
| Dashboard — public | `POST /api/auth/login` (không cần token) |
| Dashboard — protected | `Authorization: Bearer <JWT>` |
| Dashboard — SSE | `GET /api/events/stream?token=<JWT>` (EventSource không gửi header) |
| Tracking ingest | `Authorization: Bearer <TRACKING_INGEST_API_KEY>` |
| Tracking `/track` | **Không** API key (SDK công khai; chỉ validate schema) |
| commerce-backend | **Không** auth (demo nội bộ) |

**Role JWT (`dashboard_users.role`):**

| Role | Quyền API |
|------|-----------|
| `analyst`, `viewer` | Shop analytics + chat (`/api/overview`, `/api/chat`, …) |
| `super_admin` | Thêm admin: `/api/system/*`, `/api/users`, `/api/chat/insights` |

---

## Tham số kỳ analytics (chung)

Dùng trên hầu hết `GET` shop analytics:

| Query | Mô tả |
|-------|--------|
| `minutes` | Cửa sổ trượt (phút). `0` hoặc `all` = toàn bộ dữ liệu. Mặc định từng route (30–60). Max 43 200 (30 ngày). |
| `date` | Một ngày lịch `YYYY-MM-DD` (UTC). **Ưu tiên** hơn `minutes` nếu có cả hai. |

Response thường kèm:

```json
{
  "period": { "type": "rolling", "minutes": 60, "label": "60 phút gần đây" }
}
```

hoặc `"type": "day", "date": "2026-05-30", ...`.

---

## dashboard-api

### Health

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | Không |

```json
{ "status": "ok", "service": "dashboard-api", "postgres": "ok" }
```

### Auth

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/auth/login` | Không | `{ "email", "password" }` |
| GET | `/api/auth/me` | JWT | — |
| PATCH | `/api/auth/change-password` | JWT | `{ "current_password", "new_password" }` (≥ 6 ký tự) |

**Login 200:**

```json
{
  "token": "<jwt>",
  "user": { "id": "uuid", "email": "...", "display_name": "...", "role": "analyst" }
}
```

### Shop analytics (`analyst` | `viewer` | `super_admin`)

| Method | Path | Query ghi chú |
|--------|------|----------------|
| GET | `/api/overview` | `minutes` (default 30) hoặc `date` |
| GET | `/api/funnel` | default `minutes=60` |
| GET | `/api/products/top` | `limit` (max 50), period |
| GET | `/api/products/anomalies` | SP xem nhiều, 0 mua |
| GET | `/api/revenue/summary` | |
| GET | `/api/revenue/by-category` | |
| GET | `/api/banners` | |
| GET | `/api/search/top` | `limit` (max 50) |
| GET | `/api/search/filters` | |
| GET | `/api/events/recent` | `limit` (max 200) |
| GET | `/api/events/stream` | `token` (JWT) — SSE |

**`/api/overview` 200 (rút gọn):**

```json
{
  "period": { ... },
  "kpi": {
    "total_events", "page_views", "product_views", "clicks", "searches",
    "add_to_cart", "remove_from_cart", "checkout_start", "purchases",
    "unique_sessions", "conversion_rate", "total_revenue"
  },
  "trend": [{ "window_start", "page_views", "purchases", "revenue", ... }]
}
```

**`/api/funnel` 200:**

```json
{
  "period": { ... },
  "funnel": [
    { "step": "page_view", "count": 100, "drop_off_rate": 0 },
    { "step": "product_view", "count": 80, "drop_off_rate": 0.2 }
  ]
}
```

**SSE `/api/events/stream`:** events `events` (mảng event mới), `kpi` (tick refresh), `ping` mỗi 15s.

### Chat (`analyst` | `super_admin`)

| Method | Path | Body / ghi chú |
|--------|------|----------------|
| POST | `/api/chat` | `{ "message", "minutes?", "date?", "session_id?" }` |
| GET | `/api/chat/sessions` | Danh sách session của user |
| POST | `/api/chat/sessions` | Tạo session mới → `201` |
| GET | `/api/chat/sessions/:sessionId/messages` | |
| DELETE | `/api/chat/sessions/:sessionId` | |

**POST `/api/chat` 200 (rút gọn):**

```json
{
  "answer": "markdown text",
  "intent": "revenue",
  "data_from": "postgresql",
  "session_id": "chat_...",
  "actions": []
}
```

### Admin (`super_admin` only)

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/system/pipeline` | Health stack + metrics ingest/KPI |
| GET | `/api/system/setup` | Gợi ý port, env web-shop |
| GET | `/api/chat/insights` | Insight gần đây từ Qdrant (`limit` max 30) |
| GET | `/api/users` | |
| POST | `/api/users` | `{ "email", "password", "display_name?", "role?" }` |
| PATCH | `/api/users/:id` | `{ "display_name?", "role?", "is_active?", "password?" }` |
| DELETE | `/api/users/:id` | Soft-disable (`is_active=false`) |

---

## tracking-api

### Health

| Method | Path |
|--------|------|
| GET | `/health` |

### Behavior SDK (public)

| Method | Path | Body |
|--------|------|------|
| POST | `/track` | Một event object |
| POST | `/track/batch` | `{ "events": [ ... ] }` |

**Trường bắt buộc / chính:** `event_id`, `event_type`, `event_time` (ISO), `event_source`, `event_category` (`behavior` | `commerce`), `session_id`; tùy loại: `product_id`, `metadata`.

**`event_type` behavior:** `page_view`, `product_view`, `product_click`, `scroll_depth`, `search`, `filter_apply`, `banner_impression`, `banner_click`.

**`event_type` commerce:** `add_to_cart`, `remove_from_cart`, `checkout_start`, `purchase_succeeded`, `payment_failed`, `cart_abandoned`, `order_cancelled`.

**`event_source` hợp lệ:** `browser_sdk`, `commerce_backend_rabbitmq`, `web_demo_backend`, `web_demo_worker`, `web_demo_api`, `rabbitmq_adapter`.

**202:**

```json
{ "accepted": true, "event_id": "..." }
```

**400:** `{ "error": "validation_failed", "details": ["..."] }`

### Business ingest (Bearer key)

| Method | Path |
|--------|------|
| POST | `/api/ingest/business-events` |
| POST | `/api/ingest/business-events/batch` |

Body: một event hoặc `{ "events": [ ... ] }` (canonical business schema).

**`event_type`:** `order.created`, `order.completed`, `order.cancelled`, `order.processing`, `payment.*`, `inventory.*`.

**202 / 207:**

```json
{
  "success": true,
  "accepted_count": 1,
  "duplicate_count": 0,
  "rejected_count": 0,
  "batch_id": "batch_..."
}
```

**401:** thiếu/sai Bearer. **503:** `business_ingest_disabled` (không cấu hình key).

`order.completed` được map sang tracking `purchase_succeeded` trước khi vào Kafka.

---

## commerce-backend

Demo commerce → RabbitMQ (không auth).

### Health

| GET | `/health` |

### Orders (Integration Guide)

| Method | Path | Body chính |
|--------|------|------------|
| POST | `/api/orders` | `anonymousId`, `sessionId`, `items[]` |
| POST | `/api/orders/:orderCode/cancel` | `reason?` |

**201 order:** `{ "orderCode", "status", "totalAmount" }`

### Commerce events (shortcut)

| Method | Path |
|--------|------|
| POST | `/commerce/add-to-cart` |
| POST | `/commerce/checkout-start` |
| POST | `/commerce/purchase` |
| POST | `/commerce/payment-failed` |
| POST | `/commerce/cart-abandoned` |

Body: `anonymous_id`, `session_id`, (+ `product_id` cho add-to-cart). **202** `{ "accepted": true }`.

---

## Mã lỗi thường gặp

| HTTP | `error` | Ý nghĩa |
|------|---------|---------|
| 400 | `missing_fields`, `validation_failed`, `message_required` | Thiếu/sai input |
| 401 | `unauthorized`, `invalid_credentials`, `invalid_token` | Auth |
| 403 | `forbidden` (+ `hint`: `admin_only`, `analyst_only`, …) | Sai role |
| 404 | `not_found`, `session_not_found` | |
| 409 | `email_exists`, `order_not_cancellable` | |
| 500 | `query_failed`, `chat_failed`, … | Lỗi server |
| 503 | `kafka_unavailable`, `postgres: unavailable` | Dependency |

---

## Ví dụ curl

```bash
# Login
curl -s -X POST "http://127.0.0.1:32000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gmail.com","password":"YOUR_PASSWORD"}'

# Overview (thay TOKEN)
curl -s "http://127.0.0.1:32000/api/overview?minutes=60" \
  -H "Authorization: Bearer TOKEN"

# Một ngày cụ thể
curl -s "http://127.0.0.1:32000/api/overview?date=2026-05-30" \
  -H "Authorization: Bearer TOKEN"

# Track (SDK)
curl -s -X POST "http://127.0.0.1:31000/track" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id":"evt_demo_1",
    "event_time":"2026-05-30T08:00:00.000Z",
    "event_source":"browser_sdk",
    "event_category":"behavior",
    "event_type":"page_view",
    "session_id":"sess_demo",
    "anonymous_id":"anon_demo",
    "page_url":"/"
  }'

# Business ingest
curl -s -X POST "http://127.0.0.1:31000/api/ingest/business-events" \
  -H "Authorization: Bearer YOUR_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d @business-event.json
```

---

## Luồng gọi (tóm tắt)

```text
Web-shop SDK ──────────────► POST /track (tracking-api :31000)
Lap2 adapter ─────────────► POST /api/ingest/business-events (Bearer)
Commerce / web-shop ──────► POST /api/orders | /commerce/* (:30330) → RabbitMQ → adapter → ingest

Dashboard UI ───────────────► /api/* + JWT (qua :30809 proxy hoặc :32000 dev)
```

---

*Tài liệu sinh từ source `services/*/src/routes/`. Khi đổi route, cập nhật file này hoặc mở issue sync với code.*
