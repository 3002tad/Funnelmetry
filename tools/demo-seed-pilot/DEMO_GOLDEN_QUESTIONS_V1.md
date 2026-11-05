# Bộ câu hỏi phân tích demo v1

**Release:** `demo-commerce-analysis@1.0.0`. **Kỳ synthetic:** [2025-11-01, 2026-11-05) UTC. **Nguồn số:** `funnelmetry_demo` trên PostgreSQL Pipeline. SQL đầy đủ nằm trong [demo-golden-v1.sql](demo-golden-v1.sql); toàn bộ đáp án dạng JSON nằm trong [demo-golden-v1-answers.json](demo-golden-v1-answers.json). Đáp án Q01–Q14 đã đối chiếu độc lập với hai fixture; Q15 phản ánh trạng thái runtime tại lúc chụp và phải chạy lại khi đánh giá.

| ID | Câu hỏi | Đáp án chuẩn / giới hạn |
| --- | --- | --- |
| Q01 | Xu hướng session và browser event theo tháng thay đổi thế nào? | 13 nhóm tháng. Tháng 11/2025: 13.122 session, 35.720 event; tháng 12/2025: 16.097, 43.562; tháng 01/2026: 4.876, 13.090. Tháng 11/2026 chỉ có **4 ngày**: 1.750, 4.984; không so trực tiếp như một tháng đủ ngày. |
| Q02 | Thiết bị nào đóng góp nhiều session nhất? | Mobile 34.207, desktop 33.796, tablet 33.747; grain là session. |
| Q03 | Raw `utm_source` nào có nhiều session và session đã liên kết cart? | `social` nhiều session nhất: 17.170, trong đó 924 session có `cart_links`. `organic` có 16.983 session và 971 liên kết cart. Đây là thống kê liên kết synthetic, không chứng minh hiệu quả campaign thực. |
| Q04 | Sản phẩm nào được xem nhiều nhất? | “Wooden Bathroom Sink With Mirror”: 20.014 product-view event. Join product bằng `dataset_id, product_id`; tên dựa trên snapshot catalog, không chứng nhận tên lịch sử. |
| Q05 | Category nào có nhiều product-view event nhất tại thời điểm event? | Kitchen Accessories 25.403; Groceries 16.089. Join category qua khoảng hiệu lực `[valid_from, valid_to)`; tránh đếm nhân bản sự kiện. |
| Q06 | Người dùng tìm những từ khóa nào nhiều nhất? | `water bottle` 2.955, `running shoes` 2.949, `kitchen tool` 2.933, `travel bag` 2.900. Chỉ mô tả nhu cầu tìm kiếm. |
| Q07 | Giỏ hàng có bao nhiêu lần tăng, giảm và xóa dòng? | `ADD` 8.720 mutation trên 6.144 cart; `DECREASE` 572; `DELETE` 477. Mutation count khác cart count. |
| Q08 | Mỗi tín hiệu trong hành trình demo xuất hiện ở bao nhiêu session/order? | 101.750 session; 57.475 có product view; 5.661 có cart link; 3.709 có checkout started; 2.539 order row, 2.428 row ON. Các số ở grain khác nhau, không tự suy ra conversion tuần tự. |
| Q09 | Trạng thái order synthetic biến động theo tháng? | Toàn kỳ 2.428 ON và 111 OFF; tháng 11/2026 có 42 ON, 2 OFF. Đây là trạng thái tham chiếu synthetic, không đồng nghĩa payment thành công. |
| Q10 | Giá trị order line ghi nhận theo rule giá là bao nhiêu? | EUR minor units: `base` 14.545.482, `summer-sale` 838.766, `winter-sale` 1.425.135. Tổng 16.809.383 minor units; là giá trị dòng tại thời điểm order synthetic, không phải doanh thu thanh toán. |
| Q11 | Tổng hành động thanh toán synthetic là bao nhiêu? | EUR minor units: `AUTHORIZED` 16.809.383 (2.539 action), `CAPTURED` 13.331.722 (2.519), `REFUNDED` 437.777 (267). Có thể có nhiều action trên một order; không cộng ba nhóm thành doanh thu. |
| Q12 | Fulfillment đến trạng thái nào? | 1.931 order có SHIPPED, 1.611 order có DELIVERED; số transition lần lượt 2.174 và 1.790. Một order có thể có nhiều fulfillment. |
| Q13 | Có bằng chứng khách quay lại trong dữ liệu demo? | 1.091 customer synthetic có order evidence; 52 customer có từ hai order trong cùng segment; tối đa 3 order/customer. Không nối customer xuyên hai dataset. |
| Q14 | Vị trí tồn kho synthetic ngày 04/11 tại hai location ra sao? | `warehouse-eu`: 120 variant position, stocked 17.465, reserved 1.050; `warehouse-west`: 120, stocked 16.187, reserved 1.124. `stocked-reserved` là vị trí vật lý của kịch bản, chưa đủ quy tắc để kết luận hàng bán được. |
| Q15 | Có thể kết luận doanh thu đã thu hoặc search→cart của dữ liệu **observed**? | **Chưa đủ contract**: observed payment/refund và phép nối identity search–cart chưa có binding được duyệt trong release demo. Hai seed đạt `READY_FOR_DEMO`; khi chụp có 0 observed event từ 05/11 và 0 event observed chồng khoảng synthetic. Các số này phải kiểm tra lại tại thời điểm hỏi. |

Tất cả các con số Q01–Q14 là **synthetic**. `UNVERIFIED` trên row của view khám phá vẫn giữ nguyên; `READY_FOR_DEMO` chỉ cho biết hai fixture khớp manifest và kỳ session. Khi hỏi dữ liệu Medusa hiện hành phải dùng view/quality nguồn tương ứng, không chuyển đáp án synthetic thành KPI thực tế.
