# tracking-rabbitmq-adapter

RabbitMQ Adapter (Adapter Integration Standard) — chạy **cạnh Web Demo** (Windows local), không trong k3s.

- Consume `tracking.adapter.business-events`
- Normalize → `POST /api/ingest/business-events/batch` (Tailscale → Tracking API trên k3s)

```powershell
cd services\tracking-rabbitmq-adapter
copy .env.example .env
# Sửa RABBITMQ_URL, TRACKING_BACKEND_INGEST_URL, TRACKING_INGEST_API_KEY
npm install
npm start
```

Chạy cùng web-shop: `npm run worker` (web-demo-worker) trước hoặc sau adapter.
