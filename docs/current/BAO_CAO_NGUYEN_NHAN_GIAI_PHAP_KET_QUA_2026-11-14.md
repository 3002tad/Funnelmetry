# Hệ thống Funnelmetry: lỗi gì, vì sao xảy ra, đã sửa thế nào?

Ngày đánh giá: **14/11/2026**. Bản giải thích dễ đọc từ kết quả kiểm thử đã thực hiện.

> Cập nhật tiếp theo: đã tối ưu code worker và đo trước/sau. Xem [Tối ưu code xử lý phễu — nguyên nhân, giải pháp và kết quả](TOI_UU_CODE_FUNNEL_2026-11-14.md). Phần bên dưới giữ phạm vi đánh giá giao diện của đợt trước.

## 1. Điều cần biết trước khi đọc

Đợt kiểm tra này tìm ra và sửa **4 vấn đề ở màn hình phễu chuyển đổi**. Các thay đổi giúp biểu đồ thể hiện đúng số liệu hơn, giải thích rõ dữ liệu đang xem và cho phép thử tải lại khi có lỗi.

**Bản sửa mới nằm trong mã trên máy phát triển, chưa đưa lên website đang chạy.** Vì vậy, mở website thật lúc này vẫn có thể thấy giao diện cũ.

Ngoài ra, website thật còn báo **chưa có kết quả đối soát dữ liệu**. Đây là việc cần điều tra tiếp; đợt vừa rồi chưa tìm ra nguyên nhân gốc và chưa sửa phần này.

| Nhóm công việc | Kết quả thực tế |
|---|---|
| Sửa cách hiển thị và thao tác trên màn hình phễu | Đã sửa 4 vấn đề, đã kiểm tra trên máy phát triển |
| Kiểm tra website thật bằng tài khoản phân tích | Đã đăng nhập và khảo sát các trang; chưa thấy lỗi tải API trong các lần quan sát |
| Xác nhận số liệu đầy đủ, chính xác từ đầu đến cuối | Chưa đủ bằng chứng vì phần đối soát chưa có kết quả |
| Tăng tốc toàn hệ thống | Chưa đo tốc độ trước/sau, chưa thể kết luận đã nhanh hơn |

## 2. Bốn vấn đề đã sửa

### Vấn đề 1 — Hình dạng biểu đồ không phản ánh đúng tỷ lệ từng bước

**Người dùng gặp gì?**

Giả sử có 100 lượt ở bước đầu, 50 lượt ở bước tiếp theo và 10 lượt ở bước cuối. Nhìn biểu đồ, người dùng cần thấy bước thứ hai còn một nửa và bước cuối chỉ còn một phần mười so với bước đầu.

Trước sửa, độ rộng các bước lại lần lượt là 100%, 92%, 84%. Các bước nhìn gần bằng nhau, dễ gây hiểu nhầm rằng số lượt giảm rất ít, dù con số ghi trên màn hình vẫn là 100, 50, 10.

**Nguyên nhân đã xác định:** Phần vẽ lấy vị trí của bước để tính độ rộng: mỗi bước sau thu nhỏ thêm 8%. Nó không lấy tỷ lệ từ dữ liệu mà máy chủ trả về.

**Giải pháp đã làm:** Giữ vùng chứa chữ và nút bấm đủ rộng để dễ đọc, đồng thời thêm thanh biểu diễn riêng. Thanh này dài hay ngắn theo tỷ lệ dữ liệu thực nhận được.

**Kết quả đã kiểm tra:** Với bộ dữ liệu thử 100 → 50 → 10, ba thanh hiển thị đúng 100% → 50% → 10%. Đã kiểm tra cả chiều rộng lẫn việc thanh thực sự có màu và chiều cao trên trình duyệt.

**Lợi ích nhận được:** Người xem có thể nhìn ra mức giảm giữa các bước mà không bị hình dạng trang trí gây hiểu nhầm. Thay đổi này sửa cách vẽ, không thay số liệu trong cơ sở dữ liệu.

### Vấn đề 2 — Luôn báo “chưa cấu hình” dù máy chủ đã trả cấu hình

**Người dùng gặp gì?**

Màn hình luôn ghi “Horizon và grace chưa cấu hình”. Hiểu đơn giản:

- **Horizon** là khoảng thời gian cho phép theo dõi việc hoàn tất chuyển đổi theo quy định của phễu.
- **Grace** là khoảng chờ dành cho dữ liệu đến muộn theo cấu hình.

Nếu máy chủ đã trả hai giá trị này, thông báo cũ vẫn nói chưa có. Người dùng có thể tưởng hệ thống thiếu cấu hình và đi tìm lỗi không tồn tại.

**Nguyên nhân đã xác định:** Câu thông báo được viết cố định trong giao diện, không thay đổi theo câu trả lời của máy chủ.

**Giải pháp đã làm:** Đọc và hiển thị từng giá trị máy chủ trả về. Giá trị nào thực sự chưa có thì mới ghi “chưa cấu hình”.

**Kết quả đã kiểm tra:** Dữ liệu thử trả 86.400 giây và 3.600 giây thì giao diện hiển thị đúng hai giá trị đó. Khi không có cấu hình, giao diện vẫn báo rõ chưa cấu hình.

**Lợi ích nhận được:** Người xem phân biệt được “đã có cấu hình” và “đang thiếu cấu hình”. Tuy nhiên, có cấu hình không có nghĩa số liệu đã được xác nhận hoàn chỉnh; màn hình vẫn nhắc đây là số đang quan sát.

### Vấn đề 3 — Khó biết đang xem phễu nào và dữ liệu thuộc phạm vi nào

**Người dùng gặp gì?**

Màn hình có tên phễu, nhưng mã và phiên bản phễu không xuất hiện trong phần nội dung nhìn thấy khi kiểm thử. Điều này gây khó khăn khi cần đối chiếu kết quả giữa các cấu hình hoặc các thời điểm.

**Nguyên nhân đã xác định ở mức giao diện:** Thông tin mã/phiên bản đã có trong thành phần giao diện nhưng không được hiển thị hữu dụng ở bố cục hiện tại. Bằng chứng là trình duyệt không đọc thấy thông tin đó trong nội dung đang hiển thị. Đợt đánh giá không tách riêng một quy tắc CSS duy nhất làm nguyên nhân gốc.

**Giải pháp đã làm:** Đưa thông tin nhận diện ra một dòng riêng, gồm mã phễu, phiên bản, nguồn dữ liệu và khoảng thời gian đang tính.

**Kết quả đã kiểm tra:** Mã phễu và phiên bản đã xuất hiện trong nội dung nhìn thấy. Đã bổ sung nguồn và khoảng thời gian từ dữ liệu máy chủ để người xem có thể đối chiếu.

**Lợi ích nhận được:** Khi chụp màn hình hoặc trao đổi kết quả, người xem biết con số thuộc phễu nào và phạm vi nào, thay vì chỉ nhìn một tỷ lệ không rõ ngữ cảnh.

### Vấn đề 4 — Tải dữ liệu lỗi nhưng không có cách thử lại ngay trên màn hình

**Người dùng gặp gì?**

Khi máy chủ tạm thời không trả được dữ liệu, màn hình chỉ hiện thông báo lỗi. Người dùng không có nút thử lại tại chỗ, thường phải tải lại cả trang hoặc đi sang trang khác rồi quay lại.

**Nguyên nhân đã xác định:** Giao diện có xử lý thông báo lỗi nhưng chưa gắn thao tác tải lại cho trạng thái đó.

**Giải pháp đã làm:** Thêm nút thử tải lại cho danh sách phễu và dữ liệu chi tiết phễu. Trong lúc đang tải, nút bị khóa để tránh bấm liên tiếp.

**Kết quả đã kiểm tra:** Chủ động mô phỏng máy chủ bị lỗi, sau đó cho máy chủ trả dữ liệu bình thường. Bấm thử lại đã khôi phục danh sách mà không cần tải lại toàn trang. Nút thử lại phần chi tiết đã được kiểm tra khi biên dịch, nhưng chưa có ca kiểm thử trình duyệt riêng cho nhánh lỗi đó.

**Lợi ích nhận được:** Người dùng có đường xử lý rõ ràng khi kết nối hoặc máy chủ gặp sự cố tạm thời. Nút này không sửa nguyên nhân lỗi máy chủ; nó giúp tải lại sau khi máy chủ hoạt động bình thường.

## 3. Vấn đề quan trọng còn chưa giải quyết: số liệu chưa được đối soát

### Đã nhìn thấy gì trên website thật?

Trang chất lượng dữ liệu báo `Reconciliation gate: UNAVAILABLE`, tức là chưa có kết quả kiểm tra đối chiếu cần thiết để xác nhận dữ liệu trong phạm vi đang xem. Hai trường hợp được tính vào phễu đều mang nhãn `Provisional`, nghĩa là kết quả còn tạm thời.

Màn hình đồng thời hiện 2 trường hợp vào phễu và 2 trường hợp đã chuyển đổi, tương ứng 100% theo số đang quan sát.

**Cách hiểu đúng:** Hệ thống đang hiển thị tỷ lệ 2/2 trong phạm vi đó. Chưa thể dùng tỷ lệ này để nói toàn bộ dữ liệu đã đầy đủ, đã được đối soát hoặc hiệu quả kinh doanh chắc chắn là 100%.

### Nguyên nhân là gì?

**Chưa xác định được nguyên nhân gốc.** Giao diện cho thấy số bản chụp/so sánh phục vụ đối soát là 0/0, nhưng chỉ từ đó chưa biết được vì sao không có kết quả.

Những hướng cần kiểm tra tiếp gồm: tác vụ đối soát đã chạy chưa, có dữ liệu đầu vào phù hợp không, phạm vi nguồn/thời gian có khớp không, và tác vụ có báo lỗi không. Đây là các hướng điều tra, **không phải các lỗi đã được xác nhận**.

### Giải pháp cần làm tiếp

| Bước | Làm gì? | Kết quả cần có để kết luận |
|---|---|---|
| 1 | Xác định nguồn và khoảng thời gian đang được kiểm tra | Biết chính xác đang đối chiếu tập dữ liệu nào |
| 2 | Đọc trạng thái, lịch sử chạy và nhật ký tác vụ đối soát | Biết tác vụ chưa chạy, thiếu đầu vào hay chạy thất bại |
| 3 | Kiểm tra dữ liệu dùng để so sánh ở hai phía | Xác định chênh lệch có thực hay chỉ khác phạm vi/cách đếm |
| 4 | Sửa đúng nguyên nhân tìm được và chạy lại theo quy trình | Có kết quả đối soát mới để kiểm chứng |
| 5 | Mở lại giao diện và đối chiếu kết quả | Trạng thái hiển thị khớp với kết quả thực tế; nếu còn lệch phải giải thích được |

**Kết quả hiện tại:** Mới phát hiện dấu hiệu thiếu bằng chứng đối soát, chưa sửa và chưa xác nhận dữ liệu hoàn chỉnh. Không được đổi nhãn sang “đã xác nhận” chỉ để màn hình trông hết lỗi.

## 4. Một số đường dẫn đưa về trang khác — có phải lỗi không?

Trong 14 đường dẫn đã thử, 8 đường dẫn chuyển sang trang khác. Ví dụ, `/journeys` đưa về màn hình phễu; các đường dẫn cũ như `/reports` và `/evidence` đưa về Tổng quan.

**Điều đã biết:** Việc chuyển hướng có xảy ra. **Điều chưa biết từ đợt kiểm thử này:** Từng chuyển hướng có đúng chủ đích sản phẩm hay không. Chuyển hướng không tự chứng minh tính năng cũ bị lỗi, cũng không chứng minh tính năng đó đã hoạt động.

**Cách xử lý đề xuất:** Đối chiếu danh sách chức năng hiện hành. Nếu chức năng đã chuyển sang nơi khác thì sửa liên kết hoặc hướng dẫn tới đúng nơi. Nếu chức năng vẫn phải có riêng thì kiểm tra lại định tuyến và quyền truy cập.

**Kết quả hiện tại:** Đã ghi nhận các đường dẫn và nơi chuyển tới trong báo cáo kỹ thuật; chưa sửa phần này vì chưa xác định đó là hành vi sai.

## 5. Các kết quả kiểm thử nói lên điều gì?

Playwright là công cụ điều khiển trình duyệt để mở trang, bấm nút và kiểm tra nội dung. Nó giúp tái hiện thao tác người dùng theo một kịch bản cụ thể.

| Kết quả | Có thể hiểu là | Chưa thể hiểu là |
|---|---|---|
| 11/11 tình huống trình duyệt đạt sau sửa | Những tình huống đã viết để kiểm tra giao diện đều cho kết quả mong đợi | Mọi tình huống sử dụng của toàn hệ thống đều không lỗi |
| 19/19 bài kiểm tra từng phần đạt | Những phần logic được bộ kiểm tra này bao phủ vẫn hoạt động đúng | Toàn bộ dữ liệu trên máy chủ đã chính xác |
| Biên dịch và đóng gói thành công | Mã sửa có thể tạo thành bản ứng dụng | Bản sửa đã được đưa lên website thật |
| 72 phản hồi API đọc dữ liệu không báo lỗi trong phiên khảo sát | Các yêu cầu được ghi nhận đều được máy chủ trả lời thành công | Nội dung trả về chắc chắn đầy đủ, mới nhất và đã đối soát |
| Không tràn ngang ở kích thước điện thoại đã thử | Bố cục vừa màn hình 390×844 trong ca kiểm tra | Đã kiểm tra mọi điện thoại và trình duyệt |

Trước sửa, 4 trong 11 tình huống trình duyệt không đạt. Sau sửa, cả 11 tình huống đều đạt. Đây là bằng chứng cải thiện cho các lỗi giao diện đã nêu.

## 6. Nên ưu tiên làm gì tiếp?

| Thứ tự | Công việc | Mục tiêu nhận được |
|---|---|---|
| 1 | Điều tra nguyên nhân chưa có kết quả đối soát | Biết mức độ tin cậy của số liệu và nguyên nhân còn thiếu |
| 2 | Đưa bản sửa giao diện lên website theo quy trình triển khai, rồi kiểm tra lại | Người dùng thật nhận được 4 cải thiện đã làm |
| 3 | Kiểm tra thêm đổi khoảng ngày, xem hành trình chi tiết, hết phiên đăng nhập và phân quyền | Giảm rủi ro ở các thao tác chưa được kiểm tra trong đợt này |
| 4 | Kiểm tra các màn hình quản trị khi có quyền phù hợp | Biết tiến trình xử lý dữ liệu có đang chạy, bị chậm hay gặp lỗi |
| 5 | Đo thời gian tải và tốc độ cập nhật trước khi tối ưu hiệu năng | Có số đo để biết sửa ở đâu và đã nhanh hơn bao nhiêu |

Phần quản trị chưa được kiểm tra do bước sử dụng tài khoản Admin bị hệ thống duyệt tự động chặn vì chưa được xác nhận quyền riêng. Điều này là giới hạn của đợt đánh giá, không phải bằng chứng hệ thống Admin bị lỗi.

## 7. Mở bằng chứng khi cần

- [Báo cáo kỹ thuật đầy đủ](FUNNEL_PLAYWRIGHT_ASSESSMENT_2026-11-14.md): chi tiết đường dẫn, mã nguồn và lệnh chạy kiểm thử.
- [Ảnh giao diện sau sửa trên máy phát triển](../../apps/dashboard-web/test/artifacts/funnel/desktop.png): dùng dữ liệu thử, không phải số kinh doanh thật.
- [Ảnh trên kích thước điện thoại](../../apps/dashboard-web/test/artifacts/funnel/mobile.png).
- [Kết quả kiểm thử trước sửa](../../apps/dashboard-web/test/artifacts/funnel-before/results.json) và [sau sửa](../../apps/dashboard-web/test/artifacts/funnel/results.json).

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

