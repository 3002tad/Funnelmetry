# @funnelmetry/source-ingress

Thư mục này giữ source code migration của Edge Relay cũ, nhưng runtime hiện là
**Source Ingress + Durable Event Log + Authenticated Event Feed API**. Nó không
canonicalize event, không biết Pipeline host và tuyệt đối không push/retry POST
sang Pipeline. Browser SDK và Medusa Backend Adapter chỉ nhận `accepted` sau
khi event đã được durable-persist cùng Source-owned `event_feed_id` và
`ingress_seq`.

## Runtime tối thiểu

Source Ingress yêu cầu Node 22+ vì dùng `node:sqlite`. Chạy local với biến môi
trường trong `infra/.env`:

```powershell
cd apps/edge-relay
npm install
npm start
```

Ví dụ cấu hình development không chứa secret thật:

```env
SOURCE_INGRESS_BROWSER_KEYS_JSON={"medusa-reference-source":{"source_id":"medusa-reference","secret":"change-me","allowed_origins":["http://localhost:8000"]}}
SOURCE_INGRESS_BACKEND_KEYS_JSON={"medusa-reference-source":{"source_id":"medusa-reference","secret":"change-me-backend"}}
SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON={"local-connector":"change-me-read-token"}
SOURCE_INGRESS_DATABASE_PATH=./data/funnelmetry-source-event-log.sqlite
```

Producer endpoint giữ tương thích trong giai đoạn migration:

```text
POST /v1/ingress/events
```

Pipeline pull endpoint:

```text
GET /v1/events?after_seq=<N>&limit=<BATCH>&wait=<SECONDS>
Authorization: Bearer <SOURCE_EVENT_FEED_TOKEN>
```

`after_seq` chỉ thuộc `event_feed_id` được trả trong response. Event Feed trả
record theo `ingress_seq` tăng dần, có thể có integer gap; `next_after_seq` là
sequence của record cuối response, không phải `after_seq + count`.

`/healthz` và `/readyz` có thể public qua health check. `/status` và
`/metrics` chỉ bật khi `SOURCE_INGRESS_ADMIN_TOKEN` được cấu hình, với header
`x-funnelmetry-admin-token`. Event Feed không được public anonymously.
