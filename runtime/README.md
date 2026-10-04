# Runtime — đọc trước khi khởi chạy

Thư mục này giữ launcher, cấu hình local và bằng chứng vận hành. Không phải bộ cài tổng quát. Quay lại [mục lục tài liệu](../docs/README.md).

## Chọn đúng thao tác

| Muốn làm gì | Đọc / dùng | Không được hiểu nhầm |
|---|---|---|
| Mở lại demo đã cấu hình trên máy này | [START_PRIVATE_DEMO](START_PRIVATE_DEMO.md), `../start-private-demo.cmd` | Resume container có sẵn, không tạo/migrate/seed môi trường mới |
| Cấu hình Source Connector | [worker README](../workers/source-connector/README.md), [env mẫu](source-connector.env.example) | HTTPS pull; sửa file không tự đổi env container |
| Bật Qwen/tool | [API AI README](../apps/dashboard-api/src/lib/ai/README.md), [env mẫu](qwen.env.example), [analytics](../analytics/README.md) | Flag không tự cài DB view/catalog; không chứng minh provider khỏe |
| Đồng bộ catalog sản phẩm | [worker README](../workers/catalog-sync/README.md), [env mẫu](catalog-sync.env.example) | Credential Medusa Admin riêng; one-shot khác worker định kỳ |
| Đọc lần kích hoạt order analytics cũ | [Bằng chứng 27/09](ORDER_ANALYTICS_ACTIVATION_2026-09-27.md) | Snapshot lịch sử, không chạy lại lệnh như clean bootstrap |
| Tìm cấu hình Tailscale/Gateway trước đây | [Private ingress lịch sử](../infra/PRIVATE_INGRESS.md) | Không thuộc transport baseline hiện hành; không bật thay Source Connector |
| Chuyển sang máy khác | [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) | Chọn chế độ, kiểm tra isolation/backup/checkpoint; không copy Kafka volume |

## File nào được chia sẻ?

Bộ khung image-based bàn giao phát triển mới: [Handoff Docker](../infra/HANDOFF.md).
Trạng thái phát hành và hướng dẫn máy nhận: [CODEX_HANDOFF](../CODEX_HANDOFF.md).
Ba image đã publish ngày 04/10/2026; kết nối live/AI trên máy nhận vẫn cần preflight
và acceptance riêng. Không kèm database cũ hoặc secrets trong image.

- `*.env.example`: mẫu cấu hình trong Git, không chứa credential thật.
- `*.env`, logs và `backups/`: local/ignored, có thể chứa dữ liệu nhạy cảm. Không zip cả thư mục để gửi hoặc commit.
- `dashboard-private.env`: cấu hình local của Dashboard API hiện có; không có nghĩa mọi máy đều đã được cấp tài khoản, DB và key tương ứng.
- `private-ui.log`, `private-ui-error.log`: chẩn đoán UI local, không chứng minh worker/Source khỏe.
- Browser-only chat history không nằm trong backup PostgreSQL; không chuyển browser profile/token sang máy bạn.

## Trước khi đổi cấu hình

1. Xác định đúng service, cách nạp config (process env, env-file, mount hay DB).
2. Không in toàn bộ env hoặc Docker inspect chứa secret vào log/chat.
3. Restart không luôn nạp env mới; kiểm tra deployment của từng service trước khi recreate.
4. Giữ nguyên tên `private` để tương thích script/mount. Đây không phải khẳng định hệ thống còn cần VPN.
5. Không reset cursor, xóa volume hoặc replay lịch sử để xử lý lỗi UI/đăng nhập.

Đợt dọn tài liệu 03/10/2026 chỉ bổ sung điều hướng; không di chuyển hoặc sửa file cấu hình thực tế.
