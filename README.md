# Business Data Streaming — Processing Pipeline

Realtime e-commerce **behavior tracking** demo: SDK → Tracking API → Kafka → (streaming) → PostgreSQL.

## Stack

- Postgres schema: `infra/postgres/`
- **Tracking API:** `services/tracking-api` — `POST /track`, `POST /track/batch`
- **Browser SDK:** `sdk/browser-behavior-sdk`
- **Web shop:** `clients/web-shop` (submodule)
- **Streaming Processor:** `services/streaming-processor` → Postgres + Qdrant insights
- **Dashboard:** `services/dashboard-api` + `clients/dashboard`
- **Runtime:** **k3s** on WSL2 — `infra/k8s/sprint3`

**Runtime:** [`docs/RUNTIME.md`](docs/RUNTIME.md) · Spec: [`docs/PROJECT.md`](docs/PROJECT.md) · Map: [`docs/REPO_MAP.md`](docs/REPO_MAP.md) · Ports: [`infra/PORTS.md`](infra/PORTS.md)

## Quick start (k3s on WSL2)

1. **Ubuntu WSL** — từ root repo:

```bash
cp infra/.env.example infra/.env
# Sửa POSTGRES_PASSWORD, WSL_IP, VITE_* trong infra/.env

bash infra/k8s/install-k3s-wsl.sh          # once
bash infra/k8s/import-images-sprint3.sh
# Tạo secret app-secrets — xem infra/k8s/README.md (POSTGRES_*, JWT_*, DASHBOARD_ADMIN_*)

k3s kubectl apply -k infra/k8s/sprint3
k3s kubectl -n realtime get pods
```

2. **URLs** (thay `<WSL_IP>` = `hostname -I`):

| Service | URL |
|---------|-----|
| Dashboard UI | http://`<WSL_IP>`:30809 |
| Tracking API | http://`<WSL_IP>`:31000/health |
| Dashboard API | http://`<WSL_IP>`:32000/health |

3. **Web shop** (Windows):

```bash
cd clients/web-shop
copy .env.example .env
npm install && npm run seed && npm run dev
# TRACKING_FORWARD_URL trong clients/web-shop/.env → http://<WSL_IP>:31000/track
# → http://localhost:3000
```

Chi tiết: [`infra/k8s/README.md`](infra/k8s/README.md)

## Test ingest

```bash
curl -s -X POST "http://<WSL_IP>:31000/track" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"page_view","anonymous_id":"anon_test","session_id":"sess_test","page_url":"/"}'
```

## Local dev (API hot reload)

Backend vẫn trên k3s; chỉ chạy service riêng lẻ khi debug:

```bash
cd services/tracking-api && npm install && npm run dev
# Trỏ web-shop tạm tới http://localhost:31000/track qua TRACKING_FORWARD_URL
```

## Legacy Docker Compose

Không dùng cho triển khai. File `infra/docker-compose.yml` giữ để tham khảo / build image cũ.
