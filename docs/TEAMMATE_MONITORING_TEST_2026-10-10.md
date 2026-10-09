# Bàn giao test Admin monitoring — 10/10/2026

## Phạm vi bản này

Sau bản bàn giao 05/10: thêm Admin Event Feed/Processing, Kafka lag/membership,
readiness 6 worker, Prometheus/Grafana, khóa metrics riêng + rotation, cảnh báo
trên Admin. Xem `runtime/NEW_DEMO.md` và `docs/ADMIN_MONITORING_ALERTS_2026-10-10.md`.

**Git pull không cập nhật container.** Image GHCR cũ tại commit `a725fad` chưa có
các thay đổi này. Bản test này bàn giao source để build tại máy nhận; chưa publish
image mới. Không dùng image cũ rồi kết luận tính năng mới không hoạt động.

## An toàn trước khi chạy

- Đọc `CODEX_HANDOFF.md` và quy tắc DEC-125 trong System_Backbone.
- Test sandbox tách khỏi hệ thống live: không copy database/Kafka volume/cursor,
  không bật Source Connector/catalog/Qwen bằng credential của máy gửi.
- Không chia sẻ `.env`, `runtime/monitoring/`, mật khẩu hoặc token trong Git/chat.
- Các helper `new-demo.ps1`/`manage-monitoring-key.mjs` hiện dùng cố định project
  `funnelmetry-demo-new`, file `runtime/demo-new.env`. Chỉ dùng nếu project này
  không thuộc một deployment đang có trên máy nhận. Nếu trùng, dừng và chọn
  project riêng qua Compose; không tự dùng launcher đè lên project cũ.
- Hướng dẫn nhanh dưới đây dùng PowerShell/Docker Desktop Linux containers và
  Node.js 22+. Linux có thể dùng cùng Compose files nhưng không chạy file `.cmd`.

## Dựng bản test từ source

Từ repo `Streaming_Pipeline` sau `git pull --ff-only`, ghi lại `git rev-parse HEAD`:

```powershell
docker build -f apps/dashboard-api/Dockerfile.analytics -t funnelmetry/handoff-api:monitoring-test .
docker build -f apps/dashboard-web/Dockerfile -t funnelmetry/handoff-web:monitoring-test .
docker build -f infra/docker/pipeline-workers.Dockerfile -t funnelmetry/handoff-workers:monitoring-test .
```

Tạo **file local mới**, không ghi đè file đang dùng: dựa trên `runtime/handoff.env.example`
tạo `runtime/demo-new.env`, điền mật khẩu DB, JWT secret và mật khẩu Admin ngẫu nhiên
riêng (Admin tối thiểu 12 ký tự). Cấu hình:

```dotenv
HANDOFF_PROJECT=funnelmetry-demo-new
HANDOFF_UI_PORT=5180
HANDOFF_API_IMAGE=funnelmetry/handoff-api:monitoring-test
HANDOFF_WEB_IMAGE=funnelmetry/handoff-web:monitoring-test
HANDOFF_WORKERS_IMAGE=funnelmetry/handoff-workers:monitoring-test
```

Pull `postgres:15-alpine` và `apache/kafka:3.9.1` nếu chưa có. Chưa tạo
`runtime/monitoring.env` ở bước này. Chạy `start-new-demo.cmd` để khởi tạo sandbox
trống và mở UI. Nếu bootstrap báo schema mismatch, **không reset/down -v**:
đối chiếu hướng dẫn handoff trước khi tiếp tục.

Migration monitoring là bước bổ sung, không nằm trong digest bootstrap:

```powershell
Get-Content infra/postgres/011_monitoring_credentials.sql -Raw | docker exec -i funnelmetry-demo-new-postgres-1 psql -U funnelmetry -d funnelmetry_handoff -v ON_ERROR_STOP=1
```

Chỉ tiếp tục nếu exit code 0. Sau đó:

```powershell
node runtime/prepare-monitoring.mjs
```

Script tạo khóa metrics riêng, mật khẩu Grafana và dashboard trong thư mục ignored;
không in secrets, không ghi đè lần provisioning trước. Tạo `runtime/monitoring.env`
từ `runtime/monitoring.env.example` (không ghi đè env có sẵn), pull đúng hai image
đã pin trong file đó, rồi chạy lại `start-new-demo.cmd`.

## Checklist người nhận

- Pipeline: `http://localhost:5180`, đăng nhập Admin theo env của máy nhận.
- `/admin/event-feed`: UNKNOWN khi chưa bật Connector là đúng, không phải lỗi mất event.
- `/admin/processing`: worker/Kafka/cảnh báo hiện được; demo trống có thể chưa có
  committed offsets, không ép lag UNKNOWN thành 0.
- Grafana: `http://localhost:5182`, user `monitoring-admin`, password trong
  `runtime/monitoring/grafana-password`. Dashboard thư mục Pipeline, 8 panel.
- `node runtime/check-monitoring.mjs`: UP=1, sáu worker observations.
- `node runtime/check-monitoring-alerts.mjs recovered`: worker quan sát được,
  API không cho anonymous truy cập.
- `node runtime/smoke-monitoring.mjs`: tạo/thu hồi một khóa test; khóa không đọc
  được API Admin khác. Test để lại audit/khóa revoked, không tạo event nghiệp vụ.
- `node runtime/manage-monitoring-key.mjs rotate`: khóa mới dùng được và scrape
  mới thành công trước khi thu hồi khóa cũ. Không xóa pending journal nếu bị lỗi.
- `stop-new-demo.cmd`: dừng và giữ volumes. Chạy lại phải giữ tài khoản/khóa/metrics.

Cảnh báo chỉ cập nhật khi mở trang Admin; chưa có email/Alertmanager/tự restart/scale.
Khóa demo mặc định 7 ngày, cần rotate chủ động. Không coi checklist này là kiểm chứng
Medusa live, AI, đầy đủ event hoặc hiệu năng/catch-up dưới tải.

Gửi lại: commit đã test, OS/Docker version, bước nào PASS/FAIL, mã HTTP/thông báo đã
che secrets và ảnh UI nếu cần. Không gửi toàn bộ env/log chưa kiểm tra.

## Bằng chứng trên máy phát triển

API 169 PASS / 4 optional SKIP, UI build PASS; runtime Grafana 8 panel, UP=1,
6 worker observations; thử stop/start canonical-normalizer cho UNKNOWN rồi tự hết;
rotation thật PASS. Các kết quả này chưa thay cho acceptance trên máy người nhận.
