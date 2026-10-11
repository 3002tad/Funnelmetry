# Bộ cấu hình triển khai hiện hành

Pipeline dùng **một bộ Compose** trên Windows và Linux:

| File | Vai trò |
|---|---|
| `infra/compose.yaml` | Toàn bộ dịch vụ core và các profile `live`, `catalog`, `monitoring` |
| `runtime/deploy.env.example` | Mẫu biến môi trường, không chứa secret thật |
| `runtime/deploy.env` | Cấu hình riêng của máy, Git-ignored; chứa key/secret cần thiết |
| `infra/docker/` | Dockerfile để build image từ source |
| `infra/bootstrap/` | Bootstrap schema và dữ liệu nền cho deployment mới |
| `infra/observability/` | Cấu hình Prometheus/Grafana khi dùng profile monitoring |
| `runtime/monitoring/` | Secret và dashboard được provision riêng cho monitoring |

Chạy từ root repository:

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog up -d --wait
```

Chỉ bật `live` sau khi đã xác minh Source Event Feed, isolation và initial boundary. Chỉ bật `catalog` khi có URL/key Medusa Admin riêng. Qwen bật bằng `HANDOFF_ENABLE_QWEN=true` trong cùng env sau khi đã duyệt chi phí và dữ liệu gửi ra provider. `monitoring` cần provision secret theo [hướng dẫn](../runtime/README.md). Lệnh `config --quiet` không chứng minh feed/catalog/Qwen hoạt động; cần acceptance riêng.

Các overlay handoff/demo và V2/private-ingress cũ cùng env mẫu tương ứng đã được bỏ khỏi `infra/` và `runtime/`. Trong `runtime/` chỉ còn `deploy.env` là env thật; các `.env` cũ, log/backup và monitoring secret demo đã được xóa theo yêu cầu. Không đưa `deploy.env` vào Git. Edge Relay là deployment Source riêng và vẫn giữ Dockerfile cần thiết của nó.

Xem [UNIFIED_COMPOSE.md](UNIFIED_COMPOSE.md) để biết preflight, giới hạn dữ liệu và cách dừng/resume an toàn. Không dùng `down -v` hoặc reset cursor để chuyển cấu hình.
