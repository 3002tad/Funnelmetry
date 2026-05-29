# k3s manifests

**Deploy full stack:** `k3s kubectl apply -k infra/k8s/sprint3`

**Hướng dẫn đầy đủ (clone → secret → URL):** [`docs/RUNTIME.md`](../../docs/RUNTIME.md)  
**Cấu trúc infra:** [`../README.md`](../README.md) · **Ports:** [`../PORTS.md`](../PORTS.md)

## Scripts thường dùng

| Script | Việc |
|--------|------|
| `install-k3s-wsl.sh` | Cài k3s trên WSL (lần đầu) |
| `import-images.sh` | Build tất cả image `:dev` + import k3s |
| `import-images.ps1` | Cùng việc, chạy từ PowerShell |
| `rebuild-all-dev-images.sh` | Rebuild + rollout sau khi đổi code |
| `port-forward-dashboard.sh` | UI local `:8090` |
| `port-forward-tracking.sh` | Tracking local `:31000` |
| `kubectl.sh` | Wrapper `k3s kubectl` |

## Secret (trước khi apply)

```bash
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
  --dry-run=client -o yaml | k3s kubectl apply -f -
```

Mẫu: [`base/secrets.example.yaml`](base/secrets.example.yaml)

## Ollama model (lần đầu)

```bash
k3s kubectl -n realtime exec deploy/ollama -- ollama pull qwen2.5:3b
```

## Headlamp (K8s UI, tuỳ chọn)

[`ops/kubernetes-dashboard/README.md`](ops/kubernetes-dashboard/README.md) — cài Headlamp, token admin, port-forward.

## Kiểm tra

```bash
k3s kubectl -n realtime get pods
k3s kubectl -n realtime logs deploy/tracking-api --tail=50
curl -s http://127.0.0.1:31000/health
```

**Lưu ý:** Không `apply -k sprint1` riêng sau khi đã sprint3 — mất NodePort. Luôn **sprint3**.
