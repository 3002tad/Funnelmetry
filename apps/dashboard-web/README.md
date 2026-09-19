# Funnelmetry dashboard web

## Events auto-refresh

Events mặc định polling mỗi 5 giây khi tab đang hiển thị; có checkbox bật/tắt và
Refresh thủ công (khóa khi request đang chạy). Dừng polling nền, không retry tự động
trong cùng request; lỗi 401/403 dừng interval. Request nhận AbortSignal khi rời trang
hoặc đổi bộ lọc. Cache tách theo tài khoản, source, range và event class.
UI ghi thời điểm lần tải thành công; lỗi không cập nhật mốc này. Polling không tăng
tốc SDK/Relay/Gateway, không phải SSE và không bảo đảm latency end-to-end dưới 5 giây.
Giữ giới hạn 200 dòng và filter occurred_at; quarantine không nằm trong Events.

Kiểm tra thủ công: bật/tắt polling, ẩn/hiện tab, đổi filter, Refresh khi đang tải,
API lỗi rồi phục hồi, 403, rời trang khi request chậm. Không cần gửi event giả để thử UI.

## AI Chat V2

Lịch sử UI hiện giữ tối đa 50 lượt text trong `sessionStorage`, tách theo tài khoản,
ghi scope từng câu hỏi và khôi phục qua F5. Không lưu token hoặc evidence chi tiết vào
lịch sử. Câu đang chờ khi rời trang được đánh dấu gián đoạn, không tự gửi lại tới model.
Chat mới/đăng xuất xóa lịch sử; đây không phải lịch sử server hoặc multi-turn model memory.

- `/chat` yêu cầu cả `chat.use` và `analytics.read`; menu không cấp Chat cho System Admin.
- Gửi câu hỏi độc lập tới `POST /api/v2/chat`, với source và cohort 7/30/90 ngày từ thanh trên.
- Hiển thị câu trả lời dưới dạng text an toàn, evidence PostgreSQL và nhãn chưa xác minh.
  `profile-N` ánh xạ theo thứ tự bảng evidence. Pending không phải final drop-off.
- Có trạng thái đang chờ, dừng chờ, thiếu evidence, module tắt, giới hạn yêu cầu và lỗi kết nối.
- Không lưu hội thoại trên server, không có Qdrant retrieval hoặc recommendation-linked chat ở bước này.
- Qwen phải được bật/cấu hình riêng trên **backend** theo `runtime/qwen.env.example`.
  Không đưa DashScope API key vào biến `VITE_*`. Không tự bật model hay gọi trả phí khi mở trang.
- Kiểm tra thủ công: Analyst/Staff mở Chat; Admin không thấy menu và bị chặn route;
  gửi khi module tắt nhận thông báo; với backend có evidence, kiểm tra bảng nguồn/thời gian;
  đổi source/range hoặc rời trang khi đang chờ không được hiển thị kết quả cũ.

## Admin baseline

### Integrations / Sources

Database demo cũ cần `infra/postgres/v2/013_ingress_coordination.sql` sau các migration
phụ thuộc 001/005 để có `ingress_receipt_claims`. Ngày 2026-09-12 đã áp dụng 013 vào
`funnelmetry-v2-demo-postgres` (không phải private-ingress): API Admin trả 200, kiểm tra
exact filter, empty result và cursor đều thành công. Đây là kiểm tra API, chưa thay thế
kiểm thử thao tác trên trình duyệt. Không suy ra tất cả migration V2 đã được áp dụng.

`/admin/sources` yêu cầu `integration.read`, gọi `GET /api/v2/admin/sources`.
Danh sách chỉ phản ánh nguồn có retained evidence, không phải configuration registry.
Có lọc source_id chính xác, cursor pagination 25 nguồn/trang, refresh và trạng thái
loading/empty/error. Counts giữ dạng chuỗi PostgreSQL bigint. Kết nối luôn chưa xác minh;
không suy ra online, delivery loss hoặc DLQ size từ các count. Chưa hỗ trợ thêm/sửa nguồn,
key, connector, network probe hay replay. Trang chỉ đọc, không thay đổi AI hoặc Relay.

Kiểm tra UI: Admin thấy menu và dữ liệu/empty/error đúng response; Analyst không có menu
và bị chặn route; filter reset về trang đầu; next/previous giữ filter, không giữ dữ liệu
trang cũ như kết quả trang mới khi request lỗi. Chưa coi build là browser interaction test.

Login/me trả capability bundles từ backend. Admin được đưa tới `/admin/pipeline`, analyst tới
`/overview`; route guard và menu dựa trên permissions. Không tự cấp analytics.read cho System Admin.
Đăng xuất/đăng nhập lại nếu client cũ chưa nhận permissions.

- `/admin/users`: liệt kê, tạo tài khoản, đổi role, khóa/mở khóa; hiển thị quyền của hai role hiện có.
- `/admin/pipeline`: số liệu PostgreSQL V2 theo source, tự refresh 15 giây. Trạng thái runtime luôn
  UNVERIFIED vì chưa đo worker liveness/Kafka lag. Đây không phải health check toàn hệ thống.
- Settings vẫn là thiết lập cá nhân, không phải System Settings.

Đây là bước đầu của Master §17/§23.5, chưa đủ năm role, custom permission editor, audit log,
Integrations/Schemas/Mappings hoặc DLQ replay UI. Không có thay đổi Medusa/AI.

Frontend V2 của Funnelmetry. Các màn hình `Overview`, `Funnels`, `Journeys`, `Events` và `Data Health`
đọc dữ liệu thật từ Dashboard API V2; các màn hình còn lại vẫn là UI demo trong giai đoạn chuyển đổi.

## Cấu hình

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Các biến môi trường:

- `VITE_DASHBOARD_API_URL`: địa chỉ Dashboard API, mặc định `http://localhost:32000`.
- `VITE_ANALYTICS_SOURCE_ID`: source bắt buộc dùng để scope mọi analytics query.
- `VITE_ANALYTICS_WORKSPACE_NAME`: tên workspace hiển thị trên giao diện.

Mở `http://localhost:5180`, đăng nhập bằng tài khoản của Dashboard API. Access token chỉ được lưu
trong `localStorage` để phục vụ bản local demo; UI không chứa token hard-code.

## Trạng thái dữ liệu

- `Overview`: Funnel Profile instance totals và observed conversion.
- `Funnels`: từng profile/version, reached steps và quality state.
- `Journeys`: canonical event metadata, identity evidence summary và Funnel Instances.
- `Events`: canonical ledger metadata; không trả raw payload, identity hoặc aggregate ID.
- `Data Health`: time-basis, processing latency, Funnel projection quality, reconciliation/repair evidence
  và authoritative business quality gate. Gate chỉ eligible khi mọi window trong scope đã `RECONCILED`.
- `Settings`: tài khoản thật, analytics scope đang dùng và đổi mật khẩu qua Dashboard API.
- `Products`, `Insights` và session detail: còn dùng mock/demo data.

Các conversion rate trên UI là `OBSERVED` theo cohort `entry_at`, chưa phải matured/final KPI.

## Kiểm tra production build

```powershell
npm run build
```

Output được tạo tại `dist/` và không được commit.

Các page route được lazy-load. Data Health dùng SVG React nhẹ thay cho chart runtime; cả `echarts` và
`echarts-for-react` đã được loại bỏ để giảm bundle và dependency attack surface.

Frontend hiện build bằng Vite 8 và React Router 7 trên Node `^20.19.0 || >=22.12.0`.
