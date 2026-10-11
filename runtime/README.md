# Runtime configuration

Deployment hiện hành đọc duy nhất [`deploy.env`](deploy.env.example) (file thật được Git ignore) với [`infra/compose.yaml`](../infra/compose.yaml). Tạo `deploy.env` từ [`deploy.env.example`](deploy.env.example), điền secret riêng, giữ nguyên `HANDOFF_PROJECT` khi resume và kiểm tra `git check-ignore runtime/deploy.env` trước khi chạy. Không in Compose config đã render hoặc gửi file env thật vào chat/Git.

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog up -d --wait
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog ps -a
```

Lệnh trên là ví dụ cho deployment đã được duyệt bật Live Feed và Catalog; deployment offline bỏ hai profile. Qwen dùng `HANDOFF_ENABLE_QWEN` trong chính `deploy.env`. Profile `monitoring` chỉ bật sau khi provision `runtime/monitoring/metrics-token`, `grafana-password` và dashboard bằng `node runtime/prepare-monitoring.mjs`; các tiện ích kiểm tra/rotate monitoring cũng đọc `deploy.env`. Không tự động bật profile chỉ vì có key.

Các `.env` thật của demo/private/V2 cũ đã được xóa khỏi `runtime/`; chỉ còn `deploy.env`. Các ví dụ và tài liệu demo lịch sử đã chuyển vào `docs/archive/` hoặc bị loại khỏi bộ hiện hành. Compose V2/private-ingress cũ cũng đã bỏ; dùng bộ Compose thống nhất để phát triển và triển khai Pipeline.

Thư mục `monitoring/` và các bản backup demo cũ đã được xóa theo yêu cầu. Profile monitoring hiện **chưa sẵn sàng**: phải provision lại credential/dashboard trên DB hiện hành trước khi bật; không thể chỉ thêm `--profile monitoring` và coi là hoàn tất. Credential monitoring thuộc DB demo cũ không thu hồi được qua API của stack mới (API trả 503 khi liệt kê credential); nếu phục hồi DB/demo cũ, phải kiểm tra/thu hồi credential đó trước khi mở truy cập. Bản dump đã xóa không thể khôi phục từ Git.

Để dừng nhưng giữ PostgreSQL/Kafka/cursor:

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog stop
```

Xem [UNIFIED_COMPOSE.md](../docs/UNIFIED_COMPOSE.md) trước khi đổi project, image, live boundary hoặc chế độ deployment. Không dùng `down -v` để xử lý lỗi.
