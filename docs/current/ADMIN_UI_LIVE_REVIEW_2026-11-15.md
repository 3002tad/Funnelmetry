# Đánh giá UI Admin đang chạy trên VPS — 15/11/2026

## Kết luận dễ hiểu

Admin hiện tại mở được các màn chính, nhưng khó đọc nhanh: phần đầu trang lặp nhiều thông tin, nhãn kỹ thuật dày, trạng thái thiếu dữ liệu chiếm nhiều diện tích. Trên điện thoại, bảng không tràn toàn trang nhưng các cột bên phải nằm ngoài vùng nhìn ban đầu.

Đổi màu chưa giải quyết được những điểm này. Cần chỉnh thứ tự thông tin, bố cục bảng và cách trình bày trạng thái. Đây là báo cáo khảo sát; chưa sửa hay deploy UI trong lượt kiểm tra này.

## Đã kiểm tra gì?

- Đăng nhập Admin được người dùng cho phép trên `https://analyst.entidi.io.vn`.
- Playwright/Chromium chạy trên máy làm việc, truy cập hệ thống thật trên VPS qua HTTPS; không phải trình duyệt chạy bên trong VPS.
- Mở 7 màn: Pipeline, Auto Scaling, Health & Recovery, Nguồn dữ liệu, Điều tra sự kiện, Tài khoản & phân quyền, Audit tài khoản.
- Chụp 14 ảnh: desktop 1440 × 1000 và mobile 390 × 844.
- Kết quả thu thập không ghi nhận lỗi JavaScript hoặc HTTP lỗi trong phạm vi script. Không có tràn ngang ở cấp tài liệu trong 14 lần chụp.
- Chỉ xem giao diện; không tạo/khóa tài khoản, đổi quyền hoặc sửa cấu hình. Chưa kiểm thử đầy đủ tab phụ, bộ lọc, phân trang, modal, cuộn ngang bảng hay thao tác ghi dữ liệu. Không phải kiểm thử hiệu năng hoặc xác nhận pipeline E2E.

## Vấn đề, nguyên nhân và cách sửa

Nguyên nhân dưới đây là phân tích từ giao diện quan sát được; chưa phải kết luận truy vết toàn bộ CSS/backend.

| Ưu tiên | Hiện tượng thực tế | Nguyên nhân thể hiện trên UI | Cách sửa đề xuất | Kết quả mong đợi, chưa triển khai |
|---|---|---|---|---|
| Cao | Mobile Recovery/Audit chỉ thấy các cột bên trái; thông tin và thao tác bên phải ngoài vùng nhìn | Bảng desktop được giữ trong khung hẹp | Giữ cột quan trọng và nút chi tiết; chuyển phần còn lại vào chi tiết hoặc thẻ trên mobile. Nếu giữ bảng cuộn, thêm dấu hiệu cuộn rõ ràng | Người dùng xem trạng thái và mở chi tiết ngay ở 390px |
| Cao | Pipeline có banner readiness lớn, KPI readiness và danh sách READY cùng xuất hiện | Một tín hiệu được nhắc nhiều lần ở nhiều cấp | Đưa KPI tổng quan lên đầu, gộp lời giải thích, dành banner nổi bật cho việc cần chú ý; giữ giải thích readiness không chứng minh E2E | Nhìn nhanh biết cần kiểm tra gì mà không mất ý nghĩa dữ liệu |
| Cao | Auto Scaling dài 1.691px ở desktop, nhiều ô lặp “Chưa cấu hình policy” và “Chưa có dữ liệu” | Các vùng policy/capacity vẫn trình bày đầy đủ khi chưa có cấu hình hoặc số đo | Một khối tóm tắt phần chưa có dữ liệu, mở rộng để xem chi tiết; ưu tiên replica/RAM đã đo | Trang ngắn hơn, phân biệt được số đo hiện có và phần chưa xác minh |
| Vừa | Nhiều màn có tiêu đề trang rồi tiêu đề khối gần như giống nhau; mô tả chung lặp lại | Khung trang và khung nội dung đều tự giới thiệu | Một tiêu đề chính, mô tả riêng theo nhiệm vụ; bỏ nhãn lặp không giúp quyết định | Nội dung chính xuất hiện sớm hơn |
| Vừa | Nhãn phụ, thời gian, tên worker và mã quyền khó đọc nhanh | Chữ nhỏ, nhiều dòng kỹ thuật; READY sát tên worker trên Pipeline | Tăng độ dễ đọc; mỗi worker một hàng với tên, trạng thái và thời gian tách rõ; đưa mã quyền vào phần chi tiết | Đọc tên/trạng thái nhanh hơn mà vẫn tra được kỹ thuật |
| Vừa | Nguồn dữ liệu có vùng “Lọc nguồn” với mũi tên/icon/nhãn rời nhau | Bộ lọc thu gọn chưa có hình thức điều khiển nhất quán | Gộp thành một nút có nhãn, căn icon và vùng bấm rõ | Nhận ra đây là bộ lọc có thể mở |
| Vừa | Investigation hiển thị `mapping_not_found`, `unmapped-v1` trực tiếp | Mã kỹ thuật đang là lời giải thích chính | Thêm câu “Không tìm thấy ánh xạ phù hợp”, giữ mã để tra cứu và liên kết Trace | Hiểu lý do trước, đọc mã khi cần điều tra |
| Vừa | Biểu đồ Scaling có nhiều chấm dày; nhãn trục chỉ có giờ trong khoảng 24h | Mỗi mẫu có marker và thời gian thiếu ngày/múi giờ | Giảm marker hiển thị, giữ nguyên dữ liệu; tooltip đầy đủ ngày/giờ/múi giờ | Biểu đồ rõ hơn, không nhầm hai mốc thuộc hai ngày |
| Vừa | Tài khoản có chuỗi quyền kỹ thuật luôn mở, nút bị vô hiệu hóa thiếu giải thích nhìn thấy được | Phần giải thích quyền và thao tác chiếm cùng mức ưu tiên | Tóm tắt vai trò bằng tiếng Việt; mã quyền mở rộng; giải thích lý do nút bị khóa bằng nội dung hỗ trợ truy cập được | Hiểu vai trò và giới hạn thao tác dễ hơn |
| Thấp | Audit dài, nhiều dòng `preferences.updated`; tiêu đề lặp | Dữ liệu nhật ký thô có mật độ lớn | Giữ từng bản ghi và phân trang, thêm tên hành động dễ đọc; bộ lọc hành động nổi bật; chi tiết thay đổi mở theo dòng | Dễ tìm hành động quan trọng, không mất bằng chứng audit |

## Những gì không được “sửa đẹp” bằng cách che dữ liệu

- Kafka lag đang hiện `NOT_CONFIGURED`/chưa đo. Không được đổi thành 0 hoặc xanh “ổn định”. Muốn có giá trị phải kiểm tra tích hợp đo và cấu hình runtime riêng.
- Recovery controller hiện `UNVERIFIED`, liveness chưa đo. Readiness 7/7 không chứng minh controller phục hồi hoạt động hoặc toàn tuyến xử lý thành công.
- Nguồn có trạng thái kết nối chưa xác minh; retained records không chứng minh nguồn đang kết nối trực tiếp.
- Accepted receipts 276 và canonical retained 277 thuộc đơn vị đếm khác nhau. Không lấy hiệu để kết luận mất hay dư sự kiện.
- Một sự kiện unsupported xuất hiện với lý do thiếu mapping. Cần xem Trace và hợp đồng nguồn trước khi kết luận lỗi hay bổ sung mapping.

## Số đo bố cục

Chiều cao dưới đây là chiều cao tài liệu được script ghi lại, không phải thời gian tải.

| Màn | Cao desktop (px) | Cao mobile (px) | Tràn ngang toàn trang |
|---|---:|---:|---|
| Pipeline | 1040 | 1873 | Không ghi nhận |
| Auto Scaling | 1691 | 1945 | Không ghi nhận |
| Health & Recovery | 1085 | 1367 | Không ghi nhận |
| Nguồn dữ liệu | 1000 | 863 | Không ghi nhận |
| Điều tra sự kiện | 1000 | 844 | Không ghi nhận |
| Tài khoản & phân quyền | 1000 | 997 | Không ghi nhận |
| Audit tài khoản | 1524 | 1545 | Không ghi nhận |

Không tràn toàn trang không đồng nghĩa mọi cột bảng đều thấy được trên mobile. Ảnh Recovery/Audit thể hiện rõ giới hạn này.

## Thứ tự triển khai đề xuất

1. Chỉnh bản UI preview riêng: khung trang, Pipeline và cách đọc bảng trên mobile.
2. Chỉnh Scaling/Recovery: tách số đo có thật khỏi trạng thái thiếu cấu hình, giảm các khối lặp.
3. Chỉnh bộ lọc Sources, lời giải thích Investigation, quyền Users và bảng Audit.
4. Kiểm thử lại 7 màn ở desktop/mobile, thêm kiểm tra tab, lọc, chi tiết và khả năng tiếp cận thao tác. Kiểm tra hiển thị không làm thay đổi số liệu hay quyền truy cập.
5. Sau khi duyệt preview mới áp dụng UI vào hệ thống và kiểm thử sau deploy.

## Bằng chứng riêng ngoài Git

- [Kết quả Playwright](../../../admin-live-review-20261115/results.json)
- [Script khảo sát](../../../admin-live-review-20261115/audit.mjs)
- [Pipeline desktop](../../../admin-live-review-20261115/pipeline-1440.png)
- [Scaling desktop](../../../admin-live-review-20261115/scaling-1440.png)
- [Sources desktop](../../../admin-live-review-20261115/sources-1440.png)
- [Investigation desktop](../../../admin-live-review-20261115/investigate-1440.png)
- [Users desktop](../../../admin-live-review-20261115/users-1440.png)
- [Recovery mobile](../../../admin-live-review-20261115/recovery-390.png)
- [Audit mobile](../../../admin-live-review-20261115/audit-390.png)

Các đường dẫn bằng chứng chỉ dùng trong workspace hiện tại. Ảnh/text có thể chứa thông tin tài khoản thật, được giữ riêng ngoài repository; cần rà soát trước khi chia sẻ. Báo cáo không chứa mật khẩu hoặc token.
