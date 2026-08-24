# Local infrastructure

Thư mục này giữ cấu hình môi trường dùng chung và schema PostgreSQL cho quá trình
phát triển local.

- Sao chép `.env.example` thành `.env` và điền giá trị phù hợp trên máy cá nhân.
- `load-env.mjs` nạp file `infra/.env` cho các ứng dụng cần dùng chung cấu hình.
- `postgres/` chứa schema và dữ liệu khởi tạo còn được dùng để tham khảo khi xây V2.

Manifest k3s và workflow CI/CD V1 đã được loại bỏ. Không có lệnh deploy cluster
được hỗ trợ trong cấu trúc hiện tại.

Xem [cấu trúc repository](../docs/REPOSITORY_LAYOUT.md) và
[hướng dẫn gốc](../README.md).
