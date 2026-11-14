# Sửa tiếp hệ thống funnel — kết quả và phần còn thiếu

Ngày: 14/11/2026. Tiếp nối báo cáo tối ưu worker và giao diện. Các thay đổi trong đợt này vẫn ở local, chưa triển khai lên VPS.

> Cập nhật sau đó: đã kết nối PostgreSQL VPS và chạy SELECT/EXPLAIN chỉ đọc. Snapshot và comparison đều 0 trên toàn database; SQL phễu chưa cho thấy chậm. Xem [kết quả chẩn đoán database](KET_QUA_CHAN_DOAN_DATABASE_2026-11-14.md). Các giới hạn “chưa đo DB” bên dưới phản ánh đợt trước.

## 1. Đã sửa: yêu cầu dữ liệu cũ vẫn chạy khi không còn cần

**Nguyên nhân:** React Query có tín hiệu hủy yêu cầu, nhưng các hàm lấy danh sách phễu, chi tiết phễu và chất lượng dữ liệu không chuyển tín hiệu đó xuống `fetch`. Khi rời màn hình hoặc đổi phạm vi, trình duyệt có thể tiếp tục chờ yêu cầu cũ.

**Giải pháp:** Truyền `AbortSignal` xuyên suốt từ query tới các hàm API. Cập nhật các nơi dùng chung hàm ở Overview, Funnels và Data Health để tránh mỗi màn hình xử lý khác nhau.

**Kết quả:** Playwright mô phỏng yêu cầu phễu đang chờ. Chuyển sang tab Timeline làm tín hiệu hủy được phát; quay lại tab phễu tải dữ liệu thành công. Đây là xác nhận hủy fetch phía trình duyệt, **không chứng minh câu SQL đã chạy trên server cũng được hủy**. Chưa đo mức giảm CPU/mạng thực tế.

## 2. Đã sửa: lựa chọn profile có thể lệch với dữ liệu đang xem

**Nguyên nhân:** Nếu profile đang chọn không còn trong danh sách, code chuyển sang dữ liệu profile đầu tiên nhưng chỉ cập nhật giá trị dropdown khi lựa chọn cũ là rỗng. Dropdown có thể vẫn giữ khóa cũ.

**Giải pháp:** Đồng bộ khóa đang chọn với profile thực tế được dùng, kể cả khi lựa chọn trước đó không còn tồn tại. Việc đổi khóa cũng đặt lại bước đang chọn.

**Kết quả:** Đã sửa code và qua TypeScript/build. Ca đổi từ profile dài sang ngắn vẫn đạt; chưa có ca browser riêng mô phỏng server loại bỏ profile trong một lần refetch.

## 3. Đã xác định điều kiện gây UNAVAILABLE, chưa xác định hết nguyên nhân vận hành

**Bằng chứng code:** `reconciliationGate` trong `apps/dashboard-api/src/lib/v2-analytics-repository.js` trả `UNAVAILABLE` và lý do `NO_RECONCILIATION_EVIDENCE` khi số snapshot trong phạm vi là 0. Phạm vi lọc theo `source_id` và `coverage_end_at`, không phải thời điểm bắt đầu hành trình `entry_at`.

**Bằng chứng tài liệu/triển khai code:** Reconciliation worker có CLI nhận snapshot, projection và yêu cầu so sánh. README nói rõ worker không tự lấy dữ liệu Medusa. Dữ liệu CDC current-state có quality/coverage riêng; không được lấy quality CDC để tự nâng nhãn đối soát của phễu lịch sử.

**Giải pháp đã làm:** Trang chất lượng dữ liệu giải thích lý do API trả về: chưa có snapshot trong nguồn/khoảng thời gian chọn; cần kiểm tra phạm vi và việc nạp snapshot. Không tự đổi gate sang RECONCILED, không tạo snapshot giả.

**Kết quả:** API test xác nhận thiếu snapshot phải chặn claim chính thức. Unit test kiểm tra câu giải thích không khẳng định worker hỏng. Chưa kiểm thử browser riêng cho lời giải thích ở Data Health.

**Chưa biết:** Trên VPS, snapshot chưa từng được nạp, đã có ngoài phạm vi ngày, hay tác vụ nạp thất bại. Muốn phân biệt cần đọc database và lịch sử vận hành. Không kết luận từ giao diện rằng mọi nguồn đều không có snapshot.

## 4. SQL: đã chuẩn bị cách đo, chưa thay truy vấn/index

Schema `infra/postgres/v2/004_kpi_projection.sql` đã có index `(source_id, funnel_profile_id, profile_version, entry_at)`. Không thêm index tương tự khi chưa đo.

Thêm [scripts/diagnose-funnel.mjs](../../apps/dashboard-api/scripts/diagnose-funnel.mjs), công cụ dùng truy vấn thật từ repository để:

- Lấy gate đối soát trong phạm vi chỉ định.
- Đếm snapshot của cùng nguồn trên toàn thời gian, lấy mốc coverage sớm nhất/muộn nhất để phân biệt thiếu toàn nguồn với thiếu trong phạm vi.
- Thu kế hoạch thực thi và thời gian bằng `EXPLAIN ANALYZE`, có thông tin buffer.
- Chạy trong transaction **READ ONLY**, timeout câu lệnh 15 giây, timeout chờ khóa 2 giây; không repair/replay/migration.

Công cụ chỉ nhận kết nối qua biến `FUNNEL_DIAGNOSTIC_DATABASE_URL`, không tự đọc `.env` hoặc credential triển khai. Dùng tài khoản chỉ đọc/database kiểm thử; câu SELECT thực hiện hai lần để lấy dữ liệu và đo kế hoạch, nên kết quả đo có thể hưởng lợi từ cache đã được làm nóng. Output chứa scope, thông tin đối soát và SQL plan; không in mật khẩu/kết nối.

Chạy từ `Funnelmetry/apps/dashboard-api` sau khi cấu hình biến kết nối:

```powershell
D:/KLTN/node.exe scripts/diagnose-funnel.mjs --help
D:/KLTN/node.exe scripts/diagnose-funnel.mjs medusa-reference 2026-10-16T00:00:00Z 2026-11-15T00:00:00Z commerce-conversion 2.0.0 funnel-diagnostic.json
```

**Giới hạn:** Mới kiểm tra cú pháp/chế độ help; chưa chạy công cụ với PostgreSQL. Lệnh `docker ps` local không kết nối được Docker daemon và báo không đọc được Docker config. Vì thế chưa có số đo SQL, chưa có cơ sở tuyên bố SQL nhanh hơn.

## 5. Realtime: xác định khoảng trống, chưa triển khai mới

Trong frontend hiện tại không tìm thấy `EventSource`. Backend có `/api/events/stream` gửi sự kiện tracking qua event bus; đây không phải bằng chứng đã có thông báo cập nhật governed funnel read-model. Event bus là bộ nhớ của process, chưa chứng minh phân phối notification giữa các replica.

Do đó không nối giao diện phễu vào stream cũ rồi gọi là đã đáp ứng realtime. Cần xác định nơi phát thông báo sau cập nhật projection, phạm vi nguồn, cơ chế phân phối giữa replica và refetch khi reconnect theo Master §23.18. Đợt này chưa đổi kiến trúc SSE hoặc deployment.

## 6. Kết quả kiểm thử

| Nhóm | Kết quả | Phạm vi |
|---|---|---|
| Playwright | 17/17 đạt | Chromium local, API giả lập |
| Frontend unit tests | 20/20 đạt | Gồm giải thích trạng thái đối soát |
| API tests | 13/13 đạt | Query parsing, repository, HTTP contract/auth |
| TypeScript + production build | Đạt | Mã local |
| SQL trên PostgreSQL | Chưa chạy | Chưa có DB kiểm thử kết nối được |
| Deployment và nghiệm thu VPS | Chưa thực hiện | Không thay bản đang chạy |

Các ca mới của Playwright: lỗi projection rồi retry; ngày kết thúc inclusive chuyển thành mốc UTC exclusive; 403 không hiện số phễu; hủy request khi rời tab; tải lại sau hủy; 401 về login và xóa token. Các ca dùng API giả lập không thay thế kiểm chứng backend phân quyền thật; test HTTP API là lớp riêng.

## 7. Bằng chứng và phần cần tiếp tục

- [Playwright results](../../apps/dashboard-web/test/artifacts/funnel-followup/results.json).
- [Frontend unit log](../../apps/dashboard-web/test/artifacts/funnel-followup/unit-tests.txt).
- [Build log](../../apps/dashboard-web/test/artifacts/funnel-followup/build.txt).
- Browser test: `apps/dashboard-web/test/funnel-browser.mjs`.
- API test command: `node --test test/v2-analytics-query.test.js test/v2-analytics-repository.test.js test/v2-analytics-http.test.js` trong `apps/dashboard-api`.

Để hoàn tất phần vận hành, cần một kết nối PostgreSQL chỉ đọc được cấu hình vào môi trường chạy công cụ chẩn đoán. Không gửi mật khẩu trong báo cáo/chat. Sau khi xác định nguyên nhân thiếu đối soát và có số đo SQL mới quyết định sửa tác vụ/index. Cần kiểm tra tích hợp và chuẩn bị bản triển khai trước khi đưa thay đổi lên VPS.

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

