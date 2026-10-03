# Khởi động lại demo private trên Laptop 2

> Hướng dẫn **resume trên máy đã cấu hình**, không phải chuyển server. Xem [mục lục runtime](README.md) để chọn đúng cấu hình/capability.

Bấm đúp `Streaming_Pipeline/start-private-demo.cmd`. Có thể chạy file từ bất kỳ
thư mục nào. Launcher bật Docker Desktop nếu cần, PostgreSQL/Kafka,
Source Connector và các worker canonical/telemetry/journey/funnel/KPI, API private có Qwen,
rồi chạy UI ẩn và mở http://localhost:5180.

Chỉ dành cho bộ container private đã được thiết lập trên máy này. Không phải bộ
cài mới: không build/pull image, migrate/seed database, tạo tài khoản, đổi key hoặc
nạp lại cấu hình container. File env vẫn được ignore Git. Không chạy profile
publisher lại vì profile đã có trong database. Không gọi model hoặc gửi event test.

Nếu thiếu container/dependency hoặc trùng cổng, launcher dừng và báo lỗi; các dịch
vụ đã bật được giữ nguyên. API demo cũ phải tắt để nhường cổng 32000. UI do launcher
mở được tái sử dụng khi chạy lại; UI khác đang chiếm 5180 cần đóng trước.
Log UI: `runtime/private-ui.log` và `runtime/private-ui-error.log` (ignored).

Launcher không bật Input Gateway hoặc Tailscale cũ, cũng không tự dừng/xóa chúng
nếu đã chạy từ trước. Source Connector chủ động đọc HTTPS Event Feed bằng cấu hình
đã nạp trong container và tiếp tục cursor đã lưu, không reset cursor về 0.

Kiểm tra PostgreSQL/Kafka/Connector process health, HTTP API/UI và worker đang chạy;
kiểm tra riêng Connector `/readyz`. Nếu Source chưa sẵn sàng, cảnh báo và vẫn mở UI
để xem dữ liệu đã lưu. Không coi container healthy là bằng chứng canonical/KPI đã
xử lý xong; không tự gọi AI, tạo order hoặc gửi event test.

Yêu cầu bộ container pull đã được triển khai theo
`docs/SOURCE_CONNECTOR_ACTIVATION_2026-09-20.md`. Nếu thiếu container, dừng rõ ràng,
không fallback sang Gateway cũ hoặc tự tạo database. Sửa `.env` không tự cập nhật
environment của container: cần recreate riêng dịch vụ theo hướng dẫn deployment.
Không dùng launcher sau restore/recreated Kafka khi chưa có quy trình safe replay.

Event mới vẫn cần phía Medusa/Source Ingress online. Tắt Docker không xóa volume;
không dùng `down -v` để dừng demo.
