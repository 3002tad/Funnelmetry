# Demo mới trên máy bạn — 11/10/2026

> **Lưu trữ lịch sử:** bundle/launcher demo cũ đã bỏ. Người nhận triển khai theo [vận hành hiện hành](OPERATIONS.md), với project/env riêng và không dùng image digest cũ khi chưa kiểm chứng.

Phạm vi: OFFLINE_DEMO, database/Kafka mới, không chuyển dữ liệu từ máy khác.
Theo DEC-125; không xóa hoặc ghi đè demo cũ. Project riêng được tạo ngẫu nhiên
`funnelmetry-teammate-<id>`, UI mặc định http://localhost:5183.

## Chuẩn bị và chạy

1. Nhận source chứa `runtime/teammate-demo.mjs` và `tools/resilience-watchdog/`.
   Bản launcher mới cần commit/push trước khi máy khác lấy bằng Git; image GHCR
   không chứa các script host mới này. Ghi lại `git rev-parse HEAD` khi nhận.
2. Bật Docker Desktop **Linux containers**, dùng Docker context local; cài Node.js 22+.
   Image đã phát hành là linux/amd64. Không cần npm install hay build image.
3. Nếu package private, đăng nhập GHCR bằng tài khoản được cấp quyền đọc:

   ```powershell
   docker login ghcr.io -u <tai-khoan-github>
   ```

   Nhập token ở prompt Password, không dán token vào Git hoặc tin nhắn.
4. Trong repo Pipeline chạy:

   ```powershell
   node runtime/teammate-demo.mjs start
   ```

Lần đầu tạo `runtime/teammate-demo/demo.env` với mật khẩu DB/Admin và JWT riêng,
manifest không chứa secret, sau đó pull ba image đã pin digest từ release `2fb6b91`
ngày 10/10 và image hạ tầng. Xem provenance trong `TEAMMATE_MONITORING_TEST_2026-10-10.md`.
Không copy `.env` của người gửi. Mật khẩu Admin chỉ đọc tại file local, email
`admin@teammate.local`; tạo Analyst qua Users để xem analytics.
Launcher xác minh project, image và các biến cấu hình trước khi chạy Compose;
biến `HANDOFF_*`, `MONITORING_*` hoặc `COMPOSE_*` trong terminal không lấn file demo.

Nếu cổng 5183 đã dùng, **ngay lần đầu** chọn cổng khác:

```powershell
node runtime/teammate-demo.mjs start 5184
```

Không đổi cổng/project bằng cách xóa manifest sau khi đã chạy. Nếu khởi tạo/pull/start
lỗi, các file và volume được giữ lại để kiểm tra; không tự reset hoặc dọn Docker.
Nếu thư mục khởi tạo dở thiếu manifest, cần review thay vì ghi đè credential.

## Dùng hàng ngày

```powershell
node runtime/teammate-demo.mjs status
node runtime/teammate-demo.mjs config
node runtime/teammate-demo.mjs stop
node runtime/teammate-demo.mjs start
```

Stop giữ nguyên volume, tài khoản và dữ liệu. Không dùng `runtime/new-demo.ps1` hoặc
`runtime/start-recovery-demo.ps1` cho deployment này vì hai script đó thuộc project khác.

Có thể chạy `node runtime/teammate-demo.mjs stop` để dừng và
`node runtime/teammate-demo.mjs watchdog` để chạy Watchdog. Khóa `operation.lock` chặn start/stop/Watchdog chạy đồng thời;
status vẫn đọc được. Nếu đóng cưỡng bức cửa sổ, lock có thể còn lại: xác minh tiến
trình đã dừng và review trước khi xử lý lock; không xóa database/cấu hình.

Muốn chạy Watchdog cho normalizer đang khỏe:

```powershell
node runtime/teammate-demo.mjs watchdog
```

Giữ cửa sổ mở. Ctrl+C dừng Watchdog trước khi stop/resume demo. State/audit nằm cùng
thư mục local; lock/pending/circuit lỗi cần review, không xóa để vượt guard.
Watchdog dùng cấu hình EXPERIMENTAL hiện có: kiểm tra mỗi 10 giây sau vòng trước,
3 lần lỗi liveness, grace 60 giây, cooldown 120 giây, tối đa 2 restart/15 phút.
Không expose Docker socket cho UI/API/Agent. Không tự bật lại worker bị operator stop.

## Có gì / chưa có gì

- Có UI/API, PostgreSQL, Kafka, sáu downstream worker, profile/analytical releases,
  worker health và Kafka lag trên Admin; dữ liệu ban đầu **trống**.
- Có Watchdog host tùy chọn cho normalizer; chưa autoscale tự động.
- Không bật Medusa feed, catalog, Qwen hoặc copy event/cursor/database cũ.
- Không tự provision Prometheus/Grafana hoặc khóa metrics; những phần đó có runbook riêng.
- HTTP/UI healthy không chứng minh đã nhận event. Muốn xem dữ liệu nghiệp vụ cần bước
  fixture có nhãn hoặc kết nối source với boundary/credential được xác minh riêng.

## Kiểm chứng của launcher

Unit tests: tạo cấu hình độc lập, không ghi đè, kiểm tra scope/port/digest và Compose
`config --quiet`. Bộ image đã có acceptance isolated riêng; **chưa chứng nhận lần cài
trên máy người nhận**. Sau start kiểm tra UI và anonymous API trả 401; ghi kết quả
máy nhận, Docker/Compose version, Git SHA và limitations vào hồ sơ bàn giao.

Kiểm tra local ngày 11/10/2026: cấu hình sinh ra qua `docker compose config --quiet`.
Không dựng thêm stack trên máy gửi trong lượt chuẩn bị launcher; clean-install
end-to-end của chính launcher này và quyền pull trên máy nhận vẫn cần xác minh.

Thư mục `runtime/teammate-demo/` bị ignore toàn bộ. Chỉ chia sẻ source/runbook,
không gửi credential, state, logs hay database trong thư mục đó.
