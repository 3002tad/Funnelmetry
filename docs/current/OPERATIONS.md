# Vận hành và kiểm chứng

## Kiểm tra trạng thái

1. Xác nhận stack/service/task với `docker stack services <stack>` và `docker service ps <service>`; xem log khi replica không đạt desired state. One-shot jobs Complete có thể hiển thị `0/1`.
2. Kiểm tra Source Connector feed/cursor và Kafka handoff riêng với projection downstream; Feed có event không chứng minh normalizer/ledger/funnel đã cập nhật.
3. Kiểm tra CDC Connect, ba profile, Kafka offset, writer/sink và quality lease. Với order state, đối chiếu coverage epoch, current ON/OFF, fact offset và inbox; với catalog/offer, đối chiếu snapshot/current source và freshness.
4. Kiểm tra Dashboard API/Web qua đường tunnel, quyền role và endpoint liên quan. HTTP 200 hoặc container healthy chỉ là một tín hiệu, không thay đối soát dữ liệu.

Các lệnh/probe CDC và điều kiện phục hồi cụ thể nằm ở [CDC operations](../../tools/cdc-operations/README.md). Dùng [test suite](../../tests/README.md) cho thay đổi code; `node runtime/swarm.mjs check`/`check-app` chỉ kiểm tra cấu hình/render. Tránh chạy fixture Compose hoặc reset cursor/volume trên live stack.

## Giám sát và xử lý sự cố

Monitoring Swarm là overlay tùy chọn [`infra/swarm-monitoring.yml`](../../infra/swarm-monitoring.yml), với credential metrics-only và quyền riêng. Prometheus/Grafana/worker readiness cần được xác minh theo deployment; credential hết hạn/rotation phải được quản lý. Admin UI chủ yếu quan sát: trạng thái feed, processing, Kafka lag, event trace và warning có thể là snapshot hoặc unknown. Không xem số 0/healthy đơn lẻ là bằng chứng coverage hoặc end-to-end.

Khi mất CDC slot/WAL, không tạo lại slot `no_data` rồi nhận là đã khôi phục lịch sử. Ghi gap `INCOMPLETE`, tạo coverage epoch/snapshot mới, đối soát nguồn và kiểm tra quality lease trước khi cho read path dùng dữ liệu. Đối với Source Connector, giữ cursor và retention/replay boundary; phục hồi PostgreSQL/Kafka là quy trình riêng. Không tăng replica stateful hay chạy hai Connect cùng slot để xử lý lag.

Các báo cáo kiểm chứng theo thời điểm được lưu ở [archive](../archive/README.md); chúng không phải trạng thái runtime hiện nay.
