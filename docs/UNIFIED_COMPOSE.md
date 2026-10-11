# Một bộ Compose cho Pipeline

Deployment mới và môi trường phát triển cùng dùng [`infra/compose.yaml`](../infra/compose.yaml) và một env riêng của từng máy/project, sao chép từ [`runtime/deploy.env.example`](../runtime/deploy.env.example) thành `runtime/deploy.env` (Git-ignored). Chạy từ root `Streaming_Pipeline` bằng Docker Engine + Compose plugin trên Windows hoặc Linux. Không dùng launcher `run-all`, các overlay handoff/demo cũ hoặc `.env` cũ.

## Trước khi chạy

1. Giữ `HANDOFF_PROJECT` duy nhất và ổn định cho deployment; chọn cổng UI không xung đột. DB/JWT/Admin secrets phải mới cho mỗi project, không sao chép secret/volume từ máy hoặc demo khác. Kiểm tra `git check-ignore runtime/deploy.env`.
2. Mẫu mặc định build từ source với ba image local. Nếu dùng image phát hành, đặt policy/image theo digest đã kiểm chứng đúng phiên bản code; image cũ không tự có Polars/tool mới. Không mount source hoặc Docker socket vào API/Web.
3. Tránh export biến `HANDOFF_*`, `MONITORING_*` hoặc `COMPOSE_*` trùng tên trong terminal: shell có thể override `--env-file`. Không in `docker compose config` đầy đủ hay `docker inspect` vì chứa secret.
4. Nếu bật `live`, phải xác minh Source Event Feed HTTPS, read token, feed ID, initial sequence, retention/coverage và isolation theo Master §24.1–24.2.1/DEC-125. Chỉ dùng fresh `PARALLEL_LIVE` với `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE`; không reset cursor hoặc gắn feed vào DB restored chưa qua replay gate.

## Lệnh chung

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/compose.yaml up -d --wait
docker compose --env-file runtime/deploy.env -f infra/compose.yaml ps -a
```

Thêm cùng các `--profile live`, `--profile catalog`, `--profile monitoring` vào `config`, `up` và `ps` khi đã duyệt profile đó. Demo hiện tại đã bật `live` và `catalog`, còn monitoring là opt-in. `catalog` dùng URL/key Medusa Admin riêng; không dùng Feed/browser/backend signing key. Qwen không có profile: đặt `HANDOFF_ENABLE_QWEN=true` và Model Studio key trong cùng env sau khi duyệt dữ liệu gửi ra ngoài và chi phí. Mặc định false. Các tool phân tích trong image build hiện hành đã có cấu hình, nhưng có thể trả `PROVISIONAL` hoặc thiếu dữ liệu nếu feed/catalog chưa đủ; flag không tạo ra tool chưa được implement.

Monitoring dùng Prometheus/Grafana trong cùng Compose, song cần provision token/password và dashboard dưới `runtime/monitoring/` trước khi bật. `node runtime/prepare-monitoring.mjs` đọc `deploy.env`; các công cụ rotate/check cũng đọc file này. Watchdog host-side và autoscaler actuator không tự chạy trong Compose; CPU/RAM/PID limits là giới hạn mỗi replica, không phải chính sách auto-scale. Maturity scheduler ghi evidence nhưng finalization tự động vẫn khóa cho tới khi policy được duyệt.

Sau sửa code hoặc env, chạy lại `up -d --wait` với cùng project/profile để Compose recreate service cần thiết. `restart` không nạp env/image mới. Nếu API bị recreate mà Web trả 502, kiểm tra proxy/upstream và recreate Web; vấn đề DNS proxy này chưa được sửa tận gốc.

Để dừng nhưng **giữ nguyên PostgreSQL, Kafka và cursor**:

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog stop
```

Không dùng `down -v`, `prune`, copy Kafka volume hoặc sửa initial sequence để reset một deployment đã có cursor. Bootstrap Admin chỉ khởi tạo khi DB trống, không đổi mật khẩu hiện hành. `config --quiet`, HTTP 200 và trạng thái healthy không chứng minh event đã canonical đầy đủ hay Qwen đã xử lý chat; cần acceptance riêng theo event ID, outcome, catalog snapshot và câu trả lời có evidence.

## Ranh giới lịch sử và mức kiểm chứng

Các overlay handoff/demo và Compose V2/private-ingress cũ đã được loại khỏi `infra/`. Các `.env` cũ và dữ liệu demo local dưới `runtime/` đã được xóa theo yêu cầu; Compose hiện hành chỉ đọc `deploy.env`. Monitoring secret cũng đã xóa nên profile monitoring phải được provision/kiểm chứng lại trước khi dùng. Edge Relay/Source là deployment riêng, không phải overlay của Pipeline.

Ngày 11/10/2026, bộ mới đã build API/Web/worker từ source, chạy Live Feed, Catalog và Qwen trên project mới tách biệt; kiểm tra nhận feed, canonical outcome, 104 product catalog entries và chat qua Qwen thành công. Đây là bằng chứng demo, **không** chứng nhận production end-to-end. Production vẫn cần Source Ingress/Event Log/Feed, TLS/DNS, backup/retention, secret governance, replay/cutover acceptance và xác minh completeness. Monitoring và autoscaler actuator chưa được nghiệm thu trong bộ này.
