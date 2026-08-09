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

cp infra/.env.example infra/.env
cd infra && npm install
# Sửa POSTGRES_PASSWORD, WSL_IP, VITE_*, TRACKING_INGEST_API_KEY (WSL_IP = hostname -I trong WSL)
# Một file infra/.env cho pipeline (k3s + services local). Web-shop Lap2: ../Simulate_Demo/.env riêng.
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
  --from-literal=DASHBOARD_ADMIN_EMAIL='admin@gmail.com' \
  --from-literal=DASHBOARD_ADMIN_PASSWORD='admin@123' \
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

Sau `git pull` / đổi code service:

```bash
bash infra/k8s/rebuild-all-dev-images.sh
```

Image lẫn layer / pod crash sau rebuild — **xóa sạch rồi import lại** (ổn định hơn pipe `docker save | sudo`):

```bash
CLEAN=1 bash infra/k8s/rebuild-all-dev-images.sh
```

Chỉ xóa pod lỗi, giữ pod cũ đang chạy (nhanh, không rebuild):

```bash
k3s kubectl -n realtime delete pod -l app=tracking-api --field-selector=status.phase!=Running
```

## 5. URL & port

`WSL_IP` = `hostname -I | awk '{print $1}'` (dùng từ Windows/Laptop 2, không dùng `localhost` cho NodePort). Cập nhật `WSL_IP` / `VITE_*` trong `infra/.env`.

### NodePort (từ Windows / Laptop 2)

| Dịch vụ | NodePort | URL |
|---------|----------|-----|
| tracking-api | **31000** | `http://<WSL_IP>:31000` — SDK `POST /track` |
| commerce-backend | **30330** | `http://<WSL_IP>:30330` |
| dashboard-api | **32000** | `http://<WSL_IP>:32000` |
| dashboard-ui | **30809** | `http://<WSL_IP>:30809` — proxy `/api/` |
| api-docs (Swagger) | **5190** | `http://localhost:5190` — `clients/api-docs`, Lap2 only |
| web-shop dev | **3000** | `http://localhost:3000` — Lap2 |

**Tailnet:** `http://lap1:31000`, `http://lap1:30330`, `http://lap1:30809` (nếu Tailscale trên WSL).

### ClusterIP (trong cluster)

| Dịch vụ | Port |
|---------|------|
| kafka | 9092 |
| postgres | 5432 |
| qdrant | 6333 |
| ollama | 11434 (`http://ollama:11434`, PVC `ollama-data` 10Gi) |
| rabbitmq | 5672 (AMQP) |

**Port-forward:** `infra/k8s/port-forward-tracking.sh` → `:31000`; `port-forward-dashboard.sh` → UI `:8090`.

Luôn `kubectl apply -k infra/k8s/sprint3` — không apply riêng `sprint1` (mất NodePort tracking).

**Đăng nhập dashboard:** `admin@gmail.com` / `admin@123` (Admin) — tạo tài khoản Analytic trong Admin → Tài khoản.

**Không đăng nhập được?**

1. Mở UI đúng URL: `http://<WSL_IP>:30809` (F12 → Network: `POST /api/auth/login` phải **200**, không 401/502).
2. Postgres cũ có thể còn user/mật khẩu lần deploy trước — `dashboard-api` **đồng bộ lại** email/mật khẩu từ secret `DASHBOARD_ADMIN_*` mỗi lần start (cần **rebuild + restart** pod sau khi pull code mới).
3. Kiểm tra nhanh (WSL):

```bash
curl -s -X POST "http://127.0.0.1:32000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gmail.com","password":"admin@123"}'
```

Kết quả có `"token"` là API OK; UI lỗi thì xem proxy/nginx.

**`invalid_credentials` — sửa nhanh (WSL):**

```bash
# 1) Secret có đúng email/mật khẩu không?
k3s kubectl -n realtime get secret app-secrets -o jsonpath='{.data.DASHBOARD_ADMIN_EMAIL}' | base64 -d; echo
k3s kubectl -n realtime get secret app-secrets -o jsonpath='{.data.DASHBOARD_ADMIN_PASSWORD}' | base64 -d; echo

# 2) User hiện trong DB
k3s kubectl -n realtime exec deploy/postgres -- psql -U app -d realtime -c \
  "SELECT email, role, is_active FROM dashboard_users;"

# 3) Rebuild dashboard-api (code seed mới) + sync admin
bash infra/k8s/rebuild-all-dev-images.sh
k3s kubectl -n realtime rollout restart deployment/dashboard-api
k3s kubectl -n realtime rollout status deployment/dashboard-api --timeout=120s
k3s kubectl -n realtime exec deploy/dashboard-api -- node scripts/sync-admin.mjs

# 4) Thử lại login
curl -s -X POST "http://127.0.0.1:32000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gmail.com","password":"admin@123"}'
```

Nếu bước 3 báo `scripts/sync-admin.mjs` không tồn tại → image chưa rebuild. Cách tạm **không rebuild**: xóa user cũ, restart (pod cũ seed lại nếu bảng trống):

```bash
k3s kubectl -n realtime exec deploy/postgres -- psql -U app -d realtime -c "DELETE FROM dashboard_users;"
k3s kubectl -n realtime rollout restart deployment/dashboard-api
sleep 15
# curl login lại
```

Vẫn lỗi: `DELETE_PVC=1 bash infra/k8s/fresh-deploy.sh`

## 6. Luồng event

**Behavior (SDK):**

```text
Web-shop + tracking.js → tracking-api → Kafka → streaming-processor → PostgreSQL + Qdrant
```

**Business (RabbitMQ Adapter Standard — Windows + K8s + Tailscale):**

```text
[Laptop 2] Web-shop API → RabbitMQ (ecommerce.events)
              ├→ webdemo.order-processing → web-shop worker (Lap2: npm run worker)
              └→ tracking.adapter.business-events → web-shop adapter (Laptop 2: npm run adapter)
                        → POST /api/ingest/business-events/batch (Tailscale/WSL_IP)
[Laptop 1] tracking-api → Kafka → streaming-processor → PostgreSQL
```

- **Tracking API không consume RabbitMQ** — chỉ Adapter gọi HTTPS ingest.
- Doanh thu / đơn: `order.completed` → Kafka `purchase_succeeded` (metadata `total_amount` / `amount`).
- Hủy: `order.cancelled` (server-side).
- Chi tiết phía nguồn mô phỏng: [LAP2 Integration Guide](../../Simulate_Demo/md/LAP2_INTEGRATION_GUIDE.md)

**Doanh thu dashboard “chậm ~30s” sau khi mua hàng?**

| Bước | Độ trễ | Ghi chú |
|------|--------|---------|
| Lap2 worker + adapter → tracking-api | ~vài giây | Log `202 accepted` = ingest OK |
| Kafka → streaming-processor | vài trăm ms | |
| **KPI flush Postgres** | **`FLUSH_INTERVAL_SEC` (mặc định 5s)** + snapshot phút đang mở | UPSERT `tracking_kpi_1m` mỗi chu kỳ flush (không chờ hết phút) |
| Dashboard SSE `kpi` | ~2s | `event-poller` mỗi 2s; UI `useOnKpiUpdate` refresh |

**Tổng cảm giác sau checkout:** thường **~5–10s** (Kafka + aggregate + flush + SSE), không còn chờ tới phút kế tiếp.

Adapter prefetch >1 có thể đảo thứ tự ingest; **không ảnh hưởng tổng doanh thu** nếu chỉ tính `order.completed`. Cần thứ tự tuyệt đối: `RABBITMQ_ADAPTER_PREFETCH=1` trên Lap2.

Sau đổi `FLUSH_INTERVAL_SEC`, rebuild: `bash infra/k8s/rebuild-all-dev-images.sh` + restart `streaming-processor`.

**Chatbot kẹt “Đang phân tích…”:** thường do **Ollama** (model chưa pull hoặc chậm). Trên Lap1:

```bash
k3s kubectl -n realtime get pods -l app=ollama
k3s kubectl -n realtime exec deploy/ollama -- ollama list
# nếu thiếu model:
k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b
k3s kubectl rollout restart deployment/dashboard-api -n realtime
```

Nếu Ollama down, API vẫn trả lời bằng **template** (vài giây). Rebuild `dashboard-api` + `dashboard-ui` sau khi sửa timeout chat.

## 7. Laptop 2 — web-shop gửi event

Trên **Windows** (repository cùng workspace `../Simulate_Demo`):

```powershell
cd ..\Simulate_Demo
copy .env.example .env
npm install
npm run seed
npm run dev
```

Một file `.env` ở thư mục gốc web-shop cho cả `dev`, `worker`, `adapter` (không cần `tracking-adapter\.env`).

`../Simulate_Demo/.env` (tóm tắt):

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

**Dashboard Banner trống?** Cần `banner_impression` / `banner_click`. Id banner lấy từ `metadata.banner_id`, hoặc fallback `metadata.name` / `banner_name` (web-shop hay gửi `name` thay vì `banner_id`). Rebuild `dashboard-api` sau khi đổi query. Trên web-shop: `data-banner-id` + `initBannerTracking()` — [`sdk/browser-behavior-sdk`](../sdk/browser-behavior-sdk/).

Test banner nhanh:

```bash
curl -s -X POST "http://<WSL_IP>:31000/track" -H "Content-Type: application/json" -d '{
  "event_type":"banner_impression","anonymous_id":"t1","session_id":"s1","page_url":"/",
  "metadata":{"banner_id":"hero_home_top","position":"homepage_hero"}
}'
```

Test order → RabbitMQ (business):

```bash
curl -s -X POST "http://<WSL_IP>:30330/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"anonymousId":"a1","sessionId":"s1","paymentMethod":"cod","items":[{"productId":"P001","name":"Demo","price":100000,"quantity":1}]}'
```

## 7b. Laptop 2 — RabbitMQ Adapter (bắt buộc cho business events)

Adapter nằm trong web-shop (`npm run adapter`), dùng **cùng** `.env` ở §7. Cấu hình ingest:

```env
TRACKING_INGEST_URL=http://<WSL_IP hoặc lap1>:31000
TRACKING_INGEST_PATH=/api/ingest/business-events
TRACKING_INGEST_API_KEY=   # trùng secret k3s TRACKING_INGEST_API_KEY
```

```powershell
cd ..\Simulate_Demo
npm run adapter
```

Worker (bắt buộc trên Lap2, cùng RabbitMQ web-shop):

```powershell
cd ..\Simulate_Demo
npm run worker
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
| `commerce-connector` CrashLoopBackOff | Deployment cũ — **xóa**: `k3s kubectl -n realtime delete deploy commerce-connector`. Business events qua Adapter trên Laptop 2, không chạy connector trong k3s. |
| `tracking-api` CreateContainerConfigError | Secret thiếu key: `k3s kubectl -n realtime patch secret app-secrets --type merge -p '{"stringData":{"TRACKING_INGEST_API_KEY":"demo-ingest-key-change-me"}}'` rồi restart pod tracking-api. |
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

**Lịch sử chat (PostgreSQL):** mỗi tin nhắn được lưu theo `dashboard_users` trong `chat_sessions` / `chat_messages`. UI `/shop/chat` có sidebar chọn cuộc trò chuyện cũ.

| API | Mô tả |
|-----|--------|
| `GET /api/chat/sessions` | Danh sách session |
| `POST /api/chat/sessions` | Tạo session mới |
| `GET /api/chat/sessions/:id/messages` | Khôi phục tin nhắn |
| `DELETE /api/chat/sessions/:id` | Xóa session |

**Postgres đã chạy từ trước** (init SQL cũ, không có bảng chat): áp migration thủ công trên Lap1:

```bash
k3s kubectl -n realtime exec -i deploy/postgres -- psql -U app -d realtime < infra/postgres/004_chat_history.sql
k3s kubectl -n realtime exec -i deploy/postgres -- psql -U app -d realtime < infra/postgres/005_remove_from_cart_kpi.sql
```

Cluster Postgres **mới** (PVC trống): bảng có trong `infra/k8s/data/postgres/configmap-init-sql.yaml` (`004_chat_history.sql`).

**Giọng trả lời tự nhiên (giống chat tư vấn):** số lấy từ Postgres → báo cáo nội bộ → Ollama **polish** (`CHAT_POLISH_TEMPERATURE`, `CHAT_POLISH_NUM_PREDICT`). Nếu Ollama chậm/lỗi, fallback template (liệt kê KPI — cứng hơn). Muốn mượt hơn: pull model lớn hơn (vd. `qwen2.5:7b`) và set `OLLAMA_MODEL` + restart `dashboard-api`.

**Khoảng thời gian dashboard manager:** thanh pill — `15p` … `24h`, **`7 ngày`**, **`30 ngày`**, **`Tất cả`** (rolling từ *bây giờ* lùi về; `minutes=0` = mọi KPI đã ingest). **Một ngày cố định:** ô **Ngày** (date picker) trên header → `?date=YYYY-MM-DD` (biên ngày theo **UTC** 00:00–24:00). Khi chọn ngày, pill rolling tạm không active; xóa ngày để quay lại pill. Chat API: `POST /api/chat` body `{ "date": "2026-05-15" }` (hoặc `minutes` khi không có `date`).

## 10. Pods (namespace `realtime`)

| Pod | Vai trò |
|-----|---------|
| postgres, kafka | Data + queue |
| tracking-api | Ingest HTTP |
| streaming-processor | Kafka → Postgres + Qdrant |
| dashboard-api, dashboard-ui | API + UI |
| rabbitmq, commerce-backend | RabbitMQ + order API stand-in (k3s); worker = web-shop Lap2 |
| *(Laptop 2)* web-shop `npm run adapter` | Consume adapter queue → ingest API |
| qdrant, ollama | RAG + LLM |

## 11. Role dashboard

| Role DB | UI |
|---------|-----|
| `super_admin` | `/admin` — pipeline, tài khoản, K8s guide |
| `analyst` | `/shop` — analytics, chat |

## 12. Quản trị k3s (UC12 — Kubernetes Admin)

**Mục tiêu:** deploy, kiểm tra pod, xem log, cập nhật secret, restart — **không** phải dashboard phân tích shop (`/shop`).

| UC12 (luận văn) | Thực hiện trong project |
|-----------------|-------------------------|
| Deploy / cập nhật manifest | `k3s kubectl apply -k infra/k8s/sprint3`; sau đổi code: `bash infra/k8s/rebuild-all-dev-images.sh` |
| Kiểm tra pod / service | `k3s kubectl -n realtime get pods`; tuỳ chọn **Headlamp**: Admin → K8s Dashboard → `infra/k8s/ops/kubernetes-dashboard/` |
| Xem log khi lỗi | `k3s kubectl -n realtime logs deploy/<tên> --tail=100`; `describe pod` |
| Restart / secret | `rollout restart deployment/<tên>`; `patch secret app-secrets`; xem bảng lỗi §7 |
| Giám sát sức khỏe pipeline (app) | Admin → **Pipeline Monitor** (`/api/system/pipeline`) — lag ingest/KPI, không thay kubectl |

**Tiêu chí demo (pod `Running` / `Ready` trong `realtime`):**

| Bắt buộc (UC) | Bổ sung (pipeline đủ) |
|---------------|------------------------|
| postgres, kafka, tracking-api, dashboard-api, qdrant | streaming-processor, dashboard-ui |
| | ollama (chat), rabbitmq + commerce-backend (đơn hàng) |

**Không deploy trong k3s:** `commerce-connector` — business events qua **adapter** trên Laptop 2 (`../Simulate_Demo`).

**Ngoại lệ thường gặp:**

- k3s chưa chạy → `sudo systemctl start k3s`
- Image chưa import → `bash infra/k8s/import-images.sh` (hoặc `CLEAN=1` nếu layer lỗi)
- Lap2 `TRACKING_INGEST_API_KEY` ≠ secret k3s → patch `app-secrets`, restart `tracking-api`

CI tự deploy (tuỳ chọn): GitHub Actions — xem [§14 CI/CD](#14-cicd).

## 13. Tắt / giảm tải (khi không demo)

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

### Reset sạch (dừng → xóa deploy → import lại từ đầu)

Một lệnh trong WSL (giữ PVC mặc định; thêm `DELETE_PVC=1` nếu muốn DB trống):

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
NO_CACHE=1 bash infra/k8s/fresh-deploy.sh
```

Script: `infra/k8s/fresh-deploy.sh` — scale 0, `delete -k sprint3`, xóa deploy cũ (connector/worker), `CLEAN=1` + `import-images.sh`, `apply` lại, đợi rollout.

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

---

## 14. CI/CD

GitHub Actions trong [`.github/workflows/`](../.github/workflows/).

| File | Khi chạy | Việc làm |
|------|----------|----------|
| [`ci.yml`](../.github/workflows/ci.yml) | PR + push `main` | Validate kustomize, `dashboard-api` tests, build UI, build **5** Docker image (không push) |
| [`cd.yml`](../.github/workflows/cd.yml) | Push `main` | Build + push image lên **GHCR** |
| [`cd-k3s-self-hosted.yml`](../.github/workflows/cd-k3s-self-hosted.yml) | Push `main` (runner WSL label `k3s`) | `import-images.sh` + `apply sprint3` + rollout |

**CD GHCR:** Repo → Settings → Actions → **Read and write**. Kéo image: `docker pull ghcr.io/OWNER/REPO/tracking-api:TAG` → tag `:dev` → `k3s ctr images import`. Overlay: [`infra/k8s/overlays/ghcr/`](../infra/k8s/overlays/ghcr/).

**Self-hosted runner (WSL):** Settings → Actions → Runners → New → `./config.sh` với label `k3s`. Deploy tay: `bash infra/k8s/rebuild-all-dev-images.sh`.

CI/CD pipeline **không** build repository `../Simulate_Demo`.

---

## 15. Postgres schema

Nguồn SQL: [`infra/postgres/`](../infra/postgres/) — mount qua ConfigMap `postgres-init-sql` ([`configmap-init-sql.yaml`](../infra/k8s/data/postgres/configmap-init-sql.yaml)). Sửa schema → cập nhật **cả hai** hoặc PVC mới.

| File | Nội dung |
|------|----------|
| `init.sql` | Extensions |
| `001_tracking_schema.sql` | Events + KPI |
| `002_products_catalog.sql` | Catalog demo |
| `003_dashboard_users.sql` | Auth |
| `004_tracking_kpi_revenue.sql` | Revenue columns |
| `004_chat_history.sql` | Chat sessions/messages |
| `005_remove_from_cart_kpi.sql` | Migration KPI (PVC cũ) |

**FK:** `chat_sessions` → `dashboard_users`; `chat_messages` → `chat_sessions`. KPI join `product_id` theo app, không FK cứng.

---

## 16. Headlamp (K8s UI, tuỳ chọn)

[Headlamp](https://headlamp.dev/) — ops cluster (khác Admin Pipeline `/admin/system` trong app).

```bash
bash infra/k8s/ops/kubernetes-dashboard/install.sh   # Helm, cần Helm 3
bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh   # http://localhost:8080
bash infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh   # Bearer token
```

Login → chọn namespace **`realtime`**. Token `admin-user` = `cluster-admin` — chỉ lab/demo.
