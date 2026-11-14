# Bản sửa nhãn phễu lịch sử — chờ xác nhận

Ngày 14/11/2026. Đã sửa và kiểm thử local. **Chưa commit, push hoặc deploy VPS.**

## Vấn đề và nguyên nhân

Database cho phép đọc profile đã ngừng kích hoạt để xem lịch sử. API đã lấy `disabled_at` từ activation của đúng nguồn nhưng không trả trường này về giao diện. Vì vậy người xem không biết profile còn đang kích hoạt hay chỉ đang đọc lịch sử.

## Giải pháp đã thực hiện

API chi tiết phễu trả thêm `profile.disabled_at`, không thay truy vấn hoặc cách tính:

| API trả | Giao diện hiển thị |
|---|---|
| Thời điểm ngừng | **Phễu lịch sử**, thời điểm UTC, cảnh báo không suy chuyển đổi của đơn CDC hiện tại từ số liệu này |
| `null` | Profile đang được kích hoạt cho nguồn; không chứng nhận dữ liệu mới hoặc đã đối soát |
| Không có trường (API cũ) | Chưa xác định trạng thái kích hoạt, máy chủ chưa cung cấp thông tin |

Giữ nguyên số liệu và quyền đọc lịch sử. Không bật lại profile, không đổi snapshot hay gate. Trường bổ sung không phá các client cũ; frontend mới nhận API cũ sẽ hiển thị trạng thái chưa xác định.

## File thay đổi trong lượt này

- `apps/dashboard-api/src/lib/v2-analytics-repository.js`: trả thời điểm ngừng activation.
- `apps/dashboard-api/test/v2-analytics-repository.test.js`: kiểm tra profile disabled và enabled.
- `apps/dashboard-web/src/lib/analytics-api.ts`: khai báo field tùy chọn để tương thích API cũ.
- `apps/dashboard-web/src/ui-template/FunnelView.tsx`: trình bày ba trạng thái.
- `apps/dashboard-web/test/funnel-browser.mjs`: thêm ba ca browser cho disabled, enabled và API cũ.
- `tools/api-docs/public/openapi-v2.yaml`: mô tả trường API mới.

Workspace còn các sửa đổi của những lượt trước và các thay đổi đã tồn tại trước khi bắt đầu. Chưa stage hoặc gom chúng thành commit.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Playwright trên Chromium local với API giả lập | 20/20 đạt |
| API query/repository/HTTP tests | 14/14 đạt |
| Frontend unit tests | 20/20 đạt |
| TypeScript và Vite production build | Đạt |

Các ca browser mới xác nhận phễu lịch sử vẫn hiển thị dữ liệu, profile enabled không bị gắn nhãn lịch sử và API cũ không bị suy thành enabled. Chưa nghiệm thu bản sửa trên VPS; chưa chạy validator toàn bộ OpenAPI trong lượt này.

- [Ảnh phễu lịch sử — dữ liệu thử, viewport mobile](../../apps/dashboard-web/test/artifacts/historical-profile/historical-profile.png).
- [Kết quả Playwright](../../apps/dashboard-web/test/artifacts/historical-profile/results.json).
- [Unit test log](../../apps/dashboard-web/test/artifacts/historical-profile/unit-tests.txt).
- [Build log](../../apps/dashboard-web/test/artifacts/historical-profile/build.txt).

## Phần đối soát còn lại

Thiếu snapshot là thiếu dữ liệu/bằng chứng vận hành, không được xử lý bằng cách đổi nhãn hoặc tạo dữ liệu giả. Chưa nạp snapshot vì chưa có manifest nguồn và projection cùng phạm vi để so sánh. Bản sửa này giải quyết việc nhận diện phễu lịch sử, không tuyên bố đã giải quyết đối soát.

Sau khi người dùng xem và xác nhận mới thực hiện commit/push theo phạm vi đã thống nhất. Triển khai VPS và nghiệm thu live là bước riêng tiếp theo.

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

