# Kết quả chẩn đoán PostgreSQL thật — 14/11/2026

> Cập nhật: đã sửa API/UI local để nhận diện phễu lịch sử. Xem [bản sửa chờ xác nhận](BAN_SUA_CHO_XAC_NHAN_2026-11-14.md). Chưa commit/push/deploy; phần chẩn đoán bên dưới giữ bằng chứng trước sửa.

Thời điểm database ghi nhận: **20:13:25 ngày 14/11/2026 (Asia/Bangkok)**. Database: `funnelmetry_handoff` trên VPS. Kết nối bằng SSH hiện có và psql trong container PostgreSQL, không đọc file mật khẩu.

## 1. Đã tìm được nguyên nhân trực tiếp của UNAVAILABLE

| Kiểm tra trực tiếp | Kết quả |
|---|---:|
| Snapshot đối soát trên tất cả nguồn, toàn thời gian | 0 |
| Snapshot của `medusa-reference`, toàn thời gian | 0 |
| Snapshot của nguồn đó từ 16/10 đến trước 15/11 UTC | 0 |
| Comparison đối soát trên tất cả nguồn | 0 |

**Kết luận:** API báo chưa có bằng chứng đối soát là đúng với dữ liệu hiện có. Không phải do người dùng chọn nhầm khoảng ngày. Chưa có cơ sở sửa câu SQL hoặc đổi trạng thái gate để hết cảnh báo.

**Nguyên nhân vận hành xác định được đến đâu?** Không thấy service reconciliation trong danh sách Swarm tại thời điểm kiểm tra. Package reconciliation hiện khởi chạy `src/cli.js`, nhận snapshot/projection/comparison do bên gọi cung cấp; không phải daemon tự lấy dữ liệu Medusa. Không tìm thấy khai báo reconciliation trong các file Swarm local đã tìm.

Các bằng chứng này cho thấy đường tạo bằng chứng đối soát chưa có kết quả được lưu vào database này. Chưa kiểm tra cron/systemd hoặc lịch sử xóa/restore nên không khẳng định chưa từng có tác vụ chạy, hay bảng chưa từng có dữ liệu. Các quality lease/snapshot riêng của CDC không được đánh đồng với bảng reconciliation này.

## 2. Một phát hiện quan trọng về màn phễu

| Profile | Phiên bản | Trạng thái activation |
|---|---|---|
| commerce-conversion | 2.0.0 | Disabled từ 2026-10-30 16:24:13 UTC |
| online-payment | 1.0.0 | Disabled từ 2026-10-30 16:24:13 UTC |

Horizon và grace của cả hai profile đều null. Profile commerce vẫn có hai instances đạt cả bốn bước trong khoảng kiểm tra. Đây là dữ liệu lịch sử; đọc được không chứng minh profile đang nhận sự kiện mới.

API cố ý cho phép đọc profile lịch sử nhưng chưa đưa `disabled_at` trong phần profile trả ra cho frontend. Vì vậy màn phễu dễ khiến người dùng tưởng cấu hình vẫn đang hoạt động. Đây là khoảng trống thông tin cần sửa ở API/UI, không phải lý do bật lại profile đã ngừng. CDC order current-state không được đổi thành terminal `order.placed` để làm đầy phễu lịch sử.

## 3. Đã đo SQL thật

Truy vấn được lấy từ repository local hiện tại, gắn tham số cố định, chạy trên dữ liệu VPS trong một transaction **REPEATABLE READ READ ONLY**. Đã kiểm tra `transaction_read_only=on` và kết thúc bằng ROLLBACK.

| Query | Nội dung | Execution time |
|---|---|---:|
| 1 | Tìm profile/version | 0,136 ms |
| 2 | Tổng số liệu phễu | 0,389 ms |
| 3 | Số liệu từng bước phễu | 0,249 ms |
| 4–10 | Các truy vấn Data Health/đối soát | 0,090–1,939 ms mỗi truy vấn |

Truy vấn phễu dùng index theo nguồn/profile/version/entry_at. **Chưa có bằng chứng truy vấn phễu là nút thắt ở lượng dữ liệu và phạm vi hiện tại**, vì vậy không thêm index hoặc viết lại SQL trong lượt này.

Đây là một lần đo EXPLAIN ANALYZE, không phải benchmark tải lớn hoặc p95. Một số SELECT chạy trước EXPLAIN nên cache có thể đã ấm. Thời gian trên không bao gồm planning, SSH, HTTP hoặc render giao diện. SQL lấy từ local, không xác nhận byte-for-byte giống image API đang chạy. Không cộng các thời gian này thành latency người dùng.

## 4. Cách sửa đúng sau chẩn đoán

1. **Làm rõ profile lịch sử trên UI:** đưa thời điểm vô hiệu hóa vào response, hiển thị nhãn lịch sử khi có giá trị; giữ quyền đọc dữ liệu cũ. Bổ sung test profile active và disabled. Chưa sửa sản phẩm trong lượt chẩn đoán này.
2. **Xác định đối tượng cần đối soát:** snapshot nguồn và projection phân tích phải cùng entity, source, phạm vi và thời điểm. Không dùng CDC trạng thái hiện tại để xác nhận conversion lịch sử.
3. **Chuẩn bị bộ dữ liệu đối soát thật và quy trình nạp:** dùng CLI hiện có với manifest versioned. Kiểm tra trên database thử trước khi ghi live; sau nạp chạy compare và xem chênh lệch, không đặt RECONCILED thủ công.
4. **Nếu mục tiêu là chất lượng CDC hiện tại:** dùng contract/quality CDC tương ứng, trình bày riêng khỏi gate đối soát lịch sử. Cần kiểm chứng endpoint/coverage cụ thể trước khi thiết kế thay đổi.
5. **Đo lại SQL khi tải tăng hoặc có triệu chứng chậm:** giữ bằng chứng hiện tại làm mốc, không tối ưu theo cảm giác.

## 5. Phạm vi an toàn và bằng chứng

Không ghi dữ liệu nghiệp vụ, không nạp snapshot, không replay, không thay schema/index, không bật lại profile và không deploy. Đọc service replicas không chứng nhận end-to-end health; các one-shot service 0/1 chưa được phân loại thành lỗi.

- [SQL đã thực thi](evidence/funnel-db-2026-11-14/probe.sql).
- [Kết quả database và execution plans](evidence/funnel-db-2026-11-14/probe-output.txt).
- [Ánh xạ truy vấn/tham số](evidence/funnel-db-2026-11-14/query-map.json).
- [Script thực thi chỉ đọc](../../apps/dashboard-api/scripts/funnel-readonly-probe.mjs).

Script gắn container và scope của lần chẩn đoán này; cần xác định lại container khi chạy lần khác. Các bảng rỗng là kết quả quan sát ở thời điểm trên, không phải cam kết trạng thái luôn giữ nguyên.

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

