# Codex handoff — Pipeline development, 04/10/2026

> **Cập nhật release 10/10/2026:** image mới từ `2fb6b91` đã publish lên GHCR.
> Dùng [runbook monitoring mới](docs/TEAMMATE_MONITORING_TEST_2026-10-10.md) để lấy
> ba digest và bước migration/khởi chạy; máy nhận không cần build image.
> Các digest `a725fad` bên dưới là release lịch sử 04/10, không chứa monitoring mới.
> Release mới được test sandbox độc lập, không chứng nhận Medusa/Qwen live trên máy nhận.

## 1. Read this first

Mục tiêu: người nhận tải Docker images, chạy Pipeline độc lập với Medusa + Qwen
được cấp quyền, tiếp tục phát triển một tuần rồi bàn giao lại Git changes.
Đây là **sandbox phát triển**, không phải chuyển authoritative state hay backup máy cũ.
Không coi việc publish images là đã nghiệm thu live trên máy nhận.

Đọc theo thứ tự trước khi sửa/chạy:

1. [AGENTS.md](AGENTS.md), [System_Cookbook/AGENTS.md](../System_Cookbook/AGENTS.md)
   và [System_Cookbook/codex/INDEX.md](../System_Cookbook/codex/INDEX.md).
2. `../System_Backbone/docs/governance/DINH_HUONG_DE_TAI.md` (DEC-125),
   `../System_Backbone/MASTER_SPECIFICATION.md` (§24.2.1).
3. `../System_Backbone/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md`.
4. [Runtime](runtime/README.md), [base handoff](infra/HANDOFF.md),
   [pipeline handoff](infra/HANDOFF_PIPELINE.md).
5. [Source Connector](workers/source-connector/README.md),
   [catalog sync](workers/catalog-sync/README.md),
   [AI](apps/dashboard-api/src/lib/ai/README.md), [analytics](analytics/README.md).

Nếu thiếu hai repository tài liệu, lấy bản team cấp từ
`https://github.com/3002tad/System_Backbone` và
`https://github.com/3002tad/System_Cookbook`; ghi commit tài liệu thực tế đã đọc.
Tài liệu này không override các quyết định mới hơn của Backbone.

## 2. Release đã publish

- Code: `https://github.com/3002tad/Funnelmetry.git`.
- Commit image: `a725fad1baabfa5c3885e82c0d996c08af895d21`.
- Platform: **linux/amd64**, dùng Docker Linux containers.
- Registry owner: **3002tad**, cùng owner với repository; ba container package
  `funnelmetry/handoff-api`, `funnelmetry/handoff-web`, `funnelmetry/handoff-workers`
  hiện nằm trong GitHub Packages của owner này.
- Cả ba image đã push ngày 04/10/2026. Đã xác minh bằng quyền đọc package trên
  môi trường hiện tại rằng cả ba digest bên dưới tồn tại dưới owner `3002tad`;
  login/pull bằng tài khoản máy nhận vẫn phải kiểm tra trên máy nhận.
- Môi trường hiện tại có secret `FUNNELMETRY_PACKAGE_READ_TOKEN` để đọc package;
  không ghi giá trị vào Git/log và không mặc định secret này có trên máy nhận.

Các giá trị để dán vào `runtime/handoff.env`:

```dotenv
HANDOFF_API_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-api@sha256:07e843527a098f5de56b33b67fc864ade68e510e23c151b29984a0d5b48ca951
HANDOFF_WEB_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-web@sha256:3cb0950bbe49a4ddd8473ba60ade8279f8713b97c6922d17976a1e4a958f25d2
HANDOFF_WORKERS_IMAGE=ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:2284b0940f31602d9e0472adcf5b7feafd60bd3454a42b8c138cd19c446f5cdf
```

Image có code/dependencies; KHÔNG có database cũ, `.env` thật hoặc API keys.
Giữ file hướng dẫn này khi checkout commit image (file được viết sau commit đó).
Branch phát triển nên bắt đầu từ commit tài liệu bàn giao đã nhận, ghi lại base SHA;
không khẳng định image đã chứa các sửa đổi source sau `a725fad`.

## 3. Evidence và giới hạn

| Capability | Evidence trên máy đóng gói | Máy nhận |
|---|---|---|
| Image API/UI/workers | Publish + remote digest verified | Cần pull |
| Clean bootstrap, UI assets/proxy, login, RBAC, logout | PASS initial/resume | Cần kiểm tra |
| Raw Kafka → canonical → Journey → Funnel → KPI | PASS 4 synthetic events; 1 converted Journey | Chưa kiểm tra live |
| Order summary API | PASS, 20 EUR gross order value, PROVISIONAL + evidence | Cần kiểm tra dữ liệu riêng |
| Restart | PASS giữ tài khoản/projections của fixture | Cần kiểm tra cursor live |
| HTTPS feed / catalog / Qwen | Có code và opt-in overlays; chưa test external trong release | UNVERIFIED |
| Restore/cutover từ DB cũ | Không nằm trong acceptance này | Không tự thực hiện |

Lượt acceptance: `funnelmetry-handoff-test-81e08b3db02f`, dùng image đúng commit
và các cờ `-WithPipeline -WithAnalytics`. DB/Kafka test đã xóa; không phải dataset
để người nhận sử dụng. Test không chứng minh mọi màn hình React, mọi ranking query,
provider AI hoặc completeness của live feed.

API image chưa có Python/Polars; không bật Polars bằng flag để giả định đã hỗ trợ.
Maturity scheduler có code trong workers image nhưng chưa được service overlay bật.
Watchdog/autoscaler/reconciliation controllers không thuộc bộ Compose bàn giao này.
5 high warnings build dependency Tailwind/braces đã ghi ở HANDOFF.md; chưa xử lý
toàn bộ dependency risk, không claim production-ready hay toàn bộ Master hoàn tất.

## 4. Preflight máy nhận

- Kiểm tra Docker context đúng máy, Linux engine, tài nguyên và cổng 5181 còn trống.
- Chọn project riêng, DB/Kafka/cursor riêng, không dùng volume/external DB máy cũ.
- Đăng nhập `docker login ghcr.io -u YOUR_GITHUB_USERNAME`, nhập PAT ở prompt.
  Token classic có `read:packages` và tài khoản có Read trên cả ba package.
  Trên môi trường hiện tại có thể dùng secret `FUNNELMETRY_PACKAGE_READ_TOKEN`
  đã được cấp; máy nhận cần secret/quyền đọc của chính mình, không sao chép PAT qua Git.
- Không in env thật, `docker inspect` toàn bộ hoặc `compose config` đầy đủ ra chat.
  Dùng `config --quiet`; log có thể nhạy cảm, cần lọc trước khi chia sẻ.
- Lập record environment: owner, host, mode, environment/state lineage ID,
  source_id, expected feed ID, boundary/coverage, project, code/image/schema versions,
  Docker/Compose versions, secret references (không secret values), kết quả tests.
- Dữ liệu lịch sử muốn mang theo phải có quy trình snapshot/checkpoint/rehearsal
  riêng. Không copy Kafka volume, không restore DB cursor cũ rồi chạy NORMAL trên Kafka mới.

## 5. Cấu hình riêng — không commit secrets

Copy từng `.env.example` thành `.env` cùng tên nếu chưa tồn tại; KHÔNG ghi đè
file người nhận đã điền. Kiểm tra `git check-ignore runtime/handoff*.env` trước khi lưu key.

| File local | Biến cần điền |
|---|---|
| `runtime/handoff.env` | 3 image digests ở trên; HANDOFF_PROJECT riêng; HANDOFF_UI_PORT=5181; HANDOFF_DB_PASSWORD; HANDOFF_JWT_SECRET ngẫu nhiên; HANDOFF_ADMIN_EMAIL; HANDOFF_ADMIN_PASSWORD (ít nhất 12 ký tự) |
| `runtime/handoff-live.env` | HANDOFF_CONNECTOR_ID riêng; HANDOFF_FEED_URL (HTTPS Event Feed, không URL storefront); HANDOFF_FEED_TOKEN read; HANDOFF_FEED_ID đúng lineage; HANDOFF_INITIAL_AFTER_SEQ explicit; HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE sau review |
| `runtime/handoff-catalog.env` | HANDOFF_CATALOG_URL (Medusa origin); HANDOFF_CATALOG_KEY (Medusa Admin catalog credential được cấp) |
| `runtime/handoff-ai.env` | HANDOFF_ENABLE_QWEN=true sau duyệt budget; HANDOFF_DASHSCOPE_API_KEY; giữ Singapore HANDOFF_DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1 |

Không dùng backend HMAC/browser key thay feed/catalog key. Không tự copy tất cả
runtime của máy gửi. Source owner cung cấp URL/read access/lineage/retention và
boundary phù hợp; không đoán `after_seq=0`. Key Qwen server-side, không `VITE_*`.

## 6. Khởi chạy Medusa + catalog + Qwen

Chỉ áp dụng cho **fresh independent PARALLEL_LIVE** đã duyệt quyền/budget/coverage.
Nếu chỉ xem offline, bỏ live/catalog/AI env và live/catalog overlays; Qwen mặc định tắt.
Không inject fixture vào môi trường định dùng live. Không cần Tailscale theo baseline.

Chạy PowerShell tại repository root (clone có thể tên Funnelmetry, không nhất thiết Streaming_Pipeline):

```powershell
$handoffArgs = @(
  '--env-file', 'runtime/handoff.env',
  '--env-file', 'runtime/handoff-live.env',
  '--env-file', 'runtime/handoff-catalog.env',
  '--env-file', 'runtime/handoff-ai.env',
  '-f', 'infra/compose.handoff.yml',
  '-f', 'infra/compose.handoff-pipeline.yml',
  '-f', 'infra/compose.handoff-analytics.yml',
  '-f', 'infra/compose.handoff-live.yml',
  '-f', 'infra/compose.handoff-catalog.yml'
)
docker compose @handoffArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Fix configuration before continuing' }
docker compose @handoffArgs pull
if ($LASTEXITCODE -ne 0) { throw 'Resolve image access before continuing' }
# Chỉ tiếp tục sau khi preflight fresh-live/isolation/coverage đã được operator xác nhận.
docker compose @handoffArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'Startup failed; inspect services without resetting data' }
docker compose @handoffArgs ps -a
```

Mở `http://localhost:5181` (hoặc cổng đã chọn). Admin bootstrap dùng env trên DB trống;
tạo Data Analyst qua quản lý tài khoản để test analytics/chat. Không cấp analytics
cho Admin chỉ để né RBAC. Không dùng launcher `start-private-demo.cmd` của máy cũ
cho environment mới: launcher đó resume deployment khác.

Dừng/ngày sau chạy lại bằng **cùng** `$handoffArgs` (khai báo lại khi mở terminal mới):

```powershell
docker compose @handoffArgs stop
docker compose @handoffArgs up -d
```

Không `down -v`, không prune/reset cursor/seed lại. Thay env cần `up -d` để Compose
áp dụng config/recreate, không chỉ `restart`. Bootstrap checksum mismatch cần review
migration, không xóa DB để vượt guard. Job bootstrap/profile/release exit 0 là bình thường.

## 7. Acceptance trên máy nhận — phải lưu kết quả thật

1. Pull được cả ba digest; API/UI đúng origin; Admin và Analyst đúng quyền.
2. Feed HTTPS/TLS/auth đúng, expected lineage khớp; record coverage/retention boundary.
   Source Connector `/healthz` là liveness, `/readyz` và processing evidence kiểm riêng.
3. Đối chiếu bounded event IDs do source owner cung cấp: feed → Raw Kafka →
   canonical/outcome → Journey/Funnel/KPI. Không dùng mỗi count tổng hay HTTP 200.
4. `medusa.order_placed` → `order.placed`; giữ event identity và thời gian nguồn.
   Giá trị đơn đã đặt là gross order value, KHÔNG paid revenue; không cộng nhiều currency.
5. Catalog: kiểm tra product/variant ID có tên; tên catalog hiện tại không phải snapshot
   tên/giá lịch sử của đơn. Không sửa giá order theo catalog.
6. Analyst gọi một câu hỏi supported, ví dụ tổng giá trị đơn đã đặt trong khoảng có dữ liệu.
   Xác minh provider thực sự được gọi và tool/evidence đúng; câu trả lời template không
   chứng minh Qwen chạy. Không dùng lời LLM làm nguồn số liệu hoặc bỏ quality warnings.
7. Stop/resume B: cursor/state giữ đúng, không duplicate effects; A không bị tác động.
8. Ghi PASS/FAIL/UNVERIFIED, thời điểm/timezone, input IDs/boundary và log đã redact.
   Không có quyền/credential thì dừng capability tương ứng, không tự tạo order/test source.

## 8. Việc Codex bên nhận cần làm tiếp

Ưu tiên hoàn thành §4–7 trước, không viết lại kết nối đang có. Chưa thể đánh dấu
live handoff hoàn tất khi chỉ máy đóng gói đã chạy synthetic acceptance.

- Ghi capability thực tế cần dùng và những module ngoài image/overlays hiện tại.
- Nếu cần Polars/maturity/controllers: review Backbone, dependencies và acceptance
  riêng trước khi thêm service. Không tuyên bố đủ chỉ vì worker code có trong image.
- Đối chiếu chức năng Admin/DA và AI tools với Master/current code; lập backlog có
  file/test evidence, không dựa vào lời hứa hoặc lịch sử chat để đánh completed.
- Source contract do Medusa owner quản lý; nếu cần thay source ghi
  `CONTRACT_CHANGE_REQUIRED`, không tự sửa Medusa.
- Migration lịch sử/authoritative cutover chưa được chứng nhận bởi release này.

Khi sửa code: branch riêng, giữ dirty changes của người dùng, test đúng phạm vi;
build lại image thành tag mới, sửa HANDOFF_*_IMAGE local rồi recreate. Không ghi đè
digest/tag release đã bàn giao, không mong sửa host source tự xuất hiện trong image.
Chạy regression nội bộ độc lập khi cần:

```powershell
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -WithPipeline -WithAnalytics
```

Harness tạo/xóa DB/Kafka test riêng; không dùng làm launcher live hay để giữ dataset.
Sau một tuần bàn giao Git branch/commits, log thay đổi, migrations/rollback plan,
test evidence, image digests mới nếu có, env VARIABLE NAMES mới và phần chưa xong.
Không gửi PAT/API keys trong Git; không merge DB hai máy hoặc chuyển Kafka volumes.

## 9. Prompt khởi đầu cho Codex bên nhận

> Đọc CODEX_HANDOFF.md, AGENTS.md và Backbone/Cookbook trước. Kiểm tra worktree,
> Docker context và cấu hình chỉ theo tên biến, không in secret. Mục tiêu là fresh
> independent PARALLEL_LIVE kết nối Medusa Event Feed, catalog và Qwen Singapore.
> Báo thiếu credential/lineage/coverage trước khi bật connector. Thực hiện preflight
> và acceptance §4–7; ghi kết quả thực tế, sau đó tiếp tục backlog §8. Không sửa source
> Medusa, reset dữ liệu, chuyển authoritative state hay publish code nếu chưa được phép.
