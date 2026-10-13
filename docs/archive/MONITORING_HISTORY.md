# Admin monitoring — hồ sơ test và bàn giao 08–10/10/2026

> Bằng chứng theo mốc cũ, không chứng nhận monitoring của deployment hiện tại. Xem docs/MONITORING.md và docs/OPERATIONS.md.

Đường dẫn `Nguồn gốc` bên dưới là vị trí trước khi gộp; các file riêng đã được loại bỏ. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

## Mục lục theo tài liệu nguồn

- [Admin monitoring evidence](#admin-monitoring-evidence) — `docs/archive/ADMIN_MONITORING_EVIDENCE_2026-10-08_TO_10.md`
- [Teammate monitoring test](#teammate-monitoring-test) — `docs/TEAMMATE_MONITORING_TEST_2026-10-10.md`

---

<a id="admin-monitoring-evidence"></a>

> Nguồn gốc: `docs/archive/ADMIN_MONITORING_EVIDENCE_2026-10-08_TO_10.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Admin/monitoring implementation evidence — 08–10/10/2026

> **HISTORICAL / NON-NORMATIVE.** Hồ sơ này gộp bảy bản ghi `ADMIN_*_2026-10-08/09/10.md` của Pipeline. Số test, image tag và trạng thái container dưới đây thuộc các mốc đó, **không** phải kết quả chạy trên deployment hiện tại. Xem [trạng thái chức năng](../FEATURE_STATUS.md), [kiểm thử](../TESTING.md) và [vận hành](../OPERATIONS.md) trước khi demo. Bản gốc vẫn truy vết được qua Git history theo tên file cũ.

## Tóm tắt theo mốc

| Ngày / capability | Đã triển khai tại mốc đó | Bằng chứng / giới hạn |
|---|---|---|
| 08/10 — Event Feed | Connector lưu `feed_observation` trong memory sau whole-batch validation; `GET /api/v2/admin/event-feed` và trang Admin read-only | Connector 34 PASS; API 144 PASS, 4 DB-dependent SKIP; navigation 5 PASS/build PASS. Chưa có live-source/browser E2E ở đợt này. |
| 08/10 — Processing | `GET /api/v2/admin/processing` tổng hợp PostgreSQL latest outcomes/canonical/KPI và trang stage cards | API 145 PASS, 4 SKIP; PostgreSQL shadow-table + local HTTP smoke. Không phải Kafka lag hay completeness audit. |
| 08/10 — Kafka lag | `GET /api/v2/admin/kafka-lag` đọc allowlisted group/topic offsets bằng KafkaJS admin | API 151 PASS, 4 SKIP; offline broker 7 pairs/partitions, NO_COMMITTED_OFFSET. Chưa thử workload live nonempty. |
| 09/10 — Membership | Additive `membership` (status/state/member_count) theo broker group trên lag API | API 154 PASS, 4 SKIP; broker demo 6 groups Stable/1 member, 7 topic rows. Không có worker-kill/browser automation. |
| 09/10 — Worker readiness | `/healthz`/`/readyz` nội bộ cho sáu worker; `GET /api/v2/admin/worker-readiness` và UI cards | API 158 PASS, 4 SKIP; worker/shared health 85 PASS, 6 SKIP; sáu demo endpoints READY. Chỉ process-local runtime flag, không phải continuous DB check hay all-replica inventory. |
| 09/10 — Metrics | Authenticated `GET /api/v2/admin/metrics` xuất Prometheus text 0.0.4 từ bounded probes | API 162 PASS, 4 SKIP; real HTTP metrics và `promtool check metrics` PASS. Chưa có unattended scrape/alert delivery ở đợt này. |
| 10/10 — Monitoring warnings | `GET /api/v2/admin/monitoring-alerts`, Prometheus target/worker/key-expiry observations và UI poll khi trang mở | API 169 PASS, 4 SKIP; local fault test stop/restart một worker rồi warning clear. Chưa chứng minh catch-up/idempotency dưới tải, persisted incident hay external notification. |

Đây là các snapshot test suite tăng dần, **không cộng** chúng thành tổng số test độc lập. Các tag local cũ (`20261008-*`, `20261009-*`, `20261010-*`) không tự chứa thay đổi mới và không phải digest phát hành hiện hành.

## Semantics và ranh giới bảo mật còn phải giữ

- Tất cả Admin APIs cần current session + `pipeline.monitor`, recheck sau bounded probe/query, `no-store`; không nhận broker/URL/topic tùy ý từ client. Không có Docker control, reset offset/cursor, replay hay scale endpoint. Analyst/anonymous không có quyền.
- Event Feed observation có thể cũ sau poll error hoặc mất khi Connector restart. Nó được chụp **trước** Kafka publish; valid Source batch không chứng minh durable Pipeline handoff. Sequence gap không phải số event thiếu.
- Processing counts có grain khác nhau: latest outcome per source event, canonical per mapping version và KPI application per trigger. Không trừ count/timestamp giữa grain để suy backlog hoặc latency. DB/schema failure phải là unavailable, không là zero.
- Kafka lag là high offset trừ committed **next** offset theo partition, unit offset positions. Missing commit, below retention, inconsistent snapshot và oversized response trả unknown/null; lag zero không chứng minh worker đang xử lý. Membership Stable/member count là broker group evidence, không phải số container hay business-event completeness.
- Worker readiness chỉ kiểm tra fixed internal targets và local Kafka runtime flag. `healthz` khác `readyz`; endpoint worker không được public. Unreachable/old image/mismatch là `UNVERIFIED`, không tự suy STOPPED.
- Metrics unknown không bị xuất thành zero; exact large offsets vượt safe float bị bỏ khỏi metric nhưng JSON API có decimal string. Scrape HTTP 200 chỉ là collection; phải xem availability/freshness. Label/cardinality từ allowlist, không xuất member identity, payload, secret hay raw error.
- Monitoring warnings phân biệt scrape DOWN với target UNKNOWN, worker non-ready với absent observation, và key expiry với key actually used. Browser poll mỗi 15 giây chỉ khi mở trang; không có sustained-condition window, Alertmanager/email, ack history hoặc auto-recovery.

## Giới hạn bàn giao

Đợt 08–10/10 phần lớn dùng demo/project và image cũ. Sau khi chuyển sang một Compose/env mới, monitoring secret cũ đã xóa; cần provision lại và chạy acceptance của deployment mới. Không nâng kết quả lịch sử thành claim rằng Prometheus/Grafana, Admin alerts hoặc live Medusa/Qwen đang hoạt động trên máy nhận.

Nguồn gốc trong Git history: `docs/ADMIN_EVENT_FEED_2026-10-08.md`, `ADMIN_PROCESSING_2026-10-08.md`, `ADMIN_KAFKA_LAG_2026-10-08.md`, `ADMIN_KAFKA_MEMBERSHIP_2026-10-09.md`, `ADMIN_WORKER_READINESS_2026-10-09.md`, `ADMIN_MONITORING_METRICS_2026-10-09.md`, `ADMIN_MONITORING_ALERTS_2026-10-10.md`. Hồ sơ này tóm lược, không thay thế source code/test hay Backbone Master.

---

<a id="teammate-monitoring-test"></a>

> Nguồn gốc: `docs/TEAMMATE_MONITORING_TEST_2026-10-10.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Bàn giao test Admin monitoring — 10/10/2026

> **Lưu trữ lịch sử:** overlay monitoring handoff cũ đã bỏ. Profile monitoring hiện nằm trong [`infra/legacy/compose.yaml`](../../infra/legacy/compose.yaml); xem [vận hành](../OPERATIONS.md).

> Điểm bắt đầu chung cho team: [bản bàn giao trong System_Backbone](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/PIPELINE_MONITORING_HANDOFF_2026-10-10.md).
> File này giữ lệnh vận hành theo version code Pipeline; Backbone tổng hợp tiến độ,
> bằng chứng và checklist, không sao chép một bộ lệnh runtime thứ hai.

## Phạm vi bản này

Sau bản bàn giao 05/10: thêm Admin Event Feed/Processing, Kafka lag/membership,
readiness 6 worker, Prometheus/Grafana, khóa metrics riêng + rotation, cảnh báo
trên Admin. Xem [new demo 08/10](DEMO_HANDOFF_HISTORY.md#new-demo) và [hồ sơ Admin/monitoring](#admin-monitoring-evidence); bộ hiện hành dùng [vận hành](../OPERATIONS.md).

**Git pull không cập nhật container.** Ba image mới đã publish và xác minh digest
trên GHCR ngày 10/10/2026, từ source `2fb6b91f73f7abe9036d527cbb78217062e96d1e`,
platform `linux/amd64`. Image cũ `a725fad` chưa có các thay đổi này.
Build thực hiện trên máy phát triển bằng `tools/release-handoff.ps1`, không phải GitHub Actions.

## An toàn trước khi chạy

- Đọc [Codex handoff lịch sử](DEMO_HANDOFF_HISTORY.md#codex-handoff) và quy tắc DEC-125 trong System_Backbone.
- Test sandbox tách khỏi hệ thống live: không copy database/Kafka volume/cursor,
  không bật Source Connector/catalog/Qwen bằng credential của máy gửi.
- Không chia sẻ `.env`, `runtime/monitoring/`, mật khẩu hoặc token trong Git/chat.
- Các helper `new-demo.ps1`/`manage-monitoring-key.mjs` hiện dùng cố định project
  `funnelmetry-demo-new`, file `runtime/demo-new.env`. Chỉ dùng nếu project này
  không thuộc một deployment đang có trên máy nhận. Nếu trùng, dừng và chọn
  project riêng qua Compose; không tự dùng launcher đè lên project cũ.
- Hướng dẫn nhanh dưới đây dùng PowerShell/Docker Desktop Linux containers và
  Node.js 22+. Linux có thể dùng cùng Compose files; script PowerShell cho demo cũ chỉ chạy trên Windows.

## Dựng bản test bằng image đã publish (không cần build)

Từ repo `Streaming_Pipeline` sau `git pull --ff-only`, ghi lại `git rev-parse HEAD`:

```powershell
docker login ghcr.io -u <github-username>
docker pull ghcr.io/3002tad/funnelmetry/handoff-api@sha256:a794500f8cf84f6a2f03c99d2da1864937522b9a5757a79be815bf920face72d
docker pull ghcr.io/3002tad/funnelmetry/handoff-web@sha256:b5a0f6feb77e2823013a5fc3f35b3f71deb651eaedfc8f4f697294760f5671dc
docker pull ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650
```

Thay `<github-username>` bằng tài khoản người nhận. Nếu package private, tài khoản
phải được cấp quyền đọc package, token có `read:packages`; nhập token tại prompt
Password, không dán token vào câu lệnh hoặc Git. Quyền pull trên máy nhận chưa được
kiểm chứng bởi lần publish này. Vẫn cần checkout source để lấy Compose, migration và helper.

Tạo **file local mới**, không ghi đè file đang dùng: dựa trên `runtime/handoff.env.example`
tạo `runtime/demo-new.env`, điền mật khẩu DB, JWT secret và mật khẩu Admin ngẫu nhiên
riêng (Admin tối thiểu 12 ký tự). Cấu hình:

```dotenv
HANDOFF_PROJECT=funnelmetry-demo-new
HANDOFF_UI_PORT=5180
HANDOFF_API_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-api@sha256:a794500f8cf84f6a2f03c99d2da1864937522b9a5757a79be815bf920face72d
HANDOFF_WEB_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-web@sha256:b5a0f6feb77e2823013a5fc3f35b3f71deb651eaedfc8f4f697294760f5671dc
HANDOFF_WORKERS_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650
```

Pull `postgres:15-alpine` và `apache/kafka:3.9.1` nếu chưa có. Chưa tạo
`runtime/monitoring.env` ở bước này. Chạy `runtime/new-demo.ps1 -Action start` để khởi tạo sandbox
trống và mở UI. Nếu bootstrap báo schema mismatch, **không reset/down -v**:
đối chiếu hướng dẫn handoff trước khi tiếp tục.

Migration monitoring là bước bổ sung, không nằm trong digest bootstrap:

```powershell
Get-Content infra/postgres/011_monitoring_credentials.sql -Raw | docker exec -i funnelmetry-demo-new-postgres-1 psql -U funnelmetry -d funnelmetry_handoff -v ON_ERROR_STOP=1
```

Chỉ tiếp tục nếu exit code 0. Sau đó:

```powershell
node runtime/prepare-monitoring.mjs
```

Script tạo khóa metrics riêng, mật khẩu Grafana và dashboard trong thư mục ignored;
không in secrets, không ghi đè lần provisioning trước. Tạo `runtime/monitoring.env`
từ `runtime/monitoring.env.example` (không ghi đè env có sẵn), pull đúng hai image
đã pin trong file đó, rồi chạy lại `runtime/new-demo.ps1 -Action start`.

## Checklist người nhận

- Pipeline: `http://localhost:5180`, đăng nhập Admin theo env của máy nhận.
- `/admin/event-feed`: UNKNOWN khi chưa bật Connector là đúng, không phải lỗi mất event.
- `/admin/processing`: worker/Kafka/cảnh báo hiện được; demo trống có thể chưa có
  committed offsets, không ép lag UNKNOWN thành 0.
- Grafana: `http://localhost:5182`, user `monitoring-admin`, password trong
  `runtime/monitoring/grafana-password`. Dashboard thư mục Pipeline, 8 panel.
- `node runtime/check-monitoring.mjs`: UP=1, sáu worker observations.
- `node runtime/check-monitoring-alerts.mjs recovered`: worker quan sát được,
  API không cho anonymous truy cập.
- `node runtime/smoke-monitoring.mjs`: tạo/thu hồi một khóa test; khóa không đọc
  được API Admin khác. Test để lại audit/khóa revoked, không tạo event nghiệp vụ.
- `node runtime/manage-monitoring-key.mjs rotate`: khóa mới dùng được và scrape
  mới thành công trước khi thu hồi khóa cũ. Không xóa pending journal nếu bị lỗi.
- `runtime/new-demo.ps1 -Action stop`: dừng và giữ volumes. Chạy lại phải giữ tài khoản/khóa/metrics.

Cảnh báo chỉ cập nhật khi mở trang Admin; chưa có email/Alertmanager/tự restart/scale.
Khóa demo mặc định 7 ngày, cần rotate chủ động. Không coi checklist này là kiểm chứng
Medusa live, AI, đầy đủ event hoặc hiệu năng/catch-up dưới tải.

Gửi lại: commit đã test, OS/Docker version, bước nào PASS/FAIL, mã HTTP/thông báo đã
che secrets và ảnh UI nếu cần. Không gửi toàn bộ env/log chưa kiểm tra.

## Bằng chứng trên máy phát triển

API 169 PASS / 4 optional SKIP, UI build PASS; runtime Grafana 8 panel, UP=1,
6 worker observations; thử stop/start canonical-normalizer cho UNKNOWN rồi tự hết;
rotation thật PASS. Các kết quả này chưa thay cho acceptance trên máy người nhận.

Release image `2fb6b91`: isolated acceptance PASS trước publish, gồm clean bootstrap,
UI assets/proxy/login/RBAC, Raw Kafka → canonical → Journey → Funnel → KPI,
gross order value fixture 20 EUR, stop/start và resume giữ state fixture.
Project test `funnelmetry-handoff-test-5bd74ab8e46f` dùng volumes riêng và được dọn
sau test; không reset demo đang có. Release harness không test overlay monitoring
hoặc Medusa/Qwen thật; bằng chứng monitoring phía trên là lần kiểm tra riêng.
Cả ba digest đã được đối chiếu qua `docker buildx imagetools inspect` trên GHCR.
Commit tài liệu có thể mới hơn source image; không có nghĩa image chứa code sau `2fb6b91`.
