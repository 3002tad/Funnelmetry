# Khởi động lại demo private trên Laptop 2

Bấm đúp `Streaming_Pipeline/start-private-demo.cmd`. Có thể chạy file từ bất kỳ
thư mục nào. Launcher bật Docker Desktop nếu cần, PostgreSQL/Kafka/Tailscale,
Gateway và các worker canonical/telemetry/journey/funnel/KPI, API private có Qwen,
rồi chạy UI ẩn và mở http://localhost:5180.

Chỉ dành cho bộ container private đã được thiết lập trên máy này. Không phải bộ
cài mới: không build/pull image, migrate/seed database, tạo tài khoản, đổi key hoặc
nạp lại cấu hình container. File env vẫn được ignore Git. Không chạy profile
publisher lại vì profile đã có trong database. Không gọi model hoặc gửi event test.

Nếu thiếu container/dependency hoặc trùng cổng, launcher dừng và báo lỗi; các dịch
vụ đã bật được giữ nguyên. API demo cũ phải tắt để nhường cổng 32000. UI do launcher
mở được tái sử dụng khi chạy lại; UI khác đang chiếm 5180 cần đóng trước.
Log UI: `runtime/private-ui.log` và `runtime/private-ui-error.log` (ignored).

Readiness kiểm tra Gateway, HTTP API/UI và worker đang chạy, không chứng minh
canonical projection hoặc kết nối từ Ubuntu. Event mới vẫn cần phía Medusa/Relay
online. Tắt Docker không xóa volume; không dùng `down -v` để dừng demo.
