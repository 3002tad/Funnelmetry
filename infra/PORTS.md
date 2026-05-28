# Port map — k3s (runtime)

Backend chạy trên **k3s** trong WSL2. Build image vẫn có thể dùng Docker (`infra/k8s/import-images-*.sh`).

## Truy cập từ Windows / Laptop 2

| Dịch vụ | NodePort | Container | URL |
|---------|----------|-----------|-----|
| tracking-api | **31000** | 3000 | `http://<WSL_IP>:31000` — SDK `POST /track` |
| commerce-backend | **30330** | 3000 | `http://<WSL_IP>:30330` — web-shop commerce events |
| dashboard-api | **32000** | 3000 | `http://<WSL_IP>:32000` (dev vite) |
| dashboard-ui | **30809** | 80 | `http://<WSL_IP>:30809` — proxy `/api/` nội bộ |
**WSL IP:** `wsl -d Ubuntu hostname -I` → cập nhật `WSL_IP` / `VITE_*` trong `infra/.env`.

**Tailnet:** `http://lap1:31000`, `http://lap1:30330`, `http://lap1:30809` (nếu Tailscale trên WSL).

**Web-shop dev:** `npm run dev` → `http://localhost:3000` — cần `TRACKING_FORWARD_URL` trỏ `http://lap1:31000/track` và `COMMERCE_BACKEND_URL` trỏ `http://lap1:30330`.

## Chỉ trong cluster (ClusterIP)

| Dịch vụ | Port |
|---------|------|
| kafka | 9092 |
| postgres | 5432 |
| qdrant | 6333 |
| ollama | 11434 (ClusterIP `http://ollama:11434`, PVC `ollama-data` 10Gi) |

## Deploy & CLI

```bash
k3s kubectl apply -k infra/k8s/sprint3
k3s kubectl -n realtime get pods
```

Luôn **sprint3** (full stack). Không chỉ `sprint1` — sẽ mất NodePort tracking.

Alias (tuỳ chọn): `alias kubectl='k3s kubectl'`

## Port-forward (tuỳ chọn)

| Script | Local |
|--------|-------|
| `infra/k8s/port-forward-tracking.sh` | `:31000` |
| `infra/k8s/port-forward-dashboard.sh` | `:8090` UI |

## Ollama (chat — in-cluster)

- Deployment `ollama`, model lưu PVC `ollama-data` (10Gi) tại `/root/.ollama`.
- Lần đầu sau PVC mới: `k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b`
- Pod restart **không** mất model (trừ khi xóa PVC).

## Legacy: Docker Compose

`infra/docker-compose.yml` không dùng cho runtime. Port cũ: 3100, 3200, 8090, 3300 — tham khảo lịch sử only.
