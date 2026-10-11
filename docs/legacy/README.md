# Legacy V1

Code trong thư mục này chỉ được giữ để đối chiếu và hỗ trợ migration có kiểm
soát. Nó không được build/deploy mặc định và không phải căn cứ kiến trúc V2.

- `clients/dashboard`: dashboard V1; xem [Tech stack](docs-v1/TECH_STACK.md) và [Repo map](docs-v1/REPO_MAP.md) §7.
- `services/tracking-api`: ingestion V1; xem [API](docs-v1/API.md) và [Repo map](docs-v1/REPO_MAP.md).
- `services/streaming-processor`: processor Python V1 nguyên khối; xem [Tech stack](docs-v1/TECH_STACK.md) và [Repo map](docs-v1/REPO_MAP.md).
- `services/commerce-backend`: source commerce stand-in V1; xem [Tech stack](docs-v1/TECH_STACK.md) và [Runtime](docs-v1/RUNTIME.md) §6–7.
- `sdk/browser-behavior-sdk`: Browser SDK V1; xem [Spec](docs-v1/SPEC.md) §5 và [Tech stack](docs-v1/TECH_STACK.md) §5.3.
- `bot-simulator`: shell simulator lịch sử; xem [Repo map](docs-v1/REPO_MAP.md) và `web-shop/behavior-bot/`.
- `docs-v1`: tài liệu [runtime](docs-v1/RUNTIME.md), [API](docs-v1/API.md) và [báo cáo](docs-v1/BAO_CAO_DU_AN.md) của kiến trúc V1.

Không thêm capability V2 mới vào đây. Chỉ sửa khi cần tạo fixture hoặc chứng minh
hành vi migration cụ thể.
