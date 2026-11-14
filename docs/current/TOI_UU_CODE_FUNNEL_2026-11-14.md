# Tối ưu code xử lý phễu — nguyên nhân, giải pháp và kết quả

Ngày thực hiện: 14/11/2026. Đây là đợt tối ưu **code xử lý phía sau**, tiếp nối đợt sửa giao diện.

> Đã có đợt tiếp theo: [hủy API cũ, kiểm thử lỗi và chẩn đoán đối soát/SQL](FUNNEL_FOLLOWUP_FIXES_2026-11-14.md). Xem file đó để biết phần đã hoàn thành và phần còn cần database/runtime.

## 1. Đã tối ưu ở đâu?

Đã sửa hàm `evaluateFunnelWindow` trong worker tính phễu. Worker là chương trình xử lý sự kiện phía máy chủ. Hàm này sắp xếp các sự kiện theo thời gian rồi xác định những bước phễu đã đạt và trạng thái chuyển đổi.

File sửa: [workers/funnel-processor/src/evaluator.js](../../workers/funnel-processor/src/evaluator.js).

Với dữ liệu thử 10.000 sự kiện, thời gian trung vị giảm từ **71,44 ms xuống 6,37 ms**, nhanh hơn khoảng **11,21 lần trong phép đo riêng hàm này**. Kết quả tính toán cũ/mới giống nhau trên các bộ dữ liệu đã đối chiếu.

**Bản sửa vẫn ở local, chưa triển khai lên máy chủ.** Không thay quy định chuyển đổi, schema hoặc dữ liệu lịch sử.

## 2. Nguyên nhân và giải pháp

### A. Chuyển đổi cùng một thời điểm nhiều lần

**Nguyên nhân:** Thời gian sự kiện là chuỗi chữ. Mỗi lần so sánh hai sự kiện để sắp xếp, code cũ lại chuyển cả hai chuỗi thành số. Một sự kiện được so sánh nhiều lần nên cùng thời điểm bị chuyển đổi lặp lại.

**Giải pháp:** Chuyển thời gian một lần cho mỗi sự kiện rồi dùng lại trong mọi lần so sánh.

**Kết quả nhận được:** Giảm công việc lặp. Vẫn sắp theo thời gian trước, dùng mã sự kiện phân thứ tự khi thời gian bằng nhau.

### B. Quét lại danh sách bước cho mỗi sự kiện

**Nguyên nhân:** Mỗi sự kiện đều làm code dò từ đầu danh sách bước để tìm bước có cùng loại sự kiện và thẩm quyền dữ liệu.

**Giải pháp:** Tạo bảng tra một lần trong mỗi lần tính; sau đó tra trực tiếp loại sự kiện và thẩm quyền.

**Kết quả nhận được:** Giảm quét lặp danh sách. Nếu cấu hình có nhiều bước cùng cặp loại/thẩm quyền, vẫn chọn bước đầu tiên như code cũ; không tự thay cách tính trong lần tối ưu này.

### C. Quét lại danh sách sự kiện nhánh phụ

**Nguyên nhân:** Với mỗi sự kiện, code dò danh sách các sự kiện cần ghi thành nhánh phụ, ví dụ hủy đơn trong dữ liệu thử.

**Giải pháp:** Tạo tập hợp tra cứu một lần trong mỗi lần chạy.

**Kết quả nhận được:** Kiểm tra sự kiện thuộc nhóm bằng tra cứu, thay vì quét cả danh sách. Nội dung nhánh phụ được ghi vẫn giữ nguyên.

Ba thay đổi được đo cùng nhau. Chưa đo tách riêng nên không quy toàn bộ mức tăng tốc cho một thay đổi cụ thể.

## 3. Kết quả đo trước và sau

Dùng cùng dữ liệu đầu vào, Node 22.16.0 trên máy local. Mỗi kích thước có 3 lượt làm nóng, 9 mẫu đo, luân phiên thứ tự chạy cũ/mới. Bảng lấy trung vị để giảm ảnh hưởng của một lần máy chậm bất thường.

| Sự kiện trong một lần tính | Code cũ | Code mới | Tăng tốc quan sát |
|---|---:|---:|---:|
| 10 | 0,01465 ms | 0,00524 ms | 2,79 lần |
| 1.000 | 4,78 ms | 0,45 ms | 10,62 lần |
| 10.000 | 71,44 ms | 6,37 ms | 11,21 lần |
| 50.000 | 455,98 ms | 63,78 ms | 7,15 lần |

**Ý nghĩa:** Hàm tính phễu tốn ít thời gian CPU hơn trên các bộ dữ liệu này. Với tập nhỏ, chênh lệch tuyệt đối rất ít nên người dùng có thể không cảm nhận được.

**Giới hạn:** Không có nghĩa website hay toàn pipeline nhanh hơn 11 lần. Database, Kafka và mạng không nằm trong phép đo. Dữ liệu thử được sinh và xáo trộn, chưa đại diện mọi kiểu dữ liệu thực tế.

## 4. Kiểm tra có làm sai kết quả không?

Giữ một bản code cũ chỉ dùng đối chiếu. Cho hai bản chạy cùng dữ liệu rồi so toàn bộ kết quả, không chỉ tỷ lệ chuyển đổi.

| Kiểm tra | Kết quả |
|---|---|
| 200 bộ dữ liệu sinh theo quy tắc cố định | Kết quả cũ/mới giống nhau |
| Dữ liệu rỗng, thời gian trùng, thẩm quyền không khớp, nhánh phụ, cấu hình lặp loại/thẩm quyền | Được đưa vào các ca đối chiếu |
| Danh sách đầu vào bị thay đổi khi tính? | Không thay đổi trên các ca đối chiếu |
| 4 tập dữ liệu đo thời gian | Kết quả cũ/mới giống nhau trước khi đo |
| Bộ kiểm thử worker hiện có | 18 đạt, 0 lỗi, 2 kiểm thử database bỏ qua |

Hai kiểm thử database chưa chạy vì chưa cấu hình database kiểm thử riêng. Ban đầu local thiếu dependency; đã liên kết các package có sẵn trong workspace rồi chạy lại các kiểm thử không cần database.

## 5. Đánh đổi và việc chưa làm

Code mới tạo đối tượng chứa thời gian đã chuyển đổi cho từng sự kiện và các bảng tra tạm. Vì vậy có thêm chi phí cấp phát bộ nhớ. Chưa đo bộ nhớ cao nhất nên không khẳng định dùng ít RAM hơn.

Đợt này chưa đo truy vấn SQL, hàng đợi hoặc tốc độ toàn tuyến. Vấn đề đối soát `UNAVAILABLE` trong báo cáo trước **không được giải quyết bởi thay đổi này**.

| Việc tiếp theo | Vì sao cần? | Bằng chứng cần có |
|---|---|---|
| Đo trên dữ liệu đại diện thực tế, gồm dữ liệu đã sắp xếp | Phép đo hiện dùng dữ liệu giả lập bị xáo trộn | Thời gian và bộ nhớ trước/sau trên nhiều loại đầu vào |
| Đo SQL lấy tổng và từng bước phễu | Database có thể chiếm phần lớn thời gian chờ | Kế hoạch thực thi và thời gian truy vấn trên database kiểm thử |
| Rà hủy API khi đổi bộ lọc hoặc rời trang | Có nơi frontend chưa truyền tín hiệu hủy | Test xác nhận request không cần đã được hủy; chưa sửa trong đợt này |
| Đo thời gian toàn tuyến trước khi triển khai | Một hàm nhanh hơn chưa chứng minh cả hệ thống nhanh hơn | Thời gian từ sự kiện đến hiển thị, CPU/RAM và hàng đợi |

## 6. Bằng chứng và chạy lại

- [Mẫu đo đầy đủ](../../workers/funnel-processor/test/performance/results.json).
- [Log kiểm thử worker](../../workers/funnel-processor/test/performance/worker-tests.txt).
- [Code đối chiếu và đo thời gian](../../workers/funnel-processor/test/performance/compare.mjs).
- [Hướng dẫn và giới hạn phép đo](../../workers/funnel-processor/test/performance/README.md).

Chạy từ `Funnelmetry/workers/funnel-processor`, khi đã có dependency khai báo trong `package.json`:

```powershell
D:/KLTN/node.exe test/performance/compare.mjs
D:/KLTN/node.exe --test test/*.test.js
```

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

