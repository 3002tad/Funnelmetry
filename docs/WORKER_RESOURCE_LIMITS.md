# Giới hạn worker cho handoff/demo

Với deployment mới dùng [`infra/compose.yaml`](../infra/compose.yaml), xem [UNIFIED_COMPOSE.md](UNIFIED_COMPOSE.md): cùng bảy service bên dưới **cộng thêm** `funnel-maturity-scheduler` với `HANDOFF_MATURITY_CPUS`, `HANDOFF_MATURITY_MEMORY`, `HANDOFF_MATURITY_PIDS` (mặc định 1 CPU/512 MiB/128 PID). Các số liệu runtime ở cuối tài liệu chỉ áp dụng cho demo cũ `funnelmetry-demo-new`, không phải xác nhận limit của deployment mới.

Cấu hình: `infra/compose.handoff-pipeline.yml`. Mỗi container worker mặc định có
CPU quota **1 CPU**, RAM **512 MiB**, PID/thread tối đa **128**. Đây là mức thử nghiệm
cho demo, chưa benchmark tải; không phải SLA hoặc tài nguyên được đặt trước.

| Worker | Tiền tố biến cấu hình |
|---|---|
| canonical-normalizer | HANDOFF_NORMALIZER |
| canonical-ledger-writer | HANDOFF_LEDGER |
| ingress-telemetry-writer | HANDOFF_TELEMETRY |
| journey-processor | HANDOFF_JOURNEY |
| funnel-processor | HANDOFF_FUNNEL |
| kpi-projector | HANDOFF_KPI |
| profile-publisher (job chạy một lần) | HANDOFF_PUBLISHER |

Mỗi tiền tố có `_CPUS`, `_MEMORY`, `_PIDS`. Ví dụ tăng riêng Journey:

```dotenv
HANDOFF_JOURNEY_CPUS=1.5
HANDOFF_JOURNEY_MEMORY=768m
HANDOFF_JOURNEY_PIDS=128
```

Điền vào **env thực sự được launcher dùng**: `runtime/demo-new.env`,
`runtime/teammate-demo/demo.env`, hoặc env handoff của deployment tương ứng.
Không cần build/publish lại image. Dừng Watchdog trước, rồi chạy launcher start
đúng project để Compose recreate container bị đổi; `docker restart` không nạp limit mới.
Không xóa volumes/cursor. Recreate có thể tạm ngắt xử lý trong lúc worker resume.

Giới hạn áp dụng cho **mỗi replica**: sáu worker thường trực có tổng RAM ceiling
3 GiB; publisher thêm 512 MiB khi chạy. Còn phải dành RAM/CPU cho Kafka,
PostgreSQL, API/UI, monitoring và Docker/OS. Không suy host capacity hay số replica
an toàn từ các con số này, không tự bật autoscale. CPU quota không phải CPU pinning.

RAM limit không phải giới hạn riêng JS heap, cũng không đặt swap policy; swap còn
theo Docker/host. Chưa chỉnh `NODE_OPTIONS`. RAM quá thấp có thể gây OOM kill,
CPU quá thấp có thể tăng lag hoặc trễ health probe. Theo dõi OOMKilled, restart,
CPU/RAM và Kafka lag trước khi hạ giới hạn. PID cap bao gồm threads và probe process.

Phạm vi này chỉ là bảy service trong handoff pipeline, không thay limit Source
Connector/catalog, PostgreSQL/Kafka hay các Compose deployment khác.
Việc thêm cấu hình không đồng nghĩa container đang chạy đã được áp dụng.

## Áp dụng trên demo — 11/10/2026

Project `funnelmetry-demo-new`: đã recreate riêng sáu worker và profile-publisher
bằng Compose `up --no-deps --pull never`, sau khi xác minh không có lock Watchdog.
Docker HostConfig của cả bảy container xác nhận NanoCpus=1000000000,
Memory=536870912, PidsLimit=128. Sáu worker `/readyz` trả ready=true;
publisher exit 0, không OOMKilled tại thời điểm kiểm tra; UI HTTP 200.
Container ID và StartedAt của PostgreSQL/Kafka/API/UI/Prometheus/Grafana không đổi.
Không xóa volume, reset cursor hoặc tạo event test. Đây là xác minh limit/runtime
readiness, chưa phải benchmark tải hay acceptance xử lý event dưới giới hạn mới.
