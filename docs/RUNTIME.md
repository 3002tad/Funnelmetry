# Runtime — cách chạy project (k3s)

Nguồn chân lý deploy. Spec kỹ thuật: [SPEC.md](SPEC.md) · Map repo: [REPO_MAP.md](REPO_MAP.md).

## 1. Yêu cầu

- Windows + **WSL2 Ubuntu**
- **Docker Desktop** (build image, WSL integration)
- **Git**

## 2. Clone & cấu hình

```bash
git clone https://github.com/3002tad/Business-Data-Streaming---Processing-Pipeline.git
cd Business-Data-Streaming---Processing-Pipeline
git submodule update --init --recursive

cp infra/.env.example infra/.env
# Sửa POSTGRES_PASSWORD, WSL_IP, VITE_* (WSL_IP = hostname -I trong WSL)
```

## 3. Cài k3s (lần đầu, trong WSL)

```bash
bash infra/k8s/install-k3s-wsl.sh
k3s kubectl get nodes
```

Script lỗi `$'\r'`: `sed -i 's/\r$//' infra/k8s/*.sh && chmod +x infra/k8s/*.sh`

## 4. Secret + deploy

```bash
k3s kubectl create namespace realtime --dry-run=client -o yaml | k3s kubectl apply -f -

k3s kubectl -n realtime create secret generic app-secrets \
  --from-literal=POSTGRES_DB=realtime \
  --from-literal=POSTGRES_USER=app \
  --from-literal=POSTGRES_PASSWORD='change-me' \
  --from-literal=JWT_SECRET='change-me-use-long-random-string' \
  --from-literal=DASHBOARD_ADMIN_EMAIL='admin@pipeline.local' \
  --from-literal=DASHBOARD_ADMIN_PASSWORD='admin123' \
  --from-literal=RABBITMQ_URL='amqp://app:app@rabbitmq:5672' \
  --from-literal=RABBITMQ_USER='app' \
  --from-literal=RABBITMQ_PASS='app' \
  --dry-run=client -o yaml | k3s kubectl apply -f -

bash infra/k8s/import-images.sh
k3s kubectl apply -k infra/k8s/sprint3
k3s kubectl -n realtime get pods -w
```

Ollama (chat, lần đầu): `k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b`

Sau `git pull`: `bash infra/k8s/rebuild-all-dev-images.sh`

## 5. URL truy cập

`WSL_IP` = `hostname -I | awk '{print $1}'` (dùng từ Windows/Laptop 2, không dùng `localhost` cho NodePort).

| Dịch vụ | URL |
|---------|-----|
| Dashboard UI | `http://<WSL_IP>:30809` |
| Tracking API | `http://<WSL_IP>:31000` |
| Commerce backend | `http://<WSL_IP>:30330` |

**Đăng nhập dashboard:** `admin@pipeline.local` / `admin123` (Admin) — tạo tài khoản Analytic trong Admin → Tài khoản.

## 6. Luồng event

```text
Web-shop + SDK → tracking-api → Kafka → streaming-processor → PostgreSQL + Qdrant
                                                      ↓
                                            dashboard-api / dashboard-ui
```

Commerce (`purchase_succeeded`, …): `commerce-backend` → RabbitMQ → `commerce-connector` → `tracking-api`.

## 7. Laptop 2 — web-shop gửi event

Trên **Windows** (submodule `clients/web-shop`):

```powershell
cd clients\web-shop
copy .env.example .env
npm install
npm run seed
npm run dev
```

`clients/web-shop/.env`:

```env
TRACKING_FORWARD_URL=http://<WSL_IP>:31000/track
COMMERCE_BACKEND_URL=http://<WSL_IP>:30330
```

Tailscale (nếu dùng hostname `lap1`): `ping lap1` từ Laptop 2.

Test ingest:

```bash
curl -s -X POST "http://<WSL_IP>:31000/track" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"page_view","anonymous_id":"t1","session_id":"s1","page_url":"/"}'
```

| Lỗi | Cách sửa |
|-----|----------|
| CORS | Thêm origin vào CORS tracking-api, restart pod |
| Connection refused | Kiểm tra `k3s kubectl -n realtime get pods`, WSL_IP đúng |
| Dashboard forbidden | Role `super_admin` vs `analyst`; đăng xuất + login lại |

## 8. Mạng demo (2 laptop)

| Máy | Vai trò |
|-----|---------|
| **Laptop 1 (WSL2)** | k3s full stack |
| **Laptop 2 (Windows)** | Web-shop + bot (tuỳ chọn) |
| **Server** (tuỳ chọn) | Headscale + DERP |

SDK trên Laptop 2 gửi event qua tailnet / WSL IP về tracking-api Laptop 1. Chi tiết Headscale: xem phần mạng trong [SPEC.md](SPEC.md) hoặc ghi chú team.

## 9. Chatbot (Ollama trong k3s)

```text
/shop/chat → dashboard-api → Postgres (số thật) + Qdrant (RAG) → Ollama qwen2.5:3b
```

- Service: `http://ollama:11434` (trong cluster)
- Code: `services/dashboard-api/src/lib/chat/`
- Không dùng Ollama trên Windows host

```bash
k3s kubectl -n realtime exec deploy/ollama -- ollama list
```

## 10. Pods (namespace `realtime`)

| Pod | Vai trò |
|-----|---------|
| postgres, kafka | Data + queue |
| tracking-api | Ingest HTTP |
| streaming-processor | Kafka → Postgres + Qdrant |
| dashboard-api, dashboard-ui | API + UI |
| rabbitmq, commerce-backend, commerce-connector | Commerce path |
| qdrant, ollama | RAG + LLM |

## 11. Role dashboard

| Role DB | UI |
|---------|-----|
| `super_admin` | `/admin` — pipeline, tài khoản, K8s guide |
| `analyst` | `/shop` — analytics, chat |
