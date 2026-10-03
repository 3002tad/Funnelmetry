# Rà soát Pipeline theo Master — 2026-09-11

> ARCHIVE — snapshot theo các commit/Master được ghi bên dưới, không phải backlog hay kiến trúc hiện hành. Không dùng các mô tả role/transport cũ để triển khai hôm nay. Xem [mục lục](../README.md); đường dẫn code trong nội dung tính từ repository root.

## Cập nhật triển khai đợt 1

Đã xử lý hai hạng mục đầu: authorization Admin/Chat/Insights và tách startup core
khỏi AI/V1. Các nhận xét bên dưới là snapshot trước sửa, không phải mọi mục đã hoàn tất.

- Admin không có `chat.use`/`insight.read`; Analyst và Staff có capability theo §17.
  Insights chuyển ra khỏi router system/user.manage; Chat kiểm tra quyền hiện tại trong DB.
- `DASHBOARD_ENABLE_AI` và `DASHBOARD_ENABLE_LEGACY` độc lập, mặc định false.
  Core auth/admin/analytics V2 không bắt buộc env AI/tracking V1. Khi tắt V1 không nạp
  route V1 hoặc chạy event poller. Module tắt trả 503 sau kiểm tra quyền.
- Guard nhận diện cả chữ hoa và dấu slash cuối cho các route Express tương ứng;
  test full-app xác nhận Admin bị chặn và request chưa đăng nhập nhận 401.
- Đã kiểm thử bằng Node 22/container và PostgreSQL 15 cô lập: bộ backend 31/31,
  cộng full-app với legacy-only, AI-only và cả hai bật đều đạt. Test AI chỉ kiểm tra
  nạp module/authorization/validation, không gọi model hoặc xác nhận chất lượng AI.
- Chưa kiểm thử end-to-end Medusa, startup deployment thực tế hoặc health probe V1
  với toàn bộ dịch vụ ngoài. Không áp migration vào DB runtime, không đổi UI/Medusa.
- Hướng dẫn cờ và lưu ý nâng cấp demo cũ: `apps/dashboard-api/README.md`.
  Chưa commit/push đợt này. Account preferences được bổ sung ở đợt 2 bên dưới;
  Admin inventory và UI còn tiếp tục.

## Cập nhật triển khai đợt 2 — account settings backend

- Thêm GET/PATCH `/api/account/preferences`, migration dashboard 010; lưu per-account,
  allowlist theme/language/timezone/format/notifications/analytics defaults.
- Thêm GET `/api/account/activity`, chỉ lấy audit liên quan tới tài khoản đang đăng nhập,
  phân trang keyset, không cho client chọn account khác, không lộ actor hay giá trị cấu hình.
- PATCH recheck phiên dưới row lock, merge và audit cùng transaction. Audit lỗi rollback.
- Test full-app/PostgreSQL cô lập kiểm tra lưu qua phiên đăng nhập khác, cách ly tài khoản,
  PATCH đồng thời, rollback, pagination, missing schema và revoked token.
- Chưa triển khai UI tiêu thụ settings, notification delivery hoặc toàn bộ business activity.
  Migration 010 chưa chạy trên database runtime; hướng dẫn và contract ở dashboard-api/README.

Kiểm thử hồi quy: 32/32 đạt, không skip, Node 22 và PostgreSQL 15 cô lập.

## Cập nhật đợt 3 — observed source inventory

Đã thêm API Admin read-only `/api/v2/admin/sources`, capability `integration.read`,
pagination và filter nguồn. Chỉ liệt kê nguồn có retained V2 evidence; không phải danh
mục cấu hình hoàn chỉnh, không suy ra connectivity. Claims và accepted receipts tách biệt;
không lộ payload hoặc secret. Chưa triển khai source CRUD, UI hoặc health probe mạng.
Master remote `6e444f9` bổ sung profile Tailscale private-ingress; đợt này không triển khai
profile đó và không chỉnh cấu hình Medusa/HMAC. Contract chi tiết ở dashboard-api/README.

Kiểm thử hồi quy: 33/33 đạt, không skip, PostgreSQL cô lập; có test phân quyền,
pagination, nguồn chỉ có claim/outcome, không lộ dữ liệu thô và thiếu schema trả 503.

## Phạm vi và căn cứ

- Master: System_Backbone `1987eb1`, gồm §4.11.1 Edge Relay và §17/§23 baseline ba role.
- Pipeline đang checkout `main` tại `d0dd9a3`.
- Relay được đọc từ nhánh `feat/edge-relay` tại `0bf4013`, chưa nằm trên main.
- Medusa integration local ở `ab1ac82`; thư mục Medusa đang checkout main `0fd1447`.
- Ưu tiên người dùng: hoàn thiện backend; AI và chạy tích hợp Medusa để sau.

Đây là rà soát tĩnh code, cấu hình và tài liệu, không phải chứng nhận runtime hoặc security audit
toàn diện. Không chạy lại test, không mở demo, không xác nhận migration trong DB đang dùng.
Kết quả 29 test pass ở lần trước chỉ bao phủ suite account/analytics được chọn, không chứng minh
toàn bộ Master đã được triển khai. Nội dung OPEN/PROVISIONAL cần giữ đúng trạng thái.

## Nền tảng đã có

| Nhóm | Bằng chứng trong repository | Giới hạn hiện tại |
|---|---|---|
| Ingestion | apps/input-gateway: browser/HMAC auth, Kafka transaction, receipt và coordination | Không suy ra toàn bộ external integration đã chạy được |
| Canonical | workers/canonical-normalizer, canonical-ledger-writer; packages/canonical-contract | Mapping và source capability quyết định fact được hỗ trợ |
| Journey/Funnel/KPI | journey-processor, funnel-processor, maturity-scheduler, kpi-projector | Có cơ chế không đồng nghĩa profile/time policy/runtime đã được bật đầy đủ |
| Reconciliation | reconciliation-worker repository/CLI: snapshot, comparison, repair, verification | Chưa có bằng chứng source transport/runtime tự động trong lượt rà soát này |
| Account security | dashboard-api: session_version, account transaction/audit, last-admin guard, SSE guard, schema check | Migration riêng; chưa hoàn tất mọi capability và account settings |
| Analytics API/UI | V2 Overview, Funnel, Journey, Events, Data Health | Các màn hình khác còn mock hoặc thiếu backend V2 |

## Các điểm cần sửa theo ưu tiên

### P1 — Ranh giới quyền và phụ thuộc backend

1. **Admin còn đọc được nội dung nghiệp vụ qua route legacy.**
   - `apps/dashboard-api/src/lib/roles.js`: canAccessChat cho phép canAccessAdmin.
   - `src/app.js`: chat router sử dụng requireChatRole; adminOps sử dụng user.manage.
   - `src/lib/api-zones.js` và `src/routes/system.js`: `/api/chat/insights` thuộc adminOps,
     trả listRecentInsights cho Admin.
   - Lệch Master §17.3–17.4: Admin không có analytics/insight/chat trong bundle mặc định.
   - Sửa: explicit capability từng route hoặc disable phần AI chưa dùng; test 403 ở full app.
     Chỉnh authorization không yêu cầu phát triển mô hình AI.

2. **Backend tài khoản/analytics còn phụ thuộc cấu hình AI và V1 lúc khởi động.**
   - `src/config.js` bắt buộc QDRANT/OLLAMA/PIPELINE_TRACKING_API_URL.
   - `src/app.js` import/mount route legacy; `src/index.js` luôn startEventPoller đọc bảng V1.
   - Cản trở mục tiêu chạy backend V2 độc lập của phase hiện tại.
   - Sửa: cấu hình feature/module rõ ràng, chỉ yêu cầu biến của module bật; giữ core
     auth/analytics/admin khởi động được khi AI và legacy tắt. Tránh biến thiếu bằng dummy URL.

3. **Quyền quản trị hệ thống đang gộp dưới user.manage.**
   - `src/app.js` dùng user.manage cho cả systemRouter và usersRouter.
   - `ROLE_PERMISSIONS` hiện chỉ cung cấp một phần nhỏ capability matrix.
   - Sửa theo module thực có: pipeline.monitor cho evidence vận hành, audit.read cho audit,
     user.manage/role.manage cho hành động tương ứng. Không quảng bá permission chưa có chức năng.

### P2 — Hoàn thiện sản phẩm và contract giữa frontend/backend

4. **Staff chưa đồng bộ ở giao diện.** `dashboard-web/src/app/App.tsx` và AppShell dùng
   analytics.read cho cả menu/drill-down; backend yêu cầu analytics.workspace.use cho chi tiết.
   AdminUsersPage còn hai option role, chưa có Staff. Cần sửa guard/menu và role selector.

5. **Settings lệch contract mật khẩu.** SettingsPage yêu cầu tối thiểu 6 ký tự; API yêu cầu 12.
   AuthContext logout chỉ xóa local; logout-all API chưa có control riêng. Cần làm rõ thao tác
   đăng xuất thiết bị hiện tại và đăng xuất tất cả, không âm thầm đồng nhất hai nghĩa.

6. **Account Settings theo §23.6 chưa đủ.** Chưa có backend lưu theme/language/timezone,
   notification preferences, analytics defaults và personal activity log. Audit quản trị hiện có
   không mặc nhiên cho mọi user đọc; personal log phải scope từ danh tính đã xác thực.

7. **Admin modules còn thiếu.** API/UI Integrations, Sources, Schemas, Mappings và DLQ/replay
   chưa thành bộ quản trị V2. Pipeline Health hiện là retained PG evidence và ghi UNVERIFIED,
   chưa đo Kafka lag/worker liveness. Bắt đầu API chỉ đọc inventory/status từ cấu hình/evidence
   thật, rồi mới các mutation/replay có permission, audit và idempotency.

8. **Nghiệp vụ Staff chưa triển khai đầy đủ.** Chưa tìm thấy schema V2 cho workflow
   recommendation approval/assignment/status, external implementation và evaluation trong
   các migration đã kiểm tra. Cần thiết kế trạng thái/audit theo §15/§17, tách approval với
   implementation. Không tạo recommendation giả hoặc suy rằng approval đã là implementation.
   Việc sinh recommendation/ML/LLM vẫn hoãn; chi tiết evaluation provisional không tự chốt.

9. **Products/Insights/session detail còn demo.** README dashboard-web và các import mock
   xác nhận điều này. Chưa thể coi UI đã có là dữ liệu backend đã hoàn thiện; Products cần
   catalog/dimension V2 phù hợp Master, Insights thuộc phase hoãn AI.

### P3 — Relay và vận hành, xử lý khi chuyển sang phase kết nối

10. **Relay đã có ở nhánh riêng, không cần viết lại từ đầu.** Có SQLite WAL/FULL,
    relay receipt, delivery worker, SDK update và deploy guide trong `feat/edge-relay`.
    Cần review contract, crash/retry/quota tests trước khi merge; lượt này chưa chứng nhận
    độ bền hoặc correctness của toàn bộ implementation Relay.

11. **Local Compose không phải deployment private theo §4.11.1.** Base Compose publish
    `31000:31000` và DB `55433:5432`; nhánh Relay cũng giữ cấu hình này. Nếu dùng nguyên file
    để triển khai private profile thì chưa đáp ứng yêu cầu không publish ingress ra LAN/Internet.
    Relay config/README chấp nhận upstream HTTP; cần phân biệt local Docker network với
    signed HTTPS/backend/private Tailscale và cấu hình ACL/TLS dành cho deployment thật.
    Đây là chênh lệch deployment profile; không phải bằng chứng máy hiện tại đang public.

12. **Đường dựng backend chưa trọn gói.** Compose V2 đang tập trung worker/ingress, chưa
    bao gồm dashboard-api và account migrations 003/006–009. schema:check đã hỗ trợ phát
    hiện thiếu, nhưng teammate vẫn phải provision riêng. Cần entrypoint triển khai rõ ràng
    cho dashboard và thứ tự migration, giữ nguyên dữ liệu hiện có.

## Tài liệu đang lệch

- dashboard-web/README.md còn nhắc hai role/năm role dù Master chốt ba role.
- workers/README.md nói comparison/repair chưa bật trong khi reconciliation-worker/README.md
  mô tả repository và operational CLI đã có; cần phân biệt code có với runtime activation.
- REPOSITORY_LAYOUT.md còn mô tả một số capability như triển khai sau dù worker đã tồn tại.
- ACCOUNT_SECURITY changelog có câu trạng thái chưa commit từ trước commit d0dd9a3;
  nên ghi theo mốc lịch sử thay vì để hiểu là trạng thái Git hiện tại.

## Thứ tự thực hiện đề xuất

1. Khép ranh giới authorization và tách core backend khỏi AI/legacy startup.
2. Đồng bộ role/contract ở UI, hoàn thiện account preferences và personal activity API.
3. Bổ sung Admin inventory/status V2 và đường dựng backend/migration tái lập được.
4. Triển khai các workflow nghiệp vụ đã APPROVED theo từng contract, giữ AI ngoài phase.
5. Review/merge Relay và tích hợp Medusa khi bắt đầu phase kết nối; đóng conflict bằng runtime evidence.

Tiêu chí từng đợt: route có đúng capability, dữ liệu có nguồn rõ ràng, mutation có audit,
test đúng đường gọi thật, tài liệu nêu đúng phần đã chạy và phần chưa kiểm chứng.
