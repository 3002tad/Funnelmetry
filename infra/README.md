# Local infrastructure

Thư mục này giữ cấu hình môi trường dùng chung và schema PostgreSQL cho quá trình
phát triển local.

- Sao chép `.env.example` thành `.env` và điền giá trị phù hợp trên máy cá nhân.
- Các ứng dụng Node nạp trực tiếp file này bằng tùy chọn `--env-file`.
- `postgres/` chứa schema và dữ liệu khởi tạo còn được dùng để tham khảo khi xây V2.

Manifest k3s và workflow CI/CD V1 đã được loại bỏ. Không có lệnh deploy cluster
được hỗ trợ trong cấu trúc hiện tại.

Xem [cấu trúc repository](../docs/REPOSITORY_LAYOUT.md) và
[hướng dẫn gốc](../README.md).
