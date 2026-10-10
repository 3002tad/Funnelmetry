# Bàn giao test Admin monitoring — 10/10/2026

> Điểm bắt đầu chung cho team: [bản bàn giao trong System_Backbone](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/PIPELINE_MONITORING_HANDOFF_2026-10-10.md).
> File này giữ lệnh vận hành theo version code Pipeline; Backbone tổng hợp tiến độ,
> bằng chứng và checklist, không sao chép một bộ lệnh runtime thứ hai.

## Phạm vi bản này

Sau bản bàn giao 05/10: thêm Admin Event Feed/Processing, Kafka lag/membership,
readiness 6 worker, Prometheus/Grafana, khóa metrics riêng + rotation, cảnh báo
trên Admin. Xem `runtime/NEW_DEMO.md` và `docs/ADMIN_MONITORING_ALERTS_2026-10-10.md`.

**Git pull không cập nhật container.** Ba image mới đã publish và xác minh digest
trên GHCR ngày 10/10/2026, từ source `2fb6b91f73f7abe9036d527cbb78217062e96d1e`,
platform `linux/amd64`. Image cũ `a725fad` chưa có các thay đổi này.
Build thực hiện trên máy phát triển bằng `tools/release-handoff.ps1`, không phải GitHub Actions.

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

## Dựng bản test bằng image đã publish (không cần build)

Từ repo `Streaming_Pipeline` sau `git pull --ff-only`, ghi lại `git rev-parse HEAD`:

```powershell
docker login ghcr.io -u <github-username>
docker pull ghcr.io/3002tad/funnelmetry/handoff-api@sha256:a794500f8cf84f6a2f03c99d2da1864937522b9a5757a79be815bf920face72d
docker pull ghcr.io/3002tad/funnelmetry/handoff-web@sha256:b5a0f6feb77e2823013a5fc3f35b3f71deb651eaedfc8f4f697294760f5671dc
docker pull ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650
```

Thay `<github-username>` bằng tài khoản người nhận. Nếu package private, tài khoản
phải được cấp quyền đọc package, token có `read:packages`; nhập token tại prompt
Password, không dán token vào câu lệnh hoặc Git. Quyền pull trên máy nhận chưa được
kiểm chứng bởi lần publish này. Vẫn cần checkout source để lấy Compose, migration và helper.

Tạo **file local mới**, không ghi đè file đang dùng: dựa trên `runtime/handoff.env.example`
tạo `runtime/demo-new.env`, điền mật khẩu DB, JWT secret và mật khẩu Admin ngẫu nhiên
riêng (Admin tối thiểu 12 ký tự). Cấu hình:

```dotenv
HANDOFF_PROJECT=funnelmetry-demo-new
HANDOFF_UI_PORT=5180
HANDOFF_API_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-api@sha256:a794500f8cf84f6a2f03c99d2da1864937522b9a5757a79be815bf920face72d
HANDOFF_WEB_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-web@sha256:b5a0f6feb77e2823013a5fc3f35b3f71deb651eaedfc8f4f697294760f5671dc
HANDOFF_WORKERS_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650
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

Release image `2fb6b91`: isolated acceptance PASS trước publish, gồm clean bootstrap,
UI assets/proxy/login/RBAC, Raw Kafka → canonical → Journey → Funnel → KPI,
gross order value fixture 20 EUR, stop/start và resume giữ state fixture.
Project test `funnelmetry-handoff-test-5bd74ab8e46f` dùng volumes riêng và được dọn
sau test; không reset demo đang có. Release harness không test overlay monitoring
hoặc Medusa/Qwen thật; bằng chứng monitoring phía trên là lần kiểm tra riêng.
Cả ba digest đã được đối chiếu qua `docker buildx imagetools inspect` trên GHCR.
Commit tài liệu có thể mới hơn source image; không có nghĩa image chứa code sau `2fb6b91`.
