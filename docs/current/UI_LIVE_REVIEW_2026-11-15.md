# Đánh giá độ gọn giao diện trên VPS — 15/11/2026

## Kết luận

Giao diện đang đưa quá nhiều thông tin kiểm tra kỹ thuật lên cùng cấp với kết quả phân tích. Người dùng phải đọc mã sự kiện, trạng thái nội bộ và nhiều chú thích trước khi thấy nội dung chính. Cần thu gọn cách trình bày, không xóa các cảnh báo giúp phân biệt dữ liệu minh họa, lịch sử và dữ liệu chưa đối soát.

Đây là đánh giá từ website live https://analyst.entidi.io.vn sau đăng nhập Analyst, không phải ảnh từ API giả lập. Playwright chạy trên máy local, truy cập ứng dụng được triển khai trên VPS; không cài hay chạy tiến trình trình duyệt bên trong VPS.

## Đã kiểm tra gì và nhận được gì?

- Xem Tổng quan, Sản phẩm, Hành trình chuyển đổi, Sự kiện, Chất lượng dữ liệu và Thiết lập cá nhân.
- Xem dữ liệu Medusa và demo lịch sử trên các trang hỗ trợ; kiểm tra thêm ba trang ở kích thước mobile 390 × 844.
- Ghi 14 lượt chụp màn hình, lưu 13 file ảnh (Tổng quan lịch sử chụp hai lần cùng tên); thêm một kết quả kiểm tra sau reload.
- Không ghi nhận JavaScript exception hoặc HTTP API lỗi trong lượt chạy. Đây không phải kiểm thử đầy đủ mọi thao tác.
- Chọn `demo-historical-100000-v3-utm`, chuyển qua Sản phẩm, Chất lượng dữ liệu, Phễu rồi quay lại Tổng quan và reload: lựa chọn vẫn đúng. Bản sửa trước đã có bằng chứng hoạt động sau đăng nhập trên VPS.
- Ba trang mobile đã kiểm tra có chiều rộng tài liệu bằng 390 px: không phát hiện tràn ngang toàn trang. Điều này không đảm bảo mọi nội dung trong từng khối đều dễ đọc.

## Nguyên nhân, giải pháp và kết quả mong đợi

| Ưu tiên / màn hình | Hiện trạng thấy trên live | Nguyên nhân về cách trình bày | Đề xuất sửa | Kết quả mong đợi, chưa triển khai |
|---|---|---|---|---|
| P1 — Phễu | Hiện `BEHAVIOR_INTENT`, `BUSINESS_FACT`, `Step ID`, profile/version, timestamp ISO, horizon/grace và năm ô quality | Thông tin phục vụ kiểm tra hệ thống được mở sẵn | Dùng tên bước tiếng Việt; đưa mã gốc, profile, quality và cấu hình vào “Chi tiết kỹ thuật”; mở chi tiết bước khi người dùng yêu cầu | Nhìn ngay các bước, số lượng và tỷ lệ; vẫn tra được bằng chứng khi cần |
| P1 — Phễu | Bốn KPI đều lặp “Entry-at cohort · chưa chốt maturity”; cảnh báo lịch sử là một đoạn dài | Cùng một giới hạn được nhắc nhiều lần | Giữ một dòng giải thích chung; cảnh báo ngắn “Phễu lịch sử · ngừng từ 30/10/2026”, phần giải thích mở rộng; giữ rõ tỷ lệ quan sát chưa phải tỷ lệ cuối cùng | Bớt chữ lặp nhưng không gây hiểu nhầm dữ liệu lịch sử thành chuyển đổi CDC hiện tại |
| P1 — Tổng quan | Hai trong bốn KPI Medusa là “Chưa đo”; so sánh hai kỳ chiếm cả khối lớn; bảng UTM chỉ có “Không có UTM” vẫn mở | Khối thiếu dữ liệu và thao tác phân tích nâng cao chiếm diện tích như kết quả chính | Thu các chỉ tiêu chưa đo vào một dòng trạng thái; mở so sánh khi bấm “So sánh kỳ”; khi không có UTM dùng thông báo ngắn | Phần đầu ưu tiên chỉ số có dữ liệu và biểu đồ; không biến dữ liệu thiếu thành 0 |
| P1 — Bộ lọc chung | Tên nguồn xuất hiện ở sidebar, badge và dropdown; dropdown nằm riêng một hàng rộng | Nguồn/workspace và dataset chưa được phân cấp rõ | Gom bộ chọn dataset và khoảng ngày vào một thanh; sidebar vẫn chỉ thể hiện workspace; bỏ badge lặp ở trang có dropdown | Ít khoảng trống, dễ biết đang chọn dữ liệu nào; luôn giữ nhãn Demo khi xem dữ liệu minh họa |
| P2 — Sản phẩm | Thẻ “Nguồn dữ liệu: Observed”, badge trên từng dòng, nhãn `OBSERVED · UNVERIFIED` lặp; sản phẩm Medusa hiển thị ID dài | Metadata được dùng như nội dung kinh doanh; tên sản phẩm chưa có ở kết quả hiển thị | Đưa nguồn/trạng thái lên một chỗ; ưu tiên tên khi có mapping hợp lệ; nếu thiếu thì hiện “Chưa có tên” và ID rút gọn có thể xem/copy đầy đủ | Bảng dễ quét; không tự bịa tên hay ghép sai sản phẩm |
| P2 — Sự kiện | 24 sự kiện thành 24 thẻ lớn; trang desktop cao khoảng 2.021 px | Mỗi bản ghi ngắn dùng quá nhiều diện tích | Dùng danh sách/bảng gọn: thời gian, sự kiện, loại; mở nội dung khi chọn một dòng | Đọc được nhiều sự kiện mà ít cuộn hơn |
| P2 — Chất lượng dữ liệu | `Reconciliation gate: UNAVAILABLE`, `Canonical`, `Provisional`, `Authoritative event time` hiện trong vùng chính; thông tin thiếu đối soát xuất hiện nhiều nơi | Ngôn ngữ vận hành chưa chuyển thành thông tin dễ hiểu | Một tóm tắt “Chưa có dữ liệu đối soát”, kèm việc cần kiểm tra; giữ số liệu chính; đưa bảng trạng thái chi tiết vào mục mở rộng | Người dùng biết vấn đề và bước tiếp theo mà không phải hiểu pipeline |
| P2 — Mobile | Phễu cao khoảng 2.289 px, Tổng quan lịch sử 3.715 px; ảnh Phễu có hai nút biểu tượng menu giống nhau ở đầu trang | Bố cục desktop xếp dọc, vẫn mở toàn bộ phần phụ; có điều khiển trùng về hình thức | Thu gọn phần nâng cao, ưu tiên biểu đồ; rà chức năng hai nút để gộp hoặc phân biệt rõ | Giảm chiều dài và tránh bối rối khi điều hướng |

Các số đo chiều cao là kết quả tại thời điểm chụp, phụ thuộc dữ liệu và trạng thái trang. Đề xuất trong bảng là nhận định UX, chưa phải kết quả đo cải thiện.

## Nên giữ trên màn hình chính

- Bộ dữ liệu đang chọn và khoảng ngày.
- Chỉ số có ý nghĩa, đơn vị rõ ràng, biểu đồ chính.
- Dấu hiệu Demo/lịch sử và thông báo chưa đủ dữ liệu đối soát khi ảnh hưởng cách đọc kết quả.
- Trạng thái tải/lỗi và hành động thử lại.

Mã sự kiện, profile version, timestamp đầy đủ, nhãn máy và phân loại kỹ thuật vẫn phải truy cập được trong phần chi tiết. Không sửa công thức, hợp đồng dữ liệu hay xóa dữ liệu để làm giao diện gọn hơn.

## Thứ tự sửa đề xuất

1. Thanh bộ lọc chung, thuật ngữ tiếng Việt và chú thích lặp.
2. Phễu: ưu tiên biểu đồ, thu gọn thông tin kỹ thuật.
3. Tổng quan và Sản phẩm: thu gọn khối chưa có dữ liệu và phân tích nâng cao.
4. Sự kiện: danh sách gọn; Chất lượng dữ liệu: trạng thái dễ hiểu.
5. Kiểm thử desktop/mobile, dữ liệu Medusa/lịch sử, giữ lựa chọn sau chuyển trang/reload; so ảnh trước/sau.

Lượt đánh giá ban đầu chưa sửa source. Phần cập nhật bên dưới ghi nhận bản sửa local sau khi người dùng yêu cầu triển khai.

## Bản sửa local sau đánh giá

Đã chỉnh giao diện, chưa commit/push/deploy bản này:

- Gom bộ chọn dữ liệu và khoảng ngày vào thanh lọc chung. Chất lượng dữ liệu dùng cùng bộ chọn, bỏ hai tab thực tế/minh họa trùng chức năng.
- Phễu dùng nhãn tiếng Việt, một chú thích chung về kết quả quan sát; rút ngắn cảnh báo lịch sử nhưng giữ giới hạn CDC. Cấu hình và chi tiết bước đóng mặc định, vẫn xem được mã gốc, thời điểm chính xác, horizon/grace và quality. Profile/version vẫn hiện trên tiêu đề phần cấu hình.
- Tổng quan thu các KPI chưa đo thành một dòng; so sánh hai kỳ chỉ khởi tạo khi mở. Bảng UTM không có nguồn được thay bằng thông báo ngắn. Dữ liệu thiếu không bị đổi thành số 0.
- Sản phẩm bỏ cột và KPI nguồn dữ liệu lặp; ID thiếu tên được rút gọn, mã đầy đủ vẫn ở tooltip và dữ liệu xuất. Khối chưa có lịch sử giá được giảm chiều cao.
- Sự kiện chuyển sang từng dòng gọn, vẫn bấm mở chi tiết; giữ tìm kiếm và tự cập nhật.
- Chất lượng dữ liệu giữ cảnh báo nổi bật, Việt hóa các nhãn chính, thu bảng xử lý/đối soát và coverage vào phần mở rộng.
- Mobile chỉ còn một nút mở điều hướng; bộ lọc tự xuống dòng.

### Kết quả kiểm tra bản sửa

| Kiểm tra | Kết quả |
|---|---|
| Playwright Chromium local, API giả lập | 28/28 đạt |
| Unit test frontend | 20/20 đạt |
| TypeScript, build Vite | Đạt |
| `git diff --check` | Đạt |
| Giữ lựa chọn dataset, reload, chuyển trang | Đạt trong bộ Playwright |
| Mở chi tiết kỹ thuật, giữ đúng horizon/grace, cảnh báo lịch sử | Đạt |
| API lỗi, 401/403, hủy request, retry | Đạt |
| Mobile bộ lọc/phễu không tràn ngang, không lặp nút menu | Đạt |

Ảnh mới dùng dữ liệu kiểm thử, không so trực tiếp chiều cao với ảnh live có dữ liệu khác để suy tỷ lệ cải thiện. Bản UI mới chưa được kiểm thử trên VPS vì chưa deploy. Không sửa API, công thức tính hay database; không có migration.

- [Kết quả 28 ca](../../apps/dashboard-web/test/artifacts/ui-simplification/results.json)
- [Phễu sau sửa](../../apps/dashboard-web/test/artifacts/ui-simplification/desktop.png)
- [Tổng quan mobile](../../apps/dashboard-web/test/artifacts/ui-simplification/overview-mobile.png)
- [Sự kiện sau sửa](../../apps/dashboard-web/test/artifacts/ui-simplification/events-desktop.png)
- [Chất lượng dữ liệu sau sửa](../../apps/dashboard-web/test/artifacts/ui-simplification/quality.png)

Ảnh và raw log tiếp tục được giữ riêng theo quy tắc bỏ qua artifact của repository; không tự động commit toàn bộ bằng chứng.

## Bằng chứng riêng, không tự động commit

- [Kết quả và nội dung từng màn](../../../ui-audit-live-20261115/audit.json)
- [Phễu desktop](../../../ui-audit-live-20261115/funnels-observed-desktop.png)
- [Phễu mobile](../../../ui-audit-live-20261115/funnels-mobile.png)
- [Tổng quan lịch sử](../../../ui-audit-live-20261115/overview-historical-desktop.png)
- [Sản phẩm Medusa](../../../ui-audit-live-20261115/products-observed-desktop.png)
- [Sự kiện](../../../ui-audit-live-20261115/events-observed-desktop.png)
- [Chất lượng dữ liệu](../../../ui-audit-live-20261115/data-health-observed-desktop.png)

Các ảnh và JSON nằm ngoài repository tại `D:/KLTN/ui-audit-live-20261115/`, chỉ dành cho rà soát nội bộ. Script không ghi mật khẩu hoặc token vào báo cáo, ảnh hay log.
