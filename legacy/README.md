# Legacy V1

Code trong thư mục này chỉ được giữ để đối chiếu và hỗ trợ migration có kiểm
soát. Nó không được build/deploy mặc định và không phải căn cứ kiến trúc V2.

- `clients/dashboard`: dashboard V1.
- `services/tracking-api`: ingestion V1.
- `services/streaming-processor`: processor Python V1 nguyên khối.
- `services/commerce-backend`: source commerce stand-in V1.
- `sdk/browser-behavior-sdk`: Browser SDK V1.
- `bot-simulator`: shell simulator lịch sử.
- `docs-v1`: tài liệu runtime, API và báo cáo của kiến trúc V1.

Không thêm capability V2 mới vào đây. Chỉ sửa khi cần tạo fixture hoặc chứng minh
hành vi migration cụ thể.
