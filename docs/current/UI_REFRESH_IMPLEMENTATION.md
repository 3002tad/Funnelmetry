# Cập nhật UI Analyst và Admin theo bản mẫu

Trạng thái: thay đổi trong source local; chưa triển khai VPS. Không thay đổi schema, pipeline hoặc policy vận hành.

## Đối chiếu hình thức với UI mẫu

- Dùng hình chụp trực tiếp hai UI mẫu làm chuẩn đối chiếu cùng viewport với React: sidebar 232px, topbar 66px, khoảng cách nội dung, font Inter, thương hiệu xanh, trạng thái active có vạch bên trái, avatar và bo góc.
- Chuyển bộ lọc ngày khỏi topbar xuống dưới tiêu đề trang phân tích. Dataset selector nằm ở dải điều khiển riêng.
- Tổng quan dùng bố cục hai cột biểu đồ hoạt động/cơ cấu sự kiện, bốn thẻ số liệu và phần so sánh A/B có cùng kiểu bề mặt với mẫu. Cơ cấu sự kiện lấy từ truy vấn theo UTC day/event_type cùng source/dataset/window, lọc cùng cột được chọn; không dùng số liệu minh họa.
- Admin Pipeline thay màn giới thiệu cũ bằng dải trạng thái, bốn thẻ số liệu, tab Workers/Kafka/Cảnh báo và hai cột worker/chặng dữ liệu. Chi tiết kỹ thuật thu gọn và chỉ tải khi mở.
- Sản phẩm có thẻ số liệu, biểu tượng sản phẩm, bảng và nút giá/lượt xem. API explorer đã bổ sung số session theo started_at, số order theo created_at, catalog count và UTM event count trong cùng dataset/cửa sổ; không sao chép số liệu từ bản mẫu.
- Thiết lập Analyst dùng đúng cấu trúc mẫu: menu Hồ sơ & bảo mật/Workspace, thẻ hồ sơ dạng hàng, mật khẩu chỉ mở khi bấm, Ngôn ngữ và Giao diện. Lịch sử tài khoản vẫn truy cập được trong menu phụ. Admin dùng form gọn như mẫu; giữ API cập nhật thật.
- Theme vẫn theo thiết lập tài khoản. Admin local chưa cấu hình probe nội bộ thì giữ UNVERIFIED, không dùng readiness từ snapshot mẫu để trang trí.

### Lượt chuyển cấu trúc trực tiếp từ mẫu

Đã chuyển các component còn dùng bố cục cũ: Quality, Settings, Admin Users (form tạo/đổi role trong modal), Source summary, Quarantine/Trace, Health/Recovery và Scaling. Sidebar dùng lại đúng SVG path của mẫu. Có tìm trang bằng Ctrl+K, thu gọn sidebar, export CSV từ dữ liệu API, lựa chọn datetime riêng cho giá, bốn thẻ kết quả giá và biểu đồ hai tầng.

Cách triển khai hiện tại dùng trực tiếp HTML/CSS của mẫu, không còn lớp căn chỉnh lên shell cũ:

- `apps/dashboard-web/src/ui-template/source/`: 12 file CSS Analyst/Admin sao chép nguyên byte từ hai thư mục mẫu; có SHA-256 trong `source-manifest.json`.
- `scripts/build-template-css.mjs`: chỉ thêm namespace `tpl-`, scope theo vai trò và đổi tên CSS variables/keyframes để không xung đột Tailwind. Không chỉnh giá trị màu sắc, padding, kích thước hoặc breakpoint trong nguồn mẫu. Chạy tự động trước `npm run dev` và `npm run build`.
- `ui-template/TemplateShell.tsx`, `ui-template/FunnelView.tsx` và các component trang dùng cấu trúc/class gốc chuyển thành JSX; React quản lý state, tab, form, modal và lọc dữ liệu.
- Đã xóa `src/styles.css` và `src/preview-alignment.css`. `foundation.css` chỉ giữ Tailwind, login và nền cho các inspector phụ còn dùng; `integration.css` chứa accessibility, binding React và trạng thái chưa có dữ liệu.
- Giữ API client, đăng nhập, phiên, phân quyền và logic tính toán hiện có. Không nhúng prototype JavaScript, snapshot hoặc credential vào frontend.

Đã kiểm tra build production, thao tác Playwright với API fixture, các màn Analyst/Admin desktop/mobile và đọc database thật qua API local. Modal tạo tài khoản được kiểm tra mở/hủy, không tạo tài khoản trên VPS trong QA live.

Các khác biệt có chủ đích so với bản mẫu: không có dòng snapshot/mô phỏng trên hệ thống thật; runtime/controller chưa có API giữ trạng thái chưa đo; email/tên và số liệu theo tài khoản/database thật; thao tác tài khoản thực hiện qua API thay vì chỉ thay bộ nhớ trình duyệt. Không thêm actuator, migration hay triển khai VPS trong lượt UI này.

## Analyst

- Menu: Tổng quan, Hành trình chuyển đổi, Sản phẩm, Sự kiện, Chất lượng dữ liệu và Thiết lập cá nhân. AI Assistant đặt trên sidebar, dùng giao diện AI hiện có.
- Tổng quan có biểu đồ hoạt động bấm để lọc thẻ số liệu; danh sách top sản phẩm/từ khóa giữ phạm vi toàn khoảng ngày. So sánh A/B chọn trực tiếp mốc thuộc ngày/tuần/tháng.
- Khoảng ngày nhập tùy ý theo UTC; ngày kết thúc được chuyển thành cận trên loại trừ của ngày kế tiếp. Bỏ bộ chọn nhanh 7/30/90 ngày.
- Hành trình chuyển đổi gộp Funnel và Journey thành tab, giữ biểu đồ Funnel và chi tiết bước hiện có. Journey vẫn theo contract riêng, có thông báo về phạm vi lọc.
- Sản phẩm chứa Giá & mức quan tâm: variant, currency/channel/region/rule, khoảng hiệu lực giá và lượt xem. Không suy lịch sử observed từ giá hiện tại, không tự giải quyết giá checkout, không suy nhân quả.
- Chất lượng dữ liệu giữ màn observed với biểu đồ hiện có; dataset synthetic hiển thị coverage và lượng sự kiện riêng.
- Thiết lập hỗ trợ đổi tên qua API, mở form đổi mật khẩu khi bấm, theme và lựa chọn ngôn ngữ. Chuyển ngôn ngữ hiện áp dụng một phần nhãn giao diện, chưa phải bản dịch toàn bộ module cũ.
- Các mục Analysis Runs, Evidence Explorer, Findings, Reports, Metrics, Assets không còn trên menu chính. Backend evidence không bị xóa.

## Admin

- Pipeline và Processing gộp tab; Sources, Feed, Cursor và Mappings gộp trong Nguồn dữ liệu theo quyền.
- Event Trace và Quarantine gộp trong Điều tra sự kiện.
- Giữ Tài khoản & phân quyền, Audit và Thiết lập cá nhân. Không có Contracts & Tools trên menu chính.
- Auto Scaling và Health & Recovery dùng trạng thái thực sự có từ hệ thống. Chưa có API controller thì hiển thị chưa khả dụng; không tạo số replica, lịch sử scale/recovery giả hoặc nút điều khiển chưa được hỗ trợ.
- Giữ phân quyền route/API, token và session hiện có. Các route quản trị cũ còn lại phục vụ tương thích.

## API bổ sung

- `GET /api/v2/analytics/datasets?source_id=medusa-reference`: tìm các dataset được phê duyệt đang còn trong view, tránh dùng ID snapshot cũ.
- `GET /api/v2/analytics/explorer`: bắt buộc source, from/to; tùy chọn dataset và variant_id. Giới hạn 366 ngày; truy vấn tham số hóa trong transaction chỉ đọc. Trả daily counts, top 20 sản phẩm/từ khóa, catalog variant, giá và coverage khi phù hợp.
- `PATCH /api/account/profile`: chỉ sửa display_name của tài khoản hiện tại; khóa và kiểm tra session trong transaction, ghi audit cùng transaction.

Explorer là phân tích UNVERIFIED, không phải KPI được chứng nhận. Dataset synthetic được đánh dấu riêng, không nhập chung với lịch sử observed. Thiếu bucket không chứng minh hoạt động bằng 0. Lỗi view/API trả lỗi thay vì số liệu giả. Danh sách dataset phê duyệt nằm trong `dashboard-explorer.js`; cần cập nhật khi phát hành dataset mới.

## Kiểm chứng và giới hạn

- Build production React/TypeScript; test menu/quyền và biên thời gian UTC; test guard, session, tham số SQL và lỗi của explorer.
- Kiểm tra SELECT chỉ đọc trên database VPS cho observed, dataset lịch sử hiện tại và giá theo variant. Không thực hiện migration hay ghi dữ liệu VPS.
- Playwright dùng API fixture để kiểm tra thao tác giao diện local; không thay thế kiểm thử tích hợp sau triển khai cả dashboard-web và dashboard-api.
- Đã kiểm tra thêm end-to-end local với database VPS qua SSH stream: đăng nhập thật, catalog dataset, explorer observed/synthetic, giá variant và React Tổng quan/Sản phẩm; không mock API trong lượt này. UI tại `http://127.0.0.1:5182`, API tại `http://127.0.0.1:32001` trong phiên kiểm thử. Không bootstrap/seed/migrate. Các thay đổi tài khoản từ UI local sẽ tác động tài khoản thật.
- Những test cũ `feature-config` và `products-v2` có kỳ vọng không khớp baseline; chưa sửa ngoài phạm vi cập nhật này.
- OpenAPI đã bổ sung explorer/datasets; validator toàn bộ tài liệu vẫn báo thiếu hai path CDC reference có sẵn trong manifest, ngoài phạm vi thay đổi UI.
- Muốn sử dụng explorer trên hệ thống đang chạy phải triển khai cả API và web. Không dùng web mới với API cũ rồi coi lỗi endpoint là dữ liệu rỗng.
