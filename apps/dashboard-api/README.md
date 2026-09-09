# dashboard-api

## Admin V2 baseline

- `GET /api/v2/admin/roles`: ba capability bundles hiện có (không phải trình sửa permission).
- `GET /api/v2/admin/audit`: account audit read-only, yêu cầu `audit.read` của Admin.
- `GET /api/v2/admin/pipeline?source_id=...`: retained PostgreSQL V2 evidence; không dùng bảng V1,
  không suy ra liveness hay mất dữ liệu từ chênh lệch totals. Thiếu schema/DB trả 503, không dựng số 0.
- `/api/users`: quản lý tài khoản hiện có; tạo mới yêu cầu mật khẩu >=12 ký tự. PATCH chặn tự thay
  role/trạng thái, DELETE chặn tự khóa. Backend trả UUID tường minh, tương thích schema demo.
- Login/me trả permissions. Các nhóm admin và analytics trong app kiểm tra role/is_active trong DB
  mỗi request; token cũ không giữ quyền admin sau khi hạ quyền. DB auth lookup lỗi trả 503.

Yêu cầu schema V2 (chạy migration theo thứ tự) và dashboard_users.
Baseline hiện theo Master v0.2.8: Admin (`super_admin`), Analyst và Staff. API tạo/gán
role hỗ trợ ba giá trị này; `viewer` chỉ giữ tương thích tài khoản cũ, không được gán mới.
Staff có `analytics.read`, chỉ đọc V2 Overview/Funnel; các API analytics chi tiết còn lại
yêu cầu `analytics.workspace.use` của Analyst. Admin không mặc định đọc analytics.
Các capability workflow/recommendation chưa được triển khai, không quảng bá là đã có.

Database dashboard cũ cần áp dụng `infra/postgres/006_dashboard_staff.sql` sau schema
`003_dashboard_users.sql`, trước khi tạo/gán Staff. Đây là migration dashboard riêng,
không thuộc auto-migration canonical V2. Bootstrap không tự tạo hay nâng cấp schema.
Chưa áp dụng migration vào database runtime trong thay đổi này.

### Account security migrations

Kiểm tra trước khi chạy, từ `apps/dashboard-api`:

```powershell
npm run schema:check
# Nếu chủ động dùng file env local sẵn có:
node --env-file=../../infra/.env scripts/check-account-schema.mjs
```

Lệnh không tự nạp env ở dạng `npm run schema:check`; cần `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` trong environment.
Không cần biến AI/Medusa/JWT. Query chạy trong transaction READ ONLY, có connection/query
timeout. JSON không chứa credential, host hay raw DB error. Exit 0 chỉ khi `READY`;
`INVALID_CONFIG`, `MIGRATION_REQUIRED`, `UNAVAILABLE` đều exit 1. READY chỉ xác nhận
account-schema preflight, không xác nhận Kafka, analytics schema hoặc toàn bộ backend.

Quy trình dựng mới: provision account schema/migrations bằng tài khoản migration riêng,
chạy schema:check, rồi mới start API. Khi nâng cấp: sao lưu DB và dừng API cũ trước,
áp dụng các file dưới đây theo thứ tự với cơ chế dừng ngay khi SQL lỗi; không xóa volume
hoặc tự suy rằng chạy canonical V2 migrations đã nâng cấp dashboard accounts.

Trước khi chạy bản API này, dừng API cũ và áp dụng các migration dashboard riêng theo thứ tự:
`003_dashboard_users.sql` (nếu chưa có bảng), `006_dashboard_staff.sql`,
`007_dashboard_sessions.sql`, `008_dashboard_account_audit.sql`.
API audit thêm index từ `009_dashboard_audit_pagination.sql`.
Không chạy lẫn phiên bản API cũ/mới. Chưa áp dụng các migration này vào database runtime.

Startup chạy account schema preflight **trước bootstrap và trước mở HTTP listener**.
Preflight chỉ đọc: kiểm tra các cột tài khoản/audit cần dùng, kiểu integer NOT NULL của
session_version, role constraint có Staff và trigger thu hồi phiên được bật.
Thiếu schema dừng ngay với danh sách migration cần áp dụng; lỗi kết nối/seed được thử
lại tối đa 8 lần, cách 3 giây giữa các lần. Hết lượt thì đóng pool, exit code 1,
không mở API hoặc event poller. Database trống cũng cần provision migration trước.
Đây không phải auto-migration, kiểm tra toàn bộ schema analytics, hay chứng minh nội dung
trigger/function chưa bị operator sửa. Index 009 vẫn cần áp dụng theo hướng dẫn triển khai.

- JWT mới có `session_version`; token cũ không có version buộc đăng nhập lại.
- Trigger tăng version khi đổi mật khẩu/role/is_active. Mỗi request API được bảo vệ
  kiểm tra version và trạng thái trong DB; lỗi DB trả 503, không cho qua.
- Thu hồi áp dụng ở request tiếp theo; không hủy request thông thường đang xử lý.
  SSE hiện kiểm tra riêng trước từng batch và định kỳ khi idle, mô tả bên dưới.
- Quản lý tài khoản dùng transaction và table lock, kiểm tra lại actor sau lock;
  không cho commit nếu không còn Admin hoạt động. Áp dụng cho API quản lý tài khoản,
  không ngăn operator sửa SQL trực tiếp. Table lock ưu tiên tính đúng cho admin CRUD
  ít traffic, có thể gây chờ login/password updates; lock timeout 5 giây.
- Audit tạo/sửa/khóa tài khoản và tự đổi mật khẩu commit cùng thay đổi. Audit không
  chứa password/hash/token. Audit lỗi thì rollback; đây không phải tamper-proof log
  chống DB administrator, chưa có UI đọc audit hoặc audit các lần bị từ chối.
- Bootstrap chỉ tạo tài khoản khi store trống; không reset password, email hoặc
  bật lại tài khoản hiện có khi restart. Tạo Admin và audit `account.bootstrapped` nằm
  trong cùng transaction có table lock; nhiều startup đồng thời chỉ một lần tạo.
  Audit lỗi rollback tài khoản mới. Trong bản ghi bootstrap, actor_id=target_id là
  tài khoản được tạo bởi hệ thống, không phải danh tính operator đã đăng nhập.
  Lệnh `sync-admin` giữ tên để tương thích nhưng chỉ bootstrap, không reset tài khoản;
  kiểm tra schema trước và đóng DB pool sau khi chạy.
- Tự đổi mật khẩu yêu cầu >=12 ký tự, kiểm tra hash/version bằng conditional UPDATE
  để tránh ghi đè một lần đổi/reset mật khẩu khác. Sau thành công phải đăng nhập lại.

Legacy chat capability policy chưa được nâng cấp; chỉ áp dụng kiểm tra session chung,
không bổ sung chức năng AI. Chưa hoàn tất toàn bộ capability matrix ba vai trò.
Không dùng phần này như tuyên bố hoàn thiện security/production readiness.

### Account-wide logout

`POST /api/auth/logout-all` yêu cầu Bearer token còn hiệu lực, không cần request body.
Response thành công: `{ "ok": true, "scope": "all_sessions" }`. API tăng session_version
của chính tài khoản và ghi `sessions.revoked` cùng transaction. Token đã thu hồi trả 401;
DB/audit lỗi trả 503 và rollback, không báo thành công giả. Hai request cùng version chỉ
một request thành công. Các tài khoản khác không bị tác động; đăng nhập lại vẫn được.
Không có migration mới. Frontend chưa gọi API này; nút logout hiện tại vẫn chỉ xử lý local.
API không hủy request thông thường đang chạy hoặc hỗ trợ thu hồi riêng từng thiết bị.
SSE sẽ phát hiện version thay đổi qua guard riêng, không phải push-disconnect tức thời.

### SSE session guard

`GET /api/events/stream` hỗ trợ Bearer header hoặc query token cho EventSource cũ
(header được ưu tiên). Stream yêu cầu `analytics.workspace.use`, không mở cho Staff.
Trước mỗi batch events/kpi/ping, kiểm tra JWT expiry, DB is_active/session_version và
capability hiện tại. Khi idle, kiểm tra mỗi 5 giây; auth lookup quá 5 giây thì đóng stream.
DB lỗi, phiên bị thu hồi hoặc mất quyền đều đóng stream và dọn listener/timer/queue.
Hàng đợi tối đa 32 batch; overflow hoặc response backpressure đóng kết nối để client reconnect.

Đây không phải revocation đồng bộ với transaction: một batch đã được kiểm tra trước
thời điểm thu hồi vẫn có thể đã gửi/buffered. Auth query timeout không cancel query
PostgreSQL đang chạy, nhưng kết quả đến muộn không tiếp tục gửi trên stream đã đóng.
Guard không thay đổi nguồn dữ liệu legacy của stream, không thêm replay hoặc bảo đảm
không mất event; phần analytics V2 vẫn giữ API riêng. Không log URL query chứa token.

### Reading account audit

Integration test `test/auth-flow.integration.test.js` chạy full Express app trên cổng
tạm và PostgreSQL schema riêng khi có `TEST_DATABASE_URL`: đăng nhập thật bằng bcrypt/JWT,
tạo Staff, kiểm tra quyền, đổi mật khẩu, audit rollback, khóa/mở khóa không hồi sinh token,
và bootstrap không reset tài khoản hiện có. Không gọi Medusa hoặc dịch vụ AI.
Test sẽ SKIP nếu không cấp test database; không trỏ biến này vào database production.

`GET /api/v2/admin/audit?limit=25&action=account.updated&target_id=<uuid>`

- Bộ lọc optional: `actor_id`, `target_id` (UUID), `action` thuộc `account.created`,
  `account.updated`, `account.disabled`, `password.changed`, `account.bootstrapped`, `sessions.revoked`.
- `limit` mặc định 25, từ 1 đến 100. Response: `{ items, limit, next_cursor }`.
  Gửi lại `cursor=next_cursor` cùng các bộ lọc để đọc trang sau; null nghĩa hết trang.
- Thứ tự `created_at DESC, id DESC`; cursor giữ đủ microsecond PostgreSQL.
  Đây không phải snapshot/export nhất quán xuyên nhiều request: log commit mới
  có thể cần tải lại trang đầu để thấy. Cursor không phải credential hay quyền truy cập.
- Chỉ trả ID, actor/target ID, action, thời điểm và thay đổi role/trạng thái,
  cờ đổi mật khẩu/tên hiển thị. Không join email, trả password/hash/token hoặc raw JSON.
- Query không hợp lệ trả 400, không có quyền trả 403, thiếu schema/DB lỗi trả 503.
  Cache-Control: no-store. Không có endpoint sửa/xóa audit.

## Local V2 demo data

The demo seeder applies PostgreSQL migrations `001` through `012`, creates an
`analyst` account, and inserts a small source-scoped dataset for the dashboard:

```powershell
$env:DEMO_DATABASE_URL = "postgresql://app:demo@127.0.0.1:55432/realtime"
npm run demo:seed-v2
```

Default credentials are `analyst@funnelmetry.local` / `funnelmetry-demo` and
the seeded analytics source is `medusa-reference`. Use this only with a local
demo database; it is not production bootstrap data.

Tài liệu V1 tham khảo: **[API](../../legacy/docs-v1/API.md)** · **[Tech stack](../../legacy/docs-v1/TECH_STACK.md)**

## Analytics API V2

Các endpoint read-only mới đọc trực tiếp Journey/Funnel/KPI projection V2:

```text
GET /api/v2/analytics/overview?source_id=medusa-reference&from=<ISO>&to=<ISO>
GET /api/v2/analytics/funnels/:profileId?source_id=medusa-reference&profile_version=1.0.0
GET /api/v2/analytics/journeys?source_id=medusa-reference&limit=25
GET /api/v2/analytics/journeys/:journeyId?source_id=medusa-reference
GET /api/v2/analytics/events?source_id=medusa-reference&event_class=BUSINESS_FACT&limit=50
GET /api/v2/analytics/data-health?source_id=medusa-reference&from=<ISO>&to=<ISO>
```

Các endpoint dùng authentication/role zone giống shop analytics API hiện tại. `source_id` là bắt
buộc. `from`/`to` dùng `entry_at` cho Funnel KPI, `occurred_at` cho Event browser và `persisted_at`
cho canonical Data Health; response luôn ghi rõ window basis. Funnel cohort không được diễn giải là
KPI window đã mature. Response funnel ghi `metric_state: OBSERVED` và giữ outcome/quality thành hai chiều riêng.
Overview và funnel totals công bố riêng `finalized_dropped`, `late_conversions`, hai arrival class và
`late_conversion_rate = late_conversions / finalized_dropped`; late conversion không được cộng vào
`observed_converted` hay sửa historical horizon metric.
Final KPI công bố `eligible_matured`, `matured_converted`, `final_end_to_end_rate` và
`final_dropoff_rate`; pending, unconfigured hoặc non-authoritative conversion không vào mẫu số này.

Journey detail chỉ trả canonical event metadata và evidence summary; không trả raw/canonical
payload, identity value hoặc `journey_entities.entity_key`. Event browser cũng loại bỏ normalized data,
relations, source event identity và aggregate ID.
Late-conversion detail chỉ trả classification, timestamps và loại/phương pháp liên kết; không trả
matched business-key value hoặc evidence document nội bộ.

Data Health công bố metric từ accepted ingress receipt, terminal canonicalization outcome, canonical
ledger và Funnel KPI facts: terminal outcome rate, canonicalization/normalization/persistence latency,
time-basis quality và projection quality. Reconciliation snapshot/comparison/repair evidence từ migrations
`010`–`012` được tổng hợp theo `coverage_end_at`; missing, phantom, state mismatch, revenue deviation
và repair success chỉ có giá trị khi có đúng evidence/denominator.

`reconciliation.quality_gate` trả `UNAVAILABLE`, `PROVISIONAL`, `RECONCILING`, `RECONCILED` hoặc
`DEGRADED`. Chỉ `RECONCILED` có `eligible_for_authoritative_business_analysis: true`; gate này chỉ áp
dụng cho phân tích business authoritative, không phải global kill-switch. Các metric pre-handoff loss,
duplicate/rejected attempt và queue drop vẫn nằm trong `unavailable_metrics` thay vì dựng số.

Dashboard UI hiện dùng API V2 cho Overview, Funnels, Journeys, Events và Data Health.

HTTP contract test khởi chạy Express trên cổng tạm và kiểm tra `401`, `403`, `400`, `404`, role
`analyst/viewer`, query validation và response thành công. PostgreSQL integration test được bật khi có
`TEST_DATABASE_URL`.
