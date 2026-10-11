# Cấu hình theo luồng demo hiện tại

> **Lưu trữ lịch sử:** bộ `demo-new.env`/handoff overlay không còn là đường chạy hiện hành. Dùng [`deploy.env.example`](../../runtime/deploy.env.example) và [Unified Compose](../UNIFIED_COMPOSE.md).

## Máy đang phát triển — funnelmetry-demo-new

```text
runtime/new-demo.ps1 -Action start / -Action stop
     -> runtime/demo-new.env             (image, UI, DB/JWT/Admin, worker limits)
     -> runtime/monitoring.env           (tùy chọn: image/port monitoring)
     -> infra/compose.handoff.yml        (PostgreSQL, bootstrap, API/UI)
     -> infra/compose.handoff-pipeline.yml (Kafka, sáu worker, profile publisher)
     -> infra/compose.handoff-analytics.yml (analytical releases/tools)
     -> infra/compose.handoff-monitoring.yml (worker health/Kafka observation)
     -> infra/compose.observability.yml  (chỉ khi monitoring.env có mặt)
```

File local giữ nguyên đường dẫn để không đứt script đang dùng. Mẫu chuẩn là
`demo-new.env.example`; **không copy đè** vào `.env` đã có. Giữ password, JWT,
project và image pin hiện hữu. Admin bootstrap không phải công cụ reset mật khẩu
account đã tồn tại. `monitoring.env` chỉ nên chứa biến `MONITORING_*`.

Các `${HANDOFF_*:-default}` trong YAML dùng giá trị env nếu được khai báo, ngược
lại dùng mặc định. Shell environment cũng có thể override Compose: không export
`HANDOFF_*`, `MONITORING_*` hay `COMPOSE_*` từ deployment khác khi chạy Compose
trực tiếp. Hai launcher hiện tại loại các biến này khỏi môi trường tiến trình Docker;
giá trị lấy từ file `.env` được nạp tường minh.
Env monitoring được nạp sau demo env nên không đặt biến HANDOFF trùng ở đó.

Kiểm tra trước khi áp dụng (không xuất password/secret):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action config
```

Lệnh này kiểm tra tên project, cổng UI, các giá trị bắt buộc, giới hạn worker,
file monitoring và cú pháp Compose. Nó chỉ in tên file và trạng thái kiểm tra;
không in mật khẩu/JWT. Node.js 22+ và Docker Desktop Linux containers cần có
trên máy chạy launcher. Nếu cấu hình sai, launcher dừng trước khi chạy `up`.

Sau khi sửa env: dừng Watchdog bằng Ctrl+C nếu đang chạy, rồi chạy
`powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action start`.
Compose có thể recreate container; `restart` đơn thuần không nạp env/limit mới.
`-Action stop` giữ dữ liệu. Không dùng down -v/reset cursor.

## Recovery / giới hạn tài nguyên

- CPU/RAM/PID từng worker: `HANDOFF_*_CPUS`, `*_MEMORY`, `*_PIDS` trong demo-new.env;
  mặc định và bảng biến ở [WORKER_RESOURCE_LIMITS](../docs/WORKER_RESOURCE_LIMITS.md).
- Watchdog: `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/start-recovery-demo.ps1`, policy
  `tools/resilience-watchdog/demo.config.json`, state/audit `runtime/watchdog/`.
- Autoscaler chưa có actuator demo; đổi resource limit không bật autoscale.

## Máy bạn cùng nhóm — tách riêng

`node runtime/teammate-demo.mjs start` ->
`runtime/teammate-demo/demo.env` + `manifest.json`. Script sinh project ngẫu nhiên,
secret mới, UI mặc định 5183. Không dùng demo-new.env/monitoring.env của máy gửi.
Xem [TEAMMATE_FRESH_DEMO](../docs/TEAMMATE_FRESH_DEMO.md).

## Các file khác không được demo launcher tự nạp

| Bộ file | Mục đích |
|---|---|
| `handoff.env` | Dựng thủ công bằng Compose với project/cấu hình riêng |
| `handoff-live.env` | Event Feed riêng, cần live overlay và preflight boundary/lineage |
| `handoff-catalog.env` | Catalog riêng, cần catalog overlay và credential riêng |
| `handoff-ai.env` | Qwen riêng, cần nạp env cùng analytical overlay và quyền gọi provider |
| `source-connector.env`, `catalog-sync.env`, `qwen.env` | Các workflow triển khai riêng trước đây; không tự nối vào demo mới |
| `runtime/v2-dev.env` | Cấu hình cho workflow V2 dev khác; không phải file explicit của new-demo.ps1 |
| `*.env.example` | Mẫu công khai, không được container tự đọc |

Demo đang mô tả là offline: không tự có event/catalog/chat AI chỉ vì đã điền key
vào file khác. Kích hoạt live/Qwen là bước riêng, không nằm trong chuẩn hóa này.
Không xóa file cấu hình cũ hoặc chuyển secret giữa hai môi trường tự động.
