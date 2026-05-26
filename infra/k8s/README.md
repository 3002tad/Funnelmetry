# k3s rollout guide

Modular manifests: `sprint1` → `sprint2` → `sprint3`. **Full stack:** `k3s kubectl apply -k infra/k8s/sprint3`.

**CLI:** Trên máy chỉ cài k3s, dùng `k3s kubectl` (không cần `snap install kubectl`). Tuỳ chọn: `alias kubectl='k3s kubectl'` hoặc `bash infra/k8s/kubectl.sh`.

**Ports:** [`../PORTS.md`](../PORTS.md) — NodePort `31000`, `32000`, `30809`.

**Chưa cài k3s?** Làm mục [Cài k3s trên WSL2](#cài-k3s-trên-wsl2) trước, rồi mới apply.

## Cài k3s trên WSL2

Theo spec demo, backend chạy trên **Ubuntu WSL2** (Laptop 1) bằng **k3s**. Docker chỉ dùng để **build/import image** (`import-images-*.sh`), không chạy stack Compose.

1. Mở **Ubuntu** (WSL), không phải PowerShell:

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
bash infra/k8s/install-k3s-wsl.sh
```

(Nhập mật khẩu `sudo` khi được hỏi.)

2. Kiểm tra:

```bash
k3s kubectl get nodes
# NAME   STATUS   ROLES                  AGE   VERSION
# ...    Ready    control-plane,master   ...
```

Tuỳ chọn — alias vĩnh viễn: `echo "alias kubectl='k3s kubectl'" >> ~/.bashrc && source ~/.bashrc`

3. Từ **PowerShell** (tuỳ chọn):

```powershell
wsl -d Ubuntu -- k3s kubectl get nodes
```

4. Import image app vào k3s:

**Cách A — WSL** (tự dùng `docker` hoặc Docker Desktop `docker.exe` trên Windows):

```bash
bash infra/k8s/import-images-wsl.sh
```

**Cách B — PowerShell** (Docker Desktop trên Windows, import sang k3s WSL):

```powershell
.\infra\k8s\import-images.ps1
```

Nếu báo `docker could not be found in WSL`: bật **Docker Desktop → Settings → Resources → WSL Integration → Ubuntu**, hoặc dùng Cách B.

Nếu báo `permission denied` trên `docker.sock`:

```bash
sudo usermod -aG docker "$USER"
```

Rồi **đóng hết terminal Ubuntu**, trên PowerShell chạy `wsl --shutdown`, mở lại Ubuntu và thử lại.

### Lưu ý

- Runtime = **k3s only** — không chạy `docker compose up` song song (trùng tài nguyên / gây nhầm port).
- Gọi cluster từ Windows: `wsl -d Ubuntu -- k3s kubectl ...` (hoặc copy `~/.kube/config` + cài k3s kubectl riêng).
- **Không** chỉ `apply sprint1` sau khi đã sprint3 — sẽ mất NodePort tracking `:31000`. Luôn `apply -k sprint3` cho full stack.
- Nếu `install-k3s-wsl.sh` lỗi, xem log: `sudo journalctl -u k3s -n 50`.

## Scope (Sprint 1)

- `postgres`
- `kafka` (single-node KRaft)
- `tracking-api`
- `streaming-processor`

The compose stack remains your rollback path.

## Layout

- `base/` namespace and bootstrap secret example
- `data/postgres/` stateful postgres resources + init SQL configmap
- `data/kafka/` stateful kafka resources
- `apps/tracking-api/` ingest API deployment/service
- `apps/streaming-processor/` stream worker deployment
- `sprint1/` umbrella kustomization to deploy all above

## Before apply

1. Create real secret from your env values (do not use example values in production):

Trong **WSL Ubuntu** (thay `<password>` bằng giá trị trong `infra/.env`):

```bash
k3s kubectl create namespace realtime --dry-run=client -o yaml | k3s kubectl apply -f -

k3s kubectl -n realtime create secret generic app-secrets \
  --from-literal=POSTGRES_DB=realtime \
  --from-literal=POSTGRES_USER=app \
  --from-literal=POSTGRES_PASSWORD='<password>' \
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

2. Ensure images exist in the k3s runtime:
   - `tracking-api:dev`
   - `streaming-processor:dev`

If you build images locally via Docker, import into k3s/containerd.

## Deploy

Trong WSL, từ root repo:

```bash
k3s kubectl apply -k infra/k8s/sprint1
k3s kubectl -n realtime get pods -w
```

## Smoke checks

```bash
k3s kubectl -n realtime get svc
k3s kubectl -n realtime logs deploy/tracking-api --tail=100
k3s kubectl -n realtime logs deploy/streaming-processor --tail=100
```

Expected:
- tracking-api health endpoint returns ready
- streaming-processor connects to Kafka + Postgres and consumes topic

## Rollback

```bash
k3s kubectl delete -k infra/k8s/sprint1
```

Then switch traffic back to compose services if needed.

---

## Sprint 2 — Dashboard + Qdrant

Thêm lên k3s:

- `qdrant`
- `dashboard-api`
- `dashboard-ui` (nginx proxy `/api` → `dashboard-api` trong cluster)
- Bật `QDRANT_URL` cho `streaming-processor`
- NodePort: tracking `31000`, dashboard API `32000`, UI `30809`

### 1. Cập nhật secret (JWT + admin)

```bash
k3s kubectl -n realtime create secret generic app-secrets \
  --from-literal=POSTGRES_DB=realtime \
  --from-literal=POSTGRES_USER=app \
  --from-literal=POSTGRES_PASSWORD='...' \
  --from-literal=JWT_SECRET='...' \
  --from-literal=DASHBOARD_ADMIN_EMAIL='admin@pipeline.local' \
  --from-literal=DASHBOARD_ADMIN_PASSWORD='...' \
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

### 2. Build & import image Sprint 2

```bash
bash infra/k8s/import-images-sprint2.sh
```

### 3. Deploy

```bash
k3s kubectl apply -k infra/k8s/sprint2
k3s kubectl -n realtime get pods -w
```

### 4. Truy cập từ Windows (WSL + k3s)

**NodePort thường không mở được qua `localhost` trên Windows** — dùng IP của WSL:

```bash
hostname -I | awk '{print $1}'
# Ví dụ: http://172.29.248.123:30809
```

| Dịch vụ | URL (thay `<WSL_IP>`) |
|---------|------------------------|
| Dashboard UI | http://`<WSL_IP>`:30809 |
| Dashboard API | http://`<WSL_IP>`:32000 |
| Tracking API | http://`<WSL_IP>`:31000 |

Hoặc port-forward (terminal giữ mở):

```bash
bash infra/k8s/port-forward-dashboard.sh
# rồi thử http://localhost:8090
```

### 5. Ollama (chat LLM — in-cluster)

- Deployment `apps/ollama/`, service `http://ollama:11434`
- Model lưu PVC `ollama-data` (10Gi) — pod restart không mất model
- `dashboard-api` dùng `OLLAMA_URL=http://ollama:11434`

```bash
k3s kubectl apply -k infra/k8s/sprint3
k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b
k3s kubectl -n realtime exec deploy/dashboard-api -- wget -qO- http://ollama:11434/api/tags
```

**Lưu ý:** Lần đầu gắn PVC mới, volume trống — cần `pull` lại một lần. Xóa PVC = mất model.

### 6. Demo-shop / env

`infra/.env` — `VITE_TRACKING_API_URL=http://<WSL_IP>:31000`. Xem [`../PORTS.md`](../PORTS.md).

---

## Sprint 3 — Full stack (alias sprint2)

`sprint3` = `sprint2` (tracking, streaming, dashboard, qdrant, ollama). **Không** deploy RabbitMQ / commerce-backend / connector.

Commerce events (`purchase_succeeded`, `checkout_start`, …) gửi qua **browser SDK** → `tracking-api`.

### Gỡ RabbitMQ đã chạy trên cluster (một lần)

```bash
k3s kubectl -n realtime delete deploy rabbitmq commerce-backend commerce-connector --ignore-not-found
k3s kubectl -n realtime delete svc rabbitmq commerce-backend --ignore-not-found
k3s kubectl apply -k infra/k8s/sprint3
k3s kubectl -n realtime rollout restart deploy/dashboard-api
```
