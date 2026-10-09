# Demo mới — 08/10/2026

Project `funnelmetry-demo-new`, fresh OFFLINE_DEMO với PostgreSQL/Kafka riêng.
Người dùng đã đồng ý bỏ image cũ và tạo demo mới; không restore dữ liệu lịch sử.
Docker trước thao tác không có container/volume. Đã xóa 15 tag của 6 image
Funnelmetry cũ tại local, không xóa image GHCR, PostgreSQL/Kafka hoặc build cache.
Bản release cũ có thể pull lại bằng digest trong CODEX_HANDOFF.md.

## Dùng hằng ngày

- Bật Docker Desktop (Linux containers).
- Chạy `start-new-demo.cmd` để bật; mở http://localhost:5180.
- Admin email/password trong file ignored `runtime/demo-new.env`.
  Tạo Analyst qua Users để xem analytics; không cấp analytics cho Admin.
- Chạy `stop-new-demo.cmd` để dừng và giữ dữ liệu.
- Không dùng launcher `start-private-demo.cmd` (deployment cũ không còn container).

`runtime/new-demo.ps1 -Action status` liệt kê dịch vụ. Launcher không build/pull,
seed dữ liệu, gọi model, reset cursor hoặc xóa volume; `up` có thể recreate service
khi config thay đổi. Bootstrap chỉ tạo schema/tài khoản khi DB trống.
Không dùng `down -v` để dừng. Không ghi secrets vào Git hoặc gửi cả env qua chat.

## Image / cấu hình

Images local `funnelmetry/demo-api:20261010-alerts`, `funnelmetry/demo-web:20261010-alerts`,
`funnelmetry/demo-workers:20261009-health` build từ worktree có thay đổi Event Feed,
không phải release mới đã commit/publish. Không ghi đè các tag SHA bàn giao cũ.
File demo-new.env dùng các biến của handoff.env.example; secrets ngẫu nhiên riêng.
DB/Kafka không mở port host; UI bind 127.0.0.1. Bốn Compose files:
`compose.handoff.yml`, `compose.handoff-pipeline.yml`, `compose.handoff-analytics.yml`,
`compose.handoff-monitoring.yml`.

Đây là demo trống, không tự có đơn/event hoặc lịch sử chat cũ. Các tool staging được
cài nhưng chất lượng dữ liệu/đầy đủ lịch sử không được suy ra từ việc cài thành công.
Source Connector và catalog-sync chưa bật; Qwen/Polars tắt. Trang Event Feed mới
hiển thị UNVERIFIED khi chưa có connector — không phải lỗi đăng nhập hay mất data.

Muốn bật live: xác nhận source access, feed lineage, retention và initial boundary
cho DB mới theo CODEX_HANDOFF.md; không ngầm dùng cursor cũ hoặc tự đặt 0.
Muốn bật Qwen/catalog: nạp credentials riêng qua env local và đúng overlays.
Không dùng thông tin đăng nhập thành công/healthy làm bằng chứng live acceptance.

## Evidence lần dựng mới

- Harness Docker project `funnelmetry-handoff-test-7d0bb6e031ce` chạy image mới,
  initial/resume + downstream/analytics acceptance kết thúc exit 0; project và
  named volumes test đã dọn, không phải dữ liệu của demo mới.
- `new-demo.ps1 -Action start` exit 0; API/UI/PostgreSQL/Kafka và 6 worker chạy.
- Probe qua nginx xác nhận login 200, Event Feed API 200 + UNVERIFIED/null observation
  đúng khi không có Connector, SPA `/admin/event-feed` 200, canonical_events = 0.
  Host UI localhost:5180 trả 200. Không phải browser automation/live feed acceptance.
- Images còn trong danh sách: 3 image demo mới + postgres:15-alpine + apache/kafka:3.9.1.
- Build API cảnh báo 1 critical: `proxy-addr` <2.0.8,
  GHSA-jqcg-44mw-7w3h (npm audit --omit=dev). Chưa sửa dependency trong lượt dựng demo;
  cần triage/update/test trước public deployment. Demo chỉ bind loopback, nhưng điều
  này không phải chứng nhận vulnerability đã được xử lý. Cảnh báo build dependency
  UI trong HANDOFF.md cũng chưa được đóng.

### Follow-up vá API — 08/10/2026

- Cập nhật duy nhất dependency gián tiếp `proxy-addr` 2.0.7 → 2.0.8 trong API
  lockfile, trong range Express hiện có; không nâng major, không chạy install scripts.
- `npm audit --omit=dev --json`: 0 vulnerabilities tại thời điểm kiểm tra. Đây
  không phải container CVE scan hay chứng nhận toàn bộ hệ thống an toàn.
- API suite: 144 PASS, 4 PostgreSQL integration tests SKIP (không có TEST_DATABASE_URL).
- Build `funnelmetry/demo-api:20261008-security`, đổi reference trong env local và
  recreate riêng dashboard-api với `--no-deps`. PostgreSQL/UI được start lại từ
  container có sẵn; Kafka/workers chưa resume trong lượt vá này.
- Container xác nhận proxy-addr 2.0.8; login qua nginx, Event Feed API và chặn
  anonymous đều PASS. API healthy, volume `funnelmetry-demo-new_handoff-db` giữ nguyên.
- Không migration/seed/reset, không gọi source/model, không publish registry.
  Image API trước vá còn local để rollback; không chạy mặc định. Cảnh báo UI cũ
  vẫn chưa được đóng. Dùng start-new-demo.cmd để resume toàn bộ demo khi cần.

### Follow-up launcher và resume toàn bộ demo — 08/10/2026

- `new-demo.ps1` lấy port UI thực tế từ Compose, chỉ chấp nhận binding loopback.
  Sau `up --wait`, kiểm tra HTTP 200 + root HTML từ host và anonymous Event Feed
  API trả 401 qua nginx. Không đọc/in mật khẩu để thực hiện probe.
- Probe thất bại trả exit 1, giữ container/volume để chẩn đoán; không tự reset.
  Truyền script Node qua stdin để tránh PowerShell 5 làm mất dấu ngoặc kép.
- Chạy launcher sau sửa: exit 0; PostgreSQL, Kafka, API, UI và 6 worker healthy.
  UI xác nhận tại http://127.0.0.1:5180. PowerShell syntax và git diff check PASS.
- Compose chạy lại các job khởi tạo có sẵn (bootstrap/topic/profile/release).
  Không xóa volume, không reset cursor, không gửi event thử, không bật live feed/Qwen.
  Đây là kiểm tra khởi động và HTTP/auth boundary, không phải kiểm chứng dữ liệu
  end-to-end, consumer lag hoặc khả năng phục hồi khi mất host.
- Theo skill pipeline-recovery-observability và Master §24.3, thông báo launcher
  phân biệt service readiness với bằng chứng xử lý dữ liệu hoàn tất.

### Follow-up Admin Processing — 08/10/2026

- API/UI hiện dùng tag local `20261008-processing`; worker giữ tag `20261008`.
- Mở `/admin/processing` bằng Admin để xem kết quả chuẩn hóa, canonical và KPI
  còn lưu. Kafka lag vẫn là chưa xác minh, không phải 0.
- Chi tiết phạm vi và kiểm chứng: `docs/ADMIN_PROCESSING_2026-10-08.md`.
- Recreate riêng API/UI; không migration, reset dữ liệu hay bật Medusa/Qwen.

### Follow-up Kafka lag — 08/10/2026

- API/UI dùng tag `20261008-lag`; launcher thêm overlay monitoring chỉ đọc.
- Trang Processing đọc offset broker thật cho 7 cặp group/topic. Demo trống đang
  có high=0, committed=-1: hiện NO_COMMITTED_OFFSET, không tự nhận lag bằng 0.
- Chi tiết cấu hình, giới hạn và kiểm chứng: `docs/ADMIN_KAFKA_LAG_2026-10-08.md`.
- Worker/DB/Kafka giữ nguyên; không gửi event, reset offset hoặc bật source/AI.

### Follow-up thành viên nhóm Kafka — 09/10/2026

- API/UI dùng tag local `20261009-membership`. Trang Processing thêm trạng thái
  nhóm và số thành viên, không hiển thị danh tính/IP hay metadata nội bộ.
- Broker thực tế trả 6 nhóm Stable, mỗi nhóm 1 thành viên tại thời điểm kiểm tra.
  Không dùng Stable để chứng nhận worker xử lý thành công hoặc hết backlog.
- Chi tiết: `docs/ADMIN_KAFKA_MEMBERSHIP_2026-10-09.md`.
- Chỉ recreate API/UI; không thay đổi dữ liệu, worker, offset hoặc bật live feed/AI.

### Follow-up worker runtime — 09/10/2026

- API/UI/workers dùng tag local `20261009-health`; overlay monitoring bật listener
  nội bộ 32110 cho 6 worker, không publish port lên host.
- Processing có thẻ trạng thái từng worker; runtime smoke trả 6 READY. Đây là cờ
  Kafka runtime tự báo, không phải kiểm tra DB liên tục hoặc chứng nhận xử lý đủ.
- Chi tiết và tests: `docs/ADMIN_WORKER_READINESS_2026-10-09.md`.
- Recreate worker/API/UI; giữ nguyên DB/Kafka/volumes/offset. Không bật Medusa/AI.

### Follow-up metrics — 09/10/2026

- API dùng `20261009-metrics`, UI/workers vẫn `20261009-health`.
- `/api/v2/admin/metrics` xuất định dạng Prometheus có phân quyền Admin, dùng
  session Bearer hiện hành. Dữ liệu chưa xác minh không đổi thành lag/ready = 0.
- Runtime HTTP smoke và promtool check metrics PASS. Chỉ recreate API.
- Chưa dựng Prometheus/Grafana hay credential cho scrape tự động lâu dài.
  Chi tiết: `docs/ADMIN_MONITORING_METRICS_2026-10-09.md`.

### Follow-up dashboard monitoring artifacts — 09/10/2026

- Thêm dashboard Grafana import thủ công và mẫu cấu hình Prometheus tại
  `infra/observability/`; hướng dẫn trong `infra/observability/README.md`.
- Artifact tests: 3 PASS; promtool syntax và 3 truy vấn regression PASS.
  Phân biệt known zero, chưa có observation và scrape thất bại.
- Chưa deploy Prometheus/Grafana, chưa kiểm chứng import bằng trình duyệt;
  không thêm container vào launcher hoặc đổi image demo trong bước này.
- Scrape demo cần session có quyền còn hiệu lực; credential máy chạy tự động
  cần thống nhất vòng đời cấp/rotate/revoke trước khi triển khai lâu dài.
- Không migration, đổi dữ liệu/cursor/offset hay bật source/model.

### Follow-up machine key và monitoring runtime — 09/10/2026

- Prometheus/Grafana đã chạy bằng khóa metrics riêng, không dùng session Admin.
- Grafana: http://localhost:5182, user `monitoring-admin`; mật khẩu nằm trong
  ignored `runtime/monitoring/grafana-password`. Dashboard trong thư mục Pipeline.
- Launcher start/stop tự gồm monitoring khi có `runtime/monitoring.env`.
- Đã apply migration bổ sung `011_monitoring_credentials.sql`; không đổi bootstrap
  digest hoặc bảng event/cursor. Khóa demo hết hạn sau 7 ngày, phải rotate chủ động.
- Runtime kiểm chứng dashboard 8 panel, scrape UP=1, 6 worker observations;
  khóa bị thu hồi/hết hạn bị từ chối. Đây không phải chứng nhận dữ liệu end-to-end.
- Runbook: `docs/MONITORING_MACHINE_CREDENTIALS_2026-10-09.md`.

### Monitoring key rotation helper

- `rotate-monitoring-key.cmd` hoặc `node runtime/manage-monitoring-key.mjs rotate`:
  thay khóa, chỉ recreate Prometheus; xác nhận scrape mới rồi mới thu hồi khóa cũ.
- Có status/revoke và pending journal để chạy tiếp khi gián đoạn, không in secret.
- 4 workflow tests PASS; chưa kiểm chứng rotation thực tế vì Docker đang tắt.
  Lượt thử chưa cấp khóa mới hoặc thu hồi khóa hiện hành.

### Rotation acceptance — 10/10/2026

- Sau khi Docker bật lại, launcher start thành công; đổi khóa thực tế exit 0.
- Xác nhận scrape mới thành công trước khi thu hồi khóa cũ; pending journal đã
  hoàn tất. Check monitoring PASS: 8 panel, UP=1, 6 worker observations.
- Khóa mới hết hạn lúc 00:03 ngày 17/10/2026 (giờ Việt Nam); rotate trước hạn.
- Chỉ Prometheus recreate trong bước đổi khóa; không reset dữ liệu/cursor/offset.

### Admin cảnh báo — 10/10/2026

- `/admin/processing` thêm cảnh báo scrape, worker và hạn khóa; tự cập nhật mỗi
  15 giây khi trang đang mở. UNKNOWN tách khỏi lỗi/giá trị 0, chưa gửi thông báo ngoài.
- API/UI hiện dùng tag `20261010-alerts`; chỉ recreate API/UI để triển khai.
- Dừng thử canonical-normalizer → WORKER_UNVERIFIED; bật lại → cảnh báo hết.
  Worker đã được khôi phục. Prometheus UP=1, Grafana đủ 6 worker observations.
- API 169 PASS / 4 SKIP; UI build PASS. Không migration/reset/source/model.
- Chi tiết và giới hạn: `docs/ADMIN_MONITORING_ALERTS_2026-10-10.md`.
