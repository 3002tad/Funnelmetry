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
  --from-literal=TRACKING_INGEST_API_KEY='demo-ingest-key-change-me' \
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

**Behavior (SDK):**

```text
Web-shop + tracking.js → tracking-api → Kafka → streaming-processor → PostgreSQL + Qdrant
```

**Business (RabbitMQ Adapter Standard — Windows + K8s + Tailscale):**

```text
[Laptop 2] Web-shop API → RabbitMQ (ecommerce.events)
              ├→ webdemo.order-processing → web-demo-worker (k3s hoặc local)
              └→ tracking.adapter.business-events → tracking-rabbitmq-adapter (Laptop 2)
                        → POST /api/ingest/business-events/batch (Tailscale/WSL_IP)
[Laptop 1] tracking-api → Kafka → streaming-processor → PostgreSQL
```

- **Tracking API không consume RabbitMQ** — chỉ Adapter gọi HTTPS ingest.
- Doanh thu / đơn: `order.completed`; hủy: `order.cancelled` (server-side).
- Chi tiết: `docs/RabbitMQ_Adapter_Integration_Standard_Windows_K8s_Tailscale.docx`

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

Test ingest (behavior):

```bash
curl -s -X POST "http://<WSL_IP>:31000/track" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"page_view","anonymous_id":"t1","session_id":"s1","page_url":"/"}'
```

Test order → RabbitMQ (business):

```bash
curl -s -X POST "http://<WSL_IP>:30330/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"anonymousId":"a1","sessionId":"s1","paymentMethod":"cod","items":[{"productId":"P001","name":"Demo","price":100000,"quantity":1}]}'
```

## 7b. Laptop 2 — RabbitMQ Adapter (bắt buộc cho business events)

Adapter chạy trên **Windows**, không deploy trong k3s.

```powershell
cd services\tracking-rabbitmq-adapter
copy .env.example .env
# RABBITMQ_URL: broker local hoặc amqp://app:app@<WSL_IP>:5672 (nếu port-forward RabbitMQ từ k3s)
# TRACKING_BACKEND_INGEST_URL=http://<WSL_IP>:31000/api/ingest/business-events/batch
# TRACKING_INGEST_API_KEY= trùng secret TRACKING_INGEST_API_KEY trên cluster
npm install
npm start
```

Worker (nếu RabbitMQ trên k3s, chạy worker trên WSL hoặc cùng broker):

```bash
# Trong WSL — web-demo-worker đã deploy trên k3s; hoặc local:
cd services/web-demo-worker && npm install && npm start
```

Test hủy đơn:

```bash
curl -X POST "http://<WSL_IP>:30330/api/orders/ORDER-xxx/cancel" -H "Content-Type: application/json" -d '{"reason":"user_cancelled"}'
```

Port-forward RabbitMQ từ k3s (nếu chưa có RabbitMQ local):

```bash
k3s kubectl -n realtime port-forward svc/rabbitmq 5672:5672
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
| rabbitmq, commerce-backend, web-demo-worker | RabbitMQ broker + order API/worker (k3s) |
| *(Laptop 2)* tracking-rabbitmq-adapter | Consume adapter queue → ingest API |
| qdrant, ollama | RAG + LLM |

## 11. Role dashboard

| Role DB | UI |
|---------|-----|
| `super_admin` | `/admin` — pipeline, tài khoản, K8s guide |
| `analyst` | `/shop` — analytics, chat |

## 12. Tắt / giảm tải (khi không demo)

Stack chạy nền tốn **RAM/CPU** (đặc biệt Kafka, Postgres, Ollama). Chọn mức phù hợp:

### Mức 1 — Tạm dừng pod (nhẹ máy, **giữ data**)

Pod tắt, PVC/secret vẫn còn — bật lại nhanh, không mất DB.

```bash
# Tắt hết app trong namespace realtime
k3s kubectl -n realtime scale deploy --all --replicas=0

# Kiểm tra (chỉ còn Completed hoặc rỗng)
k3s kubectl -n realtime get pods
```

Bật lại:

```bash
k3s kubectl -n realtime scale deploy --all --replicas=1
# Đợi pod Running (~1–3 phút)
k3s kubectl -n realtime get pods -w
```

Chỉ tắt phần nặng (Ollama + Kafka) khi vẫn cần dashboard nhẹ:

```bash
k3s kubectl -n realtime scale deploy/ollama deploy/kafka --replicas=0
```

### Mức 2 — Dừng dịch vụ k3s (hết tải WSL)

Cluster không chạy; **data trên disk vẫn giữ** (thường trong `/var/lib/rancher/k3s`).

```bash
sudo systemctl stop k3s
# hoặc: sudo service k3s stop
```

Bật lại:

```bash
sudo systemctl start k3s
k3s kubectl get nodes
k3s kubectl -n realtime get pods
# Nếu pod chưa lên: scale deploy --replicas=1 hoặc apply lại sprint3
```

### Mức 3 — Gỡ stack khỏi cluster (vẫn còn k3s)

Xóa manifest sprint3; PVC có thể còn tùy resource.

```bash
k3s kubectl delete -k infra/k8s/sprint3
```

Deploy lại khi cần: làm lại mục **§4** (`import-images.sh` + `apply -k sprint3`).

### Mức 4 — Gỡ hẳn k3s (máy nhẹ nhất)

**Mất cluster local** — chỉ dùng khi không cần backend trên máy này nữa.

```bash
sudo systemctl stop k3s
sudo /usr/local/bin/k3s-uninstall.sh
# Nếu có agent: sudo /usr/local/bin/k3s-agent-uninstall.sh
```

Cài lại: `bash infra/k8s/install-k3s-wsl.sh` rồi deploy từ đầu (§4).

### Thêm trên Windows

- Tắt **Docker Desktop** khi không build image (`import-images.sh`).
- Đóng terminal đang chạy `port-forward-*.sh` (`Ctrl+C`).
- Web-shop `npm run dev` — `Ctrl+C` khi không gửi event.

| Mục tiêu | Nên dùng |
|----------|----------|
| Nghỉ vài giờ, mai chạy tiếp | Mức 1 |
| Nghỉ vài ngày, máy vẫn bị nặng | Mức 2 |
| Dọn sạch stack, giữ k3s | Mức 3 |
| Không dùng k3s trên máy này | Mức 4 |
