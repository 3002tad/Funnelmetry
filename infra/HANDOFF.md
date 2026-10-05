# Bàn giao phát triển bằng Docker images

**Cập nhật 04/10/2026:** ba image đã chuyển vào GHCR `3002tad/funnelmetry`.
Xem [CODEX_HANDOFF](../CODEX_HANDOFF.md) để lấy digest, cấu hình live/AI và checklist
máy nhận. Các ghi chú “chưa publish” bên dưới là provenance của lượt triển khai cũ.

Phạm vi hiện có: **OFFLINE_DEMO / database mới, trống** theo DEC-125 và Master §24.2.1.
Đây là bộ khung chạy UI/API độc lập, **chưa phải bản sao đầy đủ của demo đang chạy**.
Không cần Node/npm trên máy chỉ xem UI. Người sửa code vẫn clone Git.

Bổ sung ngày 04/10: [bộ worker/Kafka và quy trình phát hành](HANDOFF_PIPELINE.md)
đã có overlay và acceptance riêng. Bảng dưới mô tả **base UI/API**, không bao gồm
overlay pipeline; xem tài liệu bổ sung để bật downstream hoặc review live opt-in.

## Capability manifest

| Thành phần | Đóng gói | Giới hạn |
|---|---|---|
| Dashboard UI | Static build + proxy API cùng origin | Cổng mặc định localhost:5181; không public |
| Dashboard API | Code, dependency lock, analytics, mapping artifact | Không gắn workspace/node_modules của máy cũ |
| PostgreSQL | Volume riêng theo Compose project | DB mới, không có event/đơn hàng cũ |
| Bootstrap | Core V2 + accounts/preferences + analytical SQL | Chỉ clean install; không nâng cấp DB đã restore |
| Tài khoản | API bootstrap Admin khi store trống | Tạo Analyst qua quản lý tài khoản, không reset mật khẩu khi resume |
| AI/tools | Có code/metadata nhưng flags tắt, chưa install releases | Không gọi Alibaba; chưa có Python/Polars trong image |
| Ingestion/workers | Chưa đưa vào profile này | Không nhận live event; không Kafka/cursor và không tác động máy cũ |
| GHCR / snapshot | Chưa publish / chưa export dữ liệu | Không coi Docker image là backup PostgreSQL |

## Chuẩn bị bản image (máy người đóng gói)

Từ repository root, build thử bằng Docker Linux containers:

```powershell
docker build -f apps/dashboard-api/Dockerfile.analytics -t funnelmetry/handoff-api:local .
docker build -f apps/dashboard-web/Dockerfile -t funnelmetry/handoff-web:local .
docker run --rm --network none --read-only --cap-drop ALL funnelmetry/handoff-api:local node /workspace/tools/analytics-image-smoke.mjs
```

Không truyền key qua build args. `.dockerignore` loại runtime/env/log/backup.
Các tag `local` chỉ dành cho thử nghiệm, không phải release nhận dạng bằng commit.
Trước khi publish: commit code, build lại đúng commit, ghi Git SHA, image ID/digest,
CPU architecture và Docker/Compose version vào manifest bàn giao. Base images hiện
dùng tag; digest của image thành phẩm phải được ghi lại sau build/push.

Đích dự kiến là GHCR (`ghcr.io/<owner>/funnelmetry-handoff-api` và
`ghcr.io/<owner>/funnelmetry-handoff-web`). **Chưa có image được publish bởi thay đổi này.**
Khi đã publish và cấp quyền đọc package, thay hai biến image trong env bằng
`ghcr.io/...@sha256:...`; máy nhận chỉ cần `docker compose ... pull` rồi `up` bên dưới.
Không gửi PAT/password registry trong Git hoặc env template.

## Chạy bộ khung trên máy nhận

1. Clone repository đúng commit đã bàn giao.
2. Copy `runtime/handoff.env.example` thành `runtime/handoff.env` (file thật ignored).
3. Điền password DB riêng, JWT secret ngẫu nhiên riêng, email/password Admin
   (password ít nhất 12 ký tự); chọn project/port không trùng môi trường có sẵn.
   Không sao chép `source-connector.env`, `qwen.env` hoặc toàn bộ thư mục runtime.
4. Hai images phải tồn tại local (build thử) hoặc có digest registry được cấp quyền.

Chạy từ repository root, mỗi lệnh là một dòng, dùng được trên PowerShell hoặc shell:

```text
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml config --quiet
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml pull
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml up -d
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml ps -a
```

Bỏ lệnh `pull` khi thử bằng local images. Mở `http://localhost:5181`, đăng nhập bằng
Admin trong env. Tạo Analyst nếu muốn xem vùng analytics; dữ liệu trống là đúng
phạm vi, không phải dữ liệu của máy nguồn bị mất. Không dùng kết quả trống làm
bằng chứng ingestion hoạt động.

Bootstrap kiểm tra DB/host/mode, khóa đồng thời bằng advisory lock và từ chối DB
đã có bảng nhưng không thuộc bootstrap này. Mỗi migration lỗi sẽ dừng; trạng thái
INSTALLING hoặc checksum khác cần operator review, không tự xóa/reseed để sửa.
READY chỉ là marker cài schema, không chứng minh schema chưa bị sửa thủ công,
live ingestion, analytics chất lượng hay toàn bộ Master hoàn thành.

Stop / mở lại giữ dữ liệu:

```text
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml stop
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml up -d
```

Không dùng `down -v`. Không trỏ project vào `funnelmetry-private`. Không mount Docker socket.
PostgreSQL/API không publish host port; UI chỉ bind loopback. Database dùng tài khoản
demo có quyền tạo schema, chưa là least-privilege production deployment.

## Bạn tiếp tục code trong một tuần

- Tạo branch riêng từ commit bàn giao; sửa source/test, commit và push như bình thường.
- Đổi UI/API thì build lại image tương ứng; recreate bằng Compose. Image không thay source Git.
- Đổi schema cần migration plan riêng; bootstrap này không tự nâng cấp volume cũ.
- Bàn giao lại bằng commit + log thay đổi/test + các migration cần chạy.
- Không merge DB của hai máy; không gửi Kafka volume. Nếu cần dữ liệu demo hiện tại,
  làm logical snapshot và restore rehearsal riêng trước khi thêm profile snapshot.

## Kiểm chứng và việc còn lại — 03/10/2026

Chạy acceptance tự động từ repository root khi Docker Linux engine đã bật:

```powershell
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1
# Dùng lại hai image local đã build (không kiểm chứng source mới nếu image cũ):
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -SkipBuild
```

Script tự tạo project `funnelmetry-handoff-test-<random>`, port ngẫu nhiên,
credential test chỉ trong process và database trống; không đọc env thật. Nó build
hai image, chạy offline import smoke, clean bootstrap, UI deep link/static asset,
login qua nginx, Admin tạo Analyst, kiểm tra RBAC và logout-all. Sau stop/start,
kiểm tra tài khoản còn tồn tại và không seed trùng. Không gửi event hay gọi model.

Cuối lượt chỉ xóa volume test khi tên và Compose ownership label khớp project vừa
tạo; không prune Docker, không đụng `funnelmetry-private`. Dữ liệu test bị xóa không
cần phục hồi; images giữ lại để thử/publish sau. Nếu kiểm chứng ownership thất bại,
volume được giữ lại và script cảnh báo. Không chạy script này thay launcher demo.

Probe dùng HTTP và PostgreSQL thật trong container, **không phải browser automation**;
không chứng nhận mọi thao tác React hoặc full data pipeline. Exit thành công là
acceptance trong phạm vi OFFLINE_DEMO trống ở bảng trên.

- 6 unit tests đã pass: guard target, DB lạ, resume không ghi, checksum mismatch,
  partial install, fail SQL không đánh READY. Không thay thế test PostgreSQL thật.
- Compose `config --quiet`, `git diff --check` và UI `npm run build` trên host đã pass.
- Docker đã bật ở lượt kiểm thử tiếp theo: build UI/API, offline import smoke và
  clean-install container acceptance đã PASS; login qua nginx, RBAC, mapping artifact,
  session revocation và stop/start giữ tài khoản đều PASS. Không phải browser E2E.
- Project test `funnelmetry-handoff-test-5772f4f25a29` đã được dọn cả volume test;
  không sửa dữ liệu demo hiện tại. Docker Engine 29.8.1, Compose 5.5.1, linux/amd64.
- Image API local: `sha256:1b4ad17b61b4ab4891b72d2ddcf60051096e07eae23770d663215570ed14d481`.
- Image UI local: `sha256:3bfdd68448ec4707632653e78ffbd78894481e3af771311bea9cd7b3ab4c5793`.
- Đây là build từ worktree có thay đổi chưa commit; ID local không phải registry
  publication hoặc release có provenance hoàn chỉnh. Chưa publish GHCR.
- API npm audit trong build báo 0; UI npm audit báo 5 high. Chưa triage mức ảnh hưởng
  tới bundle/runtime hay cập nhật dependency; cần review trước khi phát hành.
- Script có fallback tìm Docker CLI ở cả thư mục cài per-user và Program Files;
  không thay PATH hệ thống. Kiểm tra cú pháp Node/PowerShell đã PASS.
- Để bàn giao **đủ pipeline live**: thêm images/profile workers + Source Connector,
  credential riêng và explicit replay boundary; nghiệm thu theo DEC-125. Không bật
  connector trên DB snapshot chỉ bằng cách giữ cursor cũ với Kafka mới.
- Catalog sync, Qwen, tool releases/Polars và dữ liệu snapshot cần activation riêng.

## Hardening tiếp theo — 04/10/2026

- UI runtime đổi sang user `nginx`, root filesystem read-only, bỏ toàn bộ Linux
  capabilities, `no-new-privileges`; chỉ `/tmp` là tmpfs 32 MiB, noexec/nosuid.
  Nginx dùng config riêng để PID/temp files không cần ghi `/run` hoặc `/var/cache`.
- Bổ sung runtime probe: UID không phải root, không có Node/build node_modules hoặc
  thư mục runtime riêng, không ghi được vào static web root. Probe chạy trước HTTP acceptance.
- Phân tích audit: 5 high là cùng chuỗi `tailwindcss -> chokidar/fast-glob/micromatch
  -> braces@3.0.3`, không phải 5 lỗi độc lập. Advisory
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  chưa có patched version ở thời điểm kiểm tra; không force-upgrade Tailwind 4.
- `npm audit --omit=dev --json` ngày 04/10 báo **0**. Đây chỉ là dependency audit
  production, không phải container CVE scan hay chứng nhận toàn ứng dụng an toàn.
  Build dependencies vẫn có rủi ro; chỉ build từ source/config tin cậy, không đưa
  glob pattern không tin cậy vào Tailwind. Image cuối chỉ COPY static dist từ builder.
- 6 bootstrap unit tests, PowerShell parser và `git diff --check` PASS. Docker engine
  đang tắt khi thử chạy harness ngày 04/10: **chưa build/test hardening mới**; các image
  ID và acceptance ngày 03/10 phía trên chỉ chứng minh bản trước hardening này.
  Không tạo hoặc xóa container/data trong lượt thử thất bại này. Chưa publish GHCR.

### Nghiệm thu sau khi Docker bật — 04/10/2026

- Build hai image mới thành công; runtime probe xác nhận UI không chạy root,
  không có Node/build node_modules và ghi static root bị chặn bởi read-only filesystem.
- Project `funnelmetry-handoff-test-abfc256d5069`: initial và resume acceptance PASS
  (schema, SPA/assets, nginx proxy, login, RBAC, mapping, logout, account persistence).
- API image local: `sha256:0b663cc888b83a2a7cf0959cdf64631469a286c4679979ec81f98044a6f375e6`, user `node`.
- UI image local: `sha256:282650ad39162138591cb497bf439438617e623e62d01e58ed278e94a0a7572e`, user `nginx`.
- Sửa launcher để tìm credential helper bằng PATH tạm trong process, restore PATH
  khi kết thúc; không sửa Docker login/system PATH. Shell probe truyền qua stdin
  để tránh lỗi quoting PowerShell -> Linux.
- Đây là nghiệm thu OFFLINE_DEMO trống, không phải live worker/AI/production security.
  Cảnh báo build dependency vẫn còn, chưa publish registry và chưa chuyển dữ liệu demo.

Nguồn quy tắc: `System_Backbone/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md`
trong workspace; đây không phải authoritative migration/cutover.
