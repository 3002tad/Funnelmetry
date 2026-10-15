# Demo và handoff — hồ sơ triển khai cũ

> Các launcher, Compose overlay, image digest và private ingress bên dưới là lịch sử theo từng lần bàn giao. Đường chạy hiện hành là docs/SWARM_MIGRATION.md; launcher Compose cũ đã bị gỡ.

Đường dẫn `Nguồn gốc` bên dưới là vị trí trước khi gộp; các file riêng đã được loại bỏ. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

## Mục lục theo tài liệu nguồn

- [Private ingress](#private-ingress) — `docs/archive/infra/PRIVATE_INGRESS.md`
- [Private demo](#private-demo) — `docs/archive/START_PRIVATE_DEMO.md`
- [Docker image handoff](#docker-handoff) — `docs/archive/infra/HANDOFF.md`
- [Worker handoff](#worker-handoff) — `docs/archive/infra/HANDOFF_PIPELINE.md`
- [Codex handoff](#codex-handoff) — `docs/archive/CODEX_HANDOFF.md`
- [New demo 08/10](#new-demo) — `docs/archive/NEW_DEMO_2026-10-08.md`
- [Demo config 11/10](#demo-config) — `docs/archive/DEMO_CONFIG_2026-10-11.md`
- [Teammate fresh demo](#teammate-demo) — `docs/TEAMMATE_FRESH_DEMO.md`

---

<a id="private-ingress"></a>

> Nguồn gốc: `docs/archive/infra/PRIVATE_INGRESS.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Superseded private Pipeline ingress — historical only

> Superseded by the Source Ingress + authenticated Event Feed pull topology.
> Do not deploy this overlay as the Funnelmetry baseline. It is retained only
> to explain the prior Relay → Pipeline Gateway experiment.

Implements Master remote `6e444f9` §4.11.1.1. This is an opt-in Compose overlay,
not proof that Tailnet, Medusa binding or end-to-end delivery is working.
Requires Docker Linux containers, `/dev/net/tun`, Compose supporting `!reset`,
and permission to enroll a Tailscale node. No host-network or privileged container.

## Bootstrap

1. Enable MagicDNS and HTTPS certificates in your Tailnet. Set ACL/grants so only
   the intended Medusa host can access this node on TCP 443; remove broad allow-all
   grants that would defeat that restriction. This repository does not change ACLs.
2. Copy `runtime/private-ingress.env.example` to ignored `runtime/private-ingress.env`.
   Set TS_AUTHKEY locally, not in chat/Git. Keep the backend registry `{}`.
3. From the repository root, validate without printing credentials:

```powershell
docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress --env-file runtime/private-ingress.env config --quiet
```

After checking Docker/Tailnet prerequisites, bootstrap only the Gateway and dependencies:

```powershell
docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress --env-file runtime/private-ingress.env up -d --build input-gateway
```

The separate project name avoids reconfiguring an existing E2E/demo stack and uses
separate Kafka/Postgres/state volumes. Workers beyond Gateway dependencies are not
started by this bootstrap command. This still uses local single-node infrastructure,
not a hardened production deployment. Do not mix the base E2E runner or
compose.medusa.yml into these commands. Never use `down -v` to restart this stack.

Gateway shares the sidecar namespace and listens only on 127.0.0.1:31000.
Neither Gateway nor Postgres publishes host ports. Serve proxies Tailnet HTTPS;
Funnel is explicitly false. Tailscale state is persistent; do not delete it on restart.
Docker administrators can inspect environment secrets. Rotate bootstrap keys under
your Tailnet policy; TS_AUTH_ONCE avoids re-enrolling an already-authenticated state.

From the Ubuntu/Medusa host, verify the node's actual MagicDNS name:

```bash
curl --fail --max-time 15 https://funnelmetry-pipeline.YOUR-TAILNET.ts.net/health
```

Use the actual assigned DNS name (hostname collisions can change it). Also check that
the LAN host address on port 31000 is inaccessible and unauthorized Tailnet nodes cannot
reach 443. Never use `curl -k`, disable ACLs, or expose port 31000 to work around failure.
Health is not a signed event test or proof of downstream workers being ready.

## After private health passes

The private Gateway has two distinct machine-to-machine producer paths. A browser
never calls this endpoint directly:

- **Edge Relay -> Gateway:** Relay forwards previously durable `browser_sdk`
  events through Tailnet. Keep `INPUT_GATEWAY_CORS_ORIGINS` empty. Before enabling
  Relay upstream, set one source-scoped Relay credential in
  `PRIVATE_GATEWAY_RELAY_BROWSER_KEYS_JSON` in the ignored runtime env and the
  same key ID/source/secret in Relay's `RELAY_UPSTREAM_BROWSER_KEYS_JSON`. This
  credential is separate from the Browser -> Relay write key and from backend HMAC.
- **Medusa backend -> Gateway:** the signed `source_bridge` path below is a
  separate activation and uses the backend HMAC registry.

At bootstrap, `PRIVATE_GATEWAY_RELAY_BROWSER_KEYS_JSON={}` deliberately rejects
Relay forwarding. Do not enable public browser CORS or publish the Gateway port to
work around that gate.

Coordinate one activation with the Medusa owner: install the matching source/key ID
and HMAC secret in PRIVATE_GATEWAY_BACKEND_KEYS_JSON and Medusa backend secret store,
update `ingest.backend_url` to the verified private HTTPS URL, regenerate binding and
rebuild backend. Do not print or commit the registry. Start the remaining V2 workers
with the same Compose project/files before the signed event end-to-end test.

Direct browser input remains disabled on this profile. Edge Relay needs its own
upstream authorization/connectivity acceptance before it forwards; do not send a
browser directly to Tailnet ingress or assume Relay integration is completed.

## Evidence and limitations

### Bootstrap observation — 2026-09-12

The private project has now been started with a locally supplied key. Tailscale
reports Running/online; Gateway loopback `/health` returned 200 with status ready.
Gateway, Postgres and sidecar have no Docker host port bindings. The V2 migrations
completed in the separate private Postgres volume; downstream workers are not yet started.

First bootstrap exposed a readiness race: the Postgres initdb temporary server accepted
Unix socket checks before TCP was open. The private overlay now checks pg_isready over
127.0.0.1 TCP; configuration regression test covers this. Retry completed successfully
without deleting volumes.

The Tailnet owner enabled HTTPS certificates later on 2026-09-12. After restarting
the sidecar, Serve exposed the actual tailnet-only MagicDNS name and a TLS request
with hostname verification returned Gateway `/health` 200/ready. Docker-internal DNS
did not resolve the node's own MagicDNS name, so the local self-check connected to its
Tailnet IPv4 while retaining the MagicDNS hostname/SNI; certificate authorization passed.
This is a local same-node TLS/Serve check, not evidence that the Ubuntu/Medusa host is
allowed by ACL or can resolve/reach it. No Medusa signed-event handoff has passed.
Keep credential registries empty until remote health and denial checks pass.

Configuration validation is possible without real keys or enrollment. Live Tailnet
tests require a locally supplied auth key, ACL setup and access to the Medusa host.
No real keys, network enrollment, runtime migration or event delivery were performed
in the initial configuration-only stage; the later bootstrap observations above supersede
that runtime status. The mutable stable image tag must be pinned after validation.

References: [Tailscale Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params),
[Serve sidecar configuration](https://tailscale.com/blog/docker-tailscale-guide).

---

<a id="private-demo"></a>

> Nguồn gốc: `docs/archive/START_PRIVATE_DEMO.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Khởi động lại demo private trên Laptop 2

> **Lưu trữ lịch sử:** private launcher đã bỏ; không dùng các lệnh trong tài liệu này để khởi chạy bộ mới. Xem [vận hành Swarm](../SWARM_MIGRATION.md).

> Hướng dẫn **resume trên máy đã cấu hình**, không phải chuyển server. Xem [vận hành hiện hành](../SWARM_MIGRATION.md) để chọn đúng cấu hình/capability.

Từ root `Streaming_Pipeline`, chạy `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/start-private-demo.ps1`.
Script bật Docker Desktop nếu cần, PostgreSQL/Kafka,
Source Connector và các worker canonical/telemetry/journey/funnel/KPI, API private có Qwen,
rồi chạy UI ẩn và mở http://localhost:5180.

Chỉ dành cho bộ container private đã được thiết lập trên máy này. Không phải bộ
cài mới: không build/pull image, migrate/seed database, tạo tài khoản, đổi key hoặc
nạp lại cấu hình container. File env vẫn được ignore Git. Không chạy profile
publisher lại vì profile đã có trong database. Không gọi model hoặc gửi event test.

Nếu thiếu container/dependency hoặc trùng cổng, launcher dừng và báo lỗi; các dịch
vụ đã bật được giữ nguyên. API demo cũ phải tắt để nhường cổng 32000. UI do launcher
mở được tái sử dụng khi chạy lại; UI khác đang chiếm 5180 cần đóng trước.
Log UI: `runtime/private-ui.log` và `runtime/private-ui-error.log` (ignored).

Launcher không bật Input Gateway hoặc Tailscale cũ, cũng không tự dừng/xóa chúng
nếu đã chạy từ trước. Source Connector chủ động đọc HTTPS Event Feed bằng cấu hình
đã nạp trong container và tiếp tục cursor đã lưu, không reset cursor về 0.

Kiểm tra PostgreSQL/Kafka/Connector process health, HTTP API/UI và worker đang chạy;
kiểm tra riêng Connector `/readyz`. Nếu Source chưa sẵn sàng, cảnh báo và vẫn mở UI
để xem dữ liệu đã lưu. Không coi container healthy là bằng chứng canonical/KPI đã
xử lý xong; không tự gọi AI, tạo order hoặc gửi event test.

Yêu cầu bộ container pull đã được triển khai theo
[Source Connector activation evidence](INGESTION_RECOVERY_HISTORY.md#source-connector-0920). Nếu thiếu container, dừng rõ ràng,
không fallback sang Gateway cũ hoặc tự tạo database. Sửa `.env` không tự cập nhật
environment của container: cần recreate riêng dịch vụ theo hướng dẫn deployment.
Không dùng launcher sau restore/recreated Kafka khi chưa có quy trình safe replay.

Event mới vẫn cần phía Medusa/Source Ingress online. Tắt Docker không xóa volume;
không dùng `down -v` để dừng demo.

---

<a id="docker-handoff"></a>

> Nguồn gốc: `docs/archive/infra/HANDOFF.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Bàn giao phát triển bằng Docker images

> **Lưu trữ lịch sử:** các Compose handoff nhiều overlay bên dưới đã loại bỏ. Triển khai mới dùng [Docker Swarm](../SWARM_MIGRATION.md); Compose runtime cũ chỉ còn trong Git history.

**Cập nhật 04/10/2026:** ba image đã chuyển vào GHCR `3002tad/funnelmetry`.
Xem [CODEX_HANDOFF](DEMO_HANDOFF_HISTORY.md#codex-handoff) để lấy digest, cấu hình live/AI và checklist
máy nhận. Các ghi chú “chưa publish” bên dưới là provenance của lượt triển khai cũ.

Phạm vi hiện có: **OFFLINE_DEMO / database mới, trống** theo DEC-125 và Master §24.2.1.
Đây là bộ khung chạy UI/API độc lập, **chưa phải bản sao đầy đủ của demo đang chạy**.
Không cần Node/npm trên máy chỉ xem UI. Người sửa code vẫn clone Git.

Bổ sung ngày 04/10: [bộ worker/Kafka và quy trình phát hành](DEMO_HANDOFF_HISTORY.md#worker-handoff)
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
docker build -f infra/docker/dashboard-api.Dockerfile -t funnelmetry/handoff-api:local .
docker build -f infra/docker/dashboard-web.Dockerfile -t funnelmetry/handoff-web:local .
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

---

<a id="worker-handoff"></a>

> Nguồn gốc: `docs/archive/infra/HANDOFF_PIPELINE.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Bàn giao worker pipeline — 04/10/2026

> **Lưu trữ lịch sử:** không chạy lệnh handoff overlay bên dưới. Đường Compose rollback đã bị gỡ; triển khai mới theo [Docker Swarm](../SWARM_MIGRATION.md).

**Release update:** ba image commit `a725fad` đã publish và xác minh digest dưới
GHCR `3002tad/funnelmetry`; xem [CODEX_HANDOFF](DEMO_HANDOFF_HISTORY.md#codex-handoff) cho digest
và hướng dẫn đầy đủ.
Các trạng thái chưa publish bên dưới mô tả các lượt trước phát hành, không phải
trạng thái registry hiện tại. Acceptance live trên máy nhận vẫn chưa được xác nhận.

Đọc [bộ khung handoff](DEMO_HANDOFF_HISTORY.md#docker-handoff) trước. Không dùng env/database/Kafka của demo cũ.
Base + overlay này chạy **sandbox độc lập**, không phải migration authoritative.

## Images và services

- `handoff-api`: API, schema bootstrap, analytics artifacts.
- `handoff-web`: UI static + proxy non-root/read-only.
- `handoff-workers`: dependencies theo lockfile và code 9 worker; chạy mỗi worker
  trong container riêng qua `working_dir`. Không copy host node_modules hay runtime env.
- PostgreSQL và Kafka dùng upstream images. Volume/network riêng theo project;
  DB/Kafka không publish port ra host.
- Overlay pipeline bật normalizer, ledger writer, telemetry writer, Journey, Funnel,
  KPI và profile publisher `medusa-reference` (reference profile hiện hành).
- Source Connector, catalog-sync và maturity scheduler có code trong image nhưng
  **không tự chạy**. Watchdog/autoscaler/reconciliation controllers không thuộc bộ này.
  Qwen/Polars vẫn tắt. Không coi danh sách packaged code là runtime verified.

## Dựng sandbox downstream không gọi source

Nếu dùng image local, build từ repository root:

```text
docker build -f infra/docker/pipeline-workers.Dockerfile -t funnelmetry/handoff-workers:local .
```

Điền `runtime/handoff.env` theo hướng dẫn base; image workers có trong env mẫu.
Khi publish thật, thay cả ba image references bằng digest đã bàn giao.

```text
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml -f infra/compose.handoff-pipeline.yml config --quiet
docker compose --env-file runtime/handoff.env -f infra/compose.handoff.yml -f infra/compose.handoff-pipeline.yml up -d
```

Máy chỉ chạy demo cần Docker, Git và secrets/config riêng, không cần host Node/npm.
Database mới **trống**, không tự chứa dữ liệu đơn hàng cũ. Stop/resume bằng đúng cùng
project/files; không `down -v`, không copy Kafka volume từ máy khác.

## Kiểm thử không đụng live source

```powershell
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -WithPipeline
```

Script build ba image, tạo project ngẫu nhiên và inject 4 synthetic ingress schema
2.0 records vào Raw Kafka bằng `toRawMessage` của Source Connector. Fixture tương
đương `medusa-downstream.test.mjs`: product view, cart, checkout, `medusa.order_placed`.
Không gọi public feed/Medusa/AI, không sửa event contract nguồn.

Đối chiếu: 4 canonical rows, `order.placed` BUSINESS_FACT, 1 Journey, Funnel profile
2.0.0 CONVERTED đạt 4 bước, gross order value 20 EUR (không phải paid revenue).
Sau restart kiểm tra persisted projections/accounts vẫn còn. Synthetic feed sequence
là 1/3/5/7; bài test **không chứng minh HTTPS pull, cursor persistence hay TLS/auth**
vì inject ở Raw Kafka, không đi qua HTTP feed client.

| Field | Fixture/type/authority | Downstream |
|---|---|---|
| source_id/event_id | source identity giả lập, string ổn định | canonical identity |
| source_schema_version | `2.0` | mapping reference |
| occurred_at | ISO timestamp nguồn giả lập | event-time projection |
| cart_id/order_id | business keys giả lập | strong journey linkage/order grain |
| total_amount/currency | decimal string `20`, EUR, source_bridge | gross order value, không paid revenue |
| event_feed_id/ingress_seq | synthetic lineage/string + non-gapless integer | raw provenance; chưa test live cursor |

Script chỉ xóa volumes test khi tên và ownership label khớp project ngẫu nhiên.
Không dùng test script làm launcher hàng ngày (dataset test bị xóa cuối lượt).

## Live là bước opt-in riêng, không tự bật

Chỉ dùng `compose.handoff-live.yml` cho **environment mới PARALLEL_LIVE**, sau khi
operator xác nhận isolation, quyền feed, expected lineage, retention/replay boundary
và budget source. `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE` là xác nhận của operator,
không phải hệ thống đã tự chứng minh an toàn recovery.

Copy `runtime/handoff-live.env.example` sang file `.env` cùng tên, điền credential
được cấp riêng. `HANDOFF_INITIAL_AFTER_SEQ` không có default: không tự đặt 0 nếu
history không đủ. DB/Kafka phải thuộc cùng environment sạch; không trộn fixture
test vào live history. `source_id` giữ nguyên, connector ID phải phân biệt máy.

```text
docker compose --env-file runtime/handoff.env --env-file runtime/handoff-live.env -f infra/compose.handoff.yml -f infra/compose.handoff-pipeline.yml -f infra/compose.handoff-live.yml config --quiet
```

Chỉ sau review preflight mới thay `config --quiet` bằng `up -d`. Bản triển khai này
chưa thực hiện thao tác đó, chưa cấp quyền source mới, chưa thử feed public thật.
`/healthz` là liveness; `/readyz` và chứng cứ downstream/cursor là kiểm tra riêng.
HTTPS vẫn được xác minh; không có tùy chọn bỏ TLS verification ở overlay.

Không dùng overlay này để restore snapshot với broker mới. General RESTORE_REPLAY,
safe checkpoint, cutover/rollback chưa được đóng bằng acceptance này.

## Chuyển giao code, image và dữ liệu

1. Commit thay đổi, ghi SHA và tests; bạn nhận tạo branch phát triển từ SHA đó.
2. Publish images tới registry được team chọn/cấp quyền, ghi digest/platform; hiện
   chưa publish. Hoặc `docker save` ba image và upstream images ra archive qua kênh
   được cấp quyền, kèm checksum; người nhận `docker load`. Image không chứa DB volume.
3. Secrets cung cấp riêng; không gửi nguyên runtime, không commit `.env`.
4. Dữ liệu cũ cần logical snapshot/restore rehearsal riêng, không gộp vào image.
5. Sau một tuần nhận lại Git commits + log/tests/migrations, không merge database.

Chưa được gọi bộ này là hoàn thành toàn bộ Master hoặc production-ready.

## Analytics, Qwen và tên sản phẩm (opt-in)

Thêm `-f infra/compose.handoff-analytics.yml` vào cùng lệnh Compose để cài các
release staging đã có: summary, order ranking và product ranking. Job kiểm tra
physical bindings trước; API chỉ start sau job thành công. Không sửa metadata hay
nâng trạng thái thành production/official. Không cần model cho structured summary.

Để chat Qwen, thêm `--env-file runtime/handoff-ai.env` (copy từ example), điền key
riêng và bật `HANDOFF_ENABLE_QWEN=true` sau khi review quyền/budget/egress. Mặc định
false và không gọi provider. Chỉ credential server-side, không VITE. Python/Polars
event-count prototype vẫn không có trong image Node; không bật flag đó.

Tên sản phẩm: thêm `--env-file runtime/handoff-catalog.env` và
`-f infra/compose.handoff-catalog.yml` khi được cấp Medusa Admin catalog credential.
Worker đọc catalog mỗi giờ theo implementation hiện hành; đó là current reference
names, không phải snapshot tên tại lúc đặt hàng. Không thay giá/lịch sử order bằng
giá catalog. Chưa gọi catalog thật trong acceptance bàn giao.

Kiểm thử đầy đủ phần nội bộ, giữ Qwen tắt và không gọi catalog/feed public:

```powershell
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -WithPipeline -WithAnalytics
```

Compose optional không tự đồng nghĩa quyền/capability đã được cấp. Không gửi các
env thật của máy hiện tại sang máy bạn như cấu hình mặc định.

## Phát hành lên GHCR (chỉ khi được cấp quyền)

Script yêu cầu worktree sạch, pin full commit SHA vào tag/OCI label, build ba image,
chạy acceptance đúng các image vừa build và kiểm tra lại worktree trước push.
Mặc định **không push**. Docker registry credential lấy qua Docker Desktop/login
của operator; script không đọc/ghi PAT vào source, argument hoặc image.

```powershell
# Sau khi commit những thay đổi đã review; thay owner bằng tài khoản/team được cấp quyền.
powershell -NoProfile -File tools/release-handoff.ps1 -Registry ghcr.io/OWNER/funnelmetry
# Chỉ khi chủ động muốn publish, đã đăng nhập Docker GHCR và có quyền package:
powershell -NoProfile -File tools/release-handoff.ps1 -Registry ghcr.io/OWNER/funnelmetry -Publish
```

OWNER phải viết thường. Sau push, ghi RepoDigest/platform/commit từ output vào
manifest bàn giao và điền `HANDOFF_*_IMAGE` bằng digest. Người nhận cần quyền đọc
package rồi `docker compose ... pull`. Một push thất bại có thể để lại một phần
images; chưa được coi là release hoàn chỉnh. Không tự đổi package sang public.

## Evidence 04/10/2026

- `run-handoff.ps1 -WithPipeline`: PASS, project
  `funnelmetry-handoff-test-499fe9eda05d`, exit 0; initial và resume thực sự qua Kafka
  và worker containers, không gọi trực tiếp repository để thay đường dữ liệu.
- Workers image local tại lần build này:
  `sha256:05b10751b491614a0f5aa1068e14f5cf0d6a583e582b5edae29e5baa67dae137`.
- Container/network và hai volumes PostgreSQL/Kafka test đã bị xóa cuối lượt;
  không phải backup có thể phục hồi. Images giữ lại; demo hiện có không bị sửa.
- Source Connector/live overlay chỉ đóng gói/cấu hình, **chưa acceptance public feed**.
  Không chứng minh cursor/TLS bằng downstream test. Chưa chạy catalog sync hay model.
- Script release đã kiểm tra cú pháp; chưa chạy quy trình GHCR thực tế. Worktree
  hiện chưa commit, chưa push Git, chưa publish images. Không tuyên bố release sẵn
  cho người nhận pull trước khi các bước đó hoàn tất.
- 5 high warnings của Tailwind build toolchain vẫn là limitation đã ghi ở tài liệu base.
- Lượt `-WithPipeline -WithAnalytics -SkipBuild`, project
  `funnelmetry-handoff-test-79cebd12d9fc`: PASS initial/resume và API structured summary
  trả PROVISIONAL với evidence giá trị đơn 20 EUR; Qwen tắt, không phát sinh model call.
  Hai volumes test đã được dọn cuối lượt, images giữ lại. Ba release staging được
  install/verify; bài test HTTP không chứng nhận mọi truy vấn ranking hoặc planner.
- Compose live overlay và catalog/analytics overlays đã qua `config --quiet` với
  credential giả/endpoint `.invalid`; chưa thực hiện request tới các endpoint đó.

---

<a id="codex-handoff"></a>

> Nguồn gốc: `docs/archive/CODEX_HANDOFF.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Codex handoff — Pipeline development, 04/10/2026

> **Lưu trữ lịch sử:** quy trình handoff nhiều overlay trong tài liệu này không còn là cấu hình triển khai hiện hành. Dùng [vận hành Swarm](../SWARM_MIGRATION.md); không chạy các lệnh `compose.handoff*.yml` bên dưới.

> **Cập nhật release 10/10/2026:** image mới từ `2fb6b91` đã publish lên GHCR.
> Dùng [runbook monitoring mới](MONITORING_HISTORY.md#teammate-monitoring-test) để lấy
> ba digest và bước migration/khởi chạy; máy nhận không cần build image.
> Các digest `a725fad` bên dưới là release lịch sử 04/10, không chứa monitoring mới.
> Release mới được test sandbox độc lập, không chứng nhận Medusa/Qwen live trên máy nhận.

## 1. Read this first

Mục tiêu: người nhận tải Docker images, chạy Pipeline độc lập với Medusa + Qwen
được cấp quyền, tiếp tục phát triển một tuần rồi bàn giao lại Git changes.
Đây là **sandbox phát triển**, không phải chuyển authoritative state hay backup máy cũ.
Không coi việc publish images là đã nghiệm thu live trên máy nhận.

Đọc theo thứ tự trước khi sửa/chạy:

1. [AGENTS.md](../../AGENTS.md), [System_Cookbook/AGENTS.md](../../../System_Cookbook/AGENTS.md)
   và [System_Cookbook/codex/INDEX.md](../../../System_Cookbook/codex/INDEX.md).
2. `../System_Backbone/docs/governance/DINH_HUONG_DE_TAI.md` (DEC-125),
   `../System_Backbone/MASTER_SPECIFICATION.md` (§24.2.1).
3. `../System_Backbone/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md`.
4. [Current Swarm operations](../SWARM_MIGRATION.md), [base handoff](DEMO_HANDOFF_HISTORY.md#docker-handoff),
   [pipeline handoff](DEMO_HANDOFF_HISTORY.md#worker-handoff).
5. [Source Connector](../workers/source-connector/README.md),
   [catalog sync](../workers/catalog-sync/README.md),
   [AI](../apps/dashboard-api/README.md#dashboard-ai-backend), [analytics](../analytics/README.md).

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
cho Admin chỉ để né RBAC. Không dùng script `runtime/start-private-demo.ps1` của máy cũ
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

---

<a id="new-demo"></a>

> Nguồn gốc: `docs/archive/NEW_DEMO_2026-10-08.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Demo mới — 08/10/2026

> **Lưu trữ lịch sử:** launcher và overlay demo trong tài liệu này đã được bỏ. Demo mới theo [Docker Swarm](../SWARM_MIGRATION.md); Compose runtime cũ chỉ còn trong Git history.

## Demo tự phục hồi worker — 11/10/2026

Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/start-recovery-demo.ps1` để bật demo và Watchdog cho `canonical-normalizer`.
Giữ cửa sổ mở; Ctrl+C dừng Watchdog (không tắt container), sau đó mới chạy
`powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action stop`. UI vẫn ở http://localhost:5180. Cấu hình thử nghiệm và giới hạn:
[Watchdog README](../tools/RESILIENCE.md#resilience-watchdog).

Đây là tự phục hồi normalizer, **chưa phải autoscale tự động**. Không tự bật Medusa,
Qwen hay tạo dữ liệu. State/audit được giữ trong ignored `runtime/watchdog/`;
không xóa state để vượt circuit breaker. Cửa sổ bị đóng cưỡng bức có thể để lại lock
cần review, không tự giành lại quyền điều khiển.

Project `funnelmetry-demo-new`, fresh OFFLINE_DEMO với PostgreSQL/Kafka riêng.
Người dùng đã đồng ý bỏ image cũ và tạo demo mới; không restore dữ liệu lịch sử.
Docker trước thao tác không có container/volume. Đã xóa 15 tag của 6 image
Funnelmetry cũ tại local, không xóa image GHCR, PostgreSQL/Kafka hoặc build cache.
Bản release cũ có thể pull lại bằng digest trong [CODEX_HANDOFF.md](DEMO_HANDOFF_HISTORY.md#codex-handoff).

## Dùng hằng ngày

- Bật Docker Desktop (Linux containers).
- Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action start` để bật; mở http://localhost:5180.
- Admin email/password trong file ignored `runtime/demo-new.env`.
  Tạo Analyst qua Users để xem analytics; không cấp analytics cho Admin.
- Chạy `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action stop` để dừng và giữ dữ liệu.
- Không dùng script `runtime/start-private-demo.ps1` (deployment cũ không còn container).

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
cho DB mới theo [CODEX_HANDOFF.md](DEMO_HANDOFF_HISTORY.md#codex-handoff); không ngầm dùng cursor cũ hoặc tự đặt 0.
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
  vẫn chưa được đóng. Dùng `runtime/new-demo.ps1 -Action start` để resume toàn bộ demo khi cần.

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
- Chi tiết phạm vi và kiểm chứng: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).
- Recreate riêng API/UI; không migration, reset dữ liệu hay bật Medusa/Qwen.

### Follow-up Kafka lag — 08/10/2026

- API/UI dùng tag `20261008-lag`; launcher thêm overlay monitoring chỉ đọc.
- Trang Processing đọc offset broker thật cho 7 cặp group/topic. Demo trống đang
  có high=0, committed=-1: hiện NO_COMMITTED_OFFSET, không tự nhận lag bằng 0.
- Chi tiết cấu hình, giới hạn và kiểm chứng: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).
- Worker/DB/Kafka giữ nguyên; không gửi event, reset offset hoặc bật source/AI.

### Follow-up thành viên nhóm Kafka — 09/10/2026

- API/UI dùng tag local `20261009-membership`. Trang Processing thêm trạng thái
  nhóm và số thành viên, không hiển thị danh tính/IP hay metadata nội bộ.
- Broker thực tế trả 6 nhóm Stable, mỗi nhóm 1 thành viên tại thời điểm kiểm tra.
  Không dùng Stable để chứng nhận worker xử lý thành công hoặc hết backlog.
- Chi tiết: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).
- Chỉ recreate API/UI; không thay đổi dữ liệu, worker, offset hoặc bật live feed/AI.

### Follow-up worker runtime — 09/10/2026

- API/UI/workers dùng tag local `20261009-health`; overlay monitoring bật listener
  nội bộ 32110 cho 6 worker, không publish port lên host.
- Processing có thẻ trạng thái từng worker; runtime smoke trả 6 READY. Đây là cờ
  Kafka runtime tự báo, không phải kiểm tra DB liên tục hoặc chứng nhận xử lý đủ.
- Chi tiết và tests: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).
- Recreate worker/API/UI; giữ nguyên DB/Kafka/volumes/offset. Không bật Medusa/AI.

### Follow-up metrics — 09/10/2026

- API dùng `20261009-metrics`, UI/workers vẫn `20261009-health`.
- `/api/v2/admin/metrics` xuất định dạng Prometheus có phân quyền Admin, dùng
  session Bearer hiện hành. Dữ liệu chưa xác minh không đổi thành lag/ready = 0.
- Runtime HTTP smoke và promtool check metrics PASS. Chỉ recreate API.
- Chưa dựng Prometheus/Grafana hay credential cho scrape tự động lâu dài.
  Chi tiết: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).

### Follow-up dashboard monitoring artifacts — 09/10/2026

- Thêm dashboard Grafana import thủ công và mẫu cấu hình Prometheus tại
  `infra/observability/`; hướng dẫn trong [Observability](../MONITORING.md#observability-artifacts).
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
- Runbook: [monitoring và khóa metrics](../MONITORING.md#machine-credentials).

### Monitoring key rotation helper

- `node runtime/manage-monitoring-key.mjs rotate`:
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
- Chi tiết và giới hạn: [hồ sơ Admin/monitoring](MONITORING_HISTORY.md#admin-monitoring-evidence).

---

<a id="demo-config"></a>

> Nguồn gốc: `docs/archive/DEMO_CONFIG_2026-10-11.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Cấu hình theo luồng demo hiện tại

> **Lưu trữ lịch sử:** bộ `demo-new.env`/handoff overlay không còn là đường chạy hiện hành. Dùng [`deploy.env.example`](../../runtime/deploy.env.example) và [vận hành Swarm](../SWARM_MIGRATION.md).

## Máy đang phát triển — funnelmetry-demo-new

```text
runtime/new-demo.ps1 -Action start / -Action stop
     -> runtime/demo-new.env             (image, UI, DB/JWT/Admin, worker limits)
     -> runtime/monitoring.env           (tùy chọn: image/port monitoring)
     -> infra/compose.handoff.yml        (PostgreSQL, bootstrap, API/UI)
     -> infra/compose.handoff-pipeline.yml (Kafka, sáu worker, profile publisher)
     -> infra/compose.handoff-analytics.yml (analytical releases/tools)
     -> infra/compose.handoff-monitoring.yml (worker health/Kafka observation)
     -> infra/compose.observability.yml  (chỉ khi monitoring.env có mặt)
```

File local giữ nguyên đường dẫn để không đứt script đang dùng. Mẫu chuẩn là
`demo-new.env.example`; **không copy đè** vào `.env` đã có. Giữ password, JWT,
project và image pin hiện hữu. Admin bootstrap không phải công cụ reset mật khẩu
account đã tồn tại. `monitoring.env` chỉ nên chứa biến `MONITORING_*`.

Các `${HANDOFF_*:-default}` trong YAML dùng giá trị env nếu được khai báo, ngược
lại dùng mặc định. Shell environment cũng có thể override Compose: không export
`HANDOFF_*`, `MONITORING_*` hay `COMPOSE_*` từ deployment khác khi chạy Compose
trực tiếp. Hai launcher hiện tại loại các biến này khỏi môi trường tiến trình Docker;
giá trị lấy từ file `.env` được nạp tường minh.
Env monitoring được nạp sau demo env nên không đặt biến HANDOFF trùng ở đó.

Kiểm tra trước khi áp dụng (không xuất password/secret):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action config
```

Lệnh này kiểm tra tên project, cổng UI, các giá trị bắt buộc, giới hạn worker,
file monitoring và cú pháp Compose. Nó chỉ in tên file và trạng thái kiểm tra;
không in mật khẩu/JWT. Node.js 22+ và Docker Desktop Linux containers cần có
trên máy chạy launcher. Nếu cấu hình sai, launcher dừng trước khi chạy `up`.

Sau khi sửa env: dừng Watchdog bằng Ctrl+C nếu đang chạy, rồi chạy
`powershell -NoProfile -ExecutionPolicy Bypass -File runtime/new-demo.ps1 -Action start`.
Compose có thể recreate container; `restart` đơn thuần không nạp env/limit mới.
`-Action stop` giữ dữ liệu. Không dùng down -v/reset cursor.

## Recovery / giới hạn tài nguyên

- CPU/RAM/PID từng worker: `HANDOFF_*_CPUS`, `*_MEMORY`, `*_PIDS` trong demo-new.env;
  mặc định và bảng biến ở [vận hành Swarm](../SWARM_MIGRATION.md).
- Watchdog: `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/start-recovery-demo.ps1`, policy
  `tools/resilience-watchdog/demo.config.json`, state/audit `runtime/watchdog/`.
- Autoscaler chưa có actuator demo; đổi resource limit không bật autoscale.

## Máy bạn cùng nhóm — tách riêng

`node runtime/teammate-demo.mjs start` ->
`runtime/teammate-demo/demo.env` + `manifest.json`. Script sinh project ngẫu nhiên,
secret mới, UI mặc định 5183. Không dùng demo-new.env/monitoring.env của máy gửi.
Xem [TEAMMATE_FRESH_DEMO](DEMO_HANDOFF_HISTORY.md#teammate-demo).

## Các file khác không được demo launcher tự nạp

| Bộ file | Mục đích |
|---|---|
| `handoff.env` | Dựng thủ công bằng Compose với project/cấu hình riêng |
| `handoff-live.env` | Event Feed riêng, cần live overlay và preflight boundary/lineage |
| `handoff-catalog.env` | Catalog riêng, cần catalog overlay và credential riêng |
| `handoff-ai.env` | Qwen riêng, cần nạp env cùng analytical overlay và quyền gọi provider |
| `source-connector.env`, `catalog-sync.env`, `qwen.env` | Các workflow triển khai riêng trước đây; không tự nối vào demo mới |
| `runtime/v2-dev.env` | Cấu hình cho workflow V2 dev khác; không phải file explicit của new-demo.ps1 |
| `*.env.example` | Mẫu công khai, không được container tự đọc |

Demo đang mô tả là offline: không tự có event/catalog/chat AI chỉ vì đã điền key
vào file khác. Kích hoạt live/Qwen là bước riêng, không nằm trong chuẩn hóa này.
Không xóa file cấu hình cũ hoặc chuyển secret giữa hai môi trường tự động.

---

<a id="teammate-demo"></a>

> Nguồn gốc: `docs/TEAMMATE_FRESH_DEMO.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Demo mới trên máy bạn — 11/10/2026

> **Lưu trữ lịch sử:** bundle/launcher demo cũ đã bỏ. Người nhận triển khai theo [vận hành hiện hành](../SWARM_MIGRATION.md), với stack/env riêng và không dùng image digest cũ khi chưa kiểm chứng.

Phạm vi: OFFLINE_DEMO, database/Kafka mới, không chuyển dữ liệu từ máy khác.
Theo DEC-125; không xóa hoặc ghi đè demo cũ. Project riêng được tạo ngẫu nhiên
`funnelmetry-teammate-<id>`, UI mặc định http://localhost:5183.

## Chuẩn bị và chạy

1. Nhận source chứa `runtime/teammate-demo.mjs` và `tools/resilience-watchdog/`.
   Bản launcher mới cần commit/push trước khi máy khác lấy bằng Git; image GHCR
   không chứa các script host mới này. Ghi lại `git rev-parse HEAD` khi nhận.
2. Bật Docker Desktop **Linux containers**, dùng Docker context local; cài Node.js 22+.
   Image đã phát hành là linux/amd64. Không cần npm install hay build image.
3. Nếu package private, đăng nhập GHCR bằng tài khoản được cấp quyền đọc:

   ```powershell
   docker login ghcr.io -u <tai-khoan-github>
   ```

   Nhập token ở prompt Password, không dán token vào Git hoặc tin nhắn.
4. Trong repo Pipeline chạy:

   ```powershell
   node runtime/teammate-demo.mjs start
   ```

Lần đầu tạo `runtime/teammate-demo/demo.env` với mật khẩu DB/Admin và JWT riêng,
manifest không chứa secret, sau đó pull ba image đã pin digest từ release `2fb6b91`
ngày 10/10 và image hạ tầng. Xem provenance trong [monitoring handoff](MONITORING_HISTORY.md#teammate-monitoring-test).
Không copy `.env` của người gửi. Mật khẩu Admin chỉ đọc tại file local, email
`admin@teammate.local`; tạo Analyst qua Users để xem analytics.
Launcher xác minh project, image và các biến cấu hình trước khi chạy Compose;
biến `HANDOFF_*`, `MONITORING_*` hoặc `COMPOSE_*` trong terminal không lấn file demo.

Nếu cổng 5183 đã dùng, **ngay lần đầu** chọn cổng khác:

```powershell
node runtime/teammate-demo.mjs start 5184
```

Không đổi cổng/project bằng cách xóa manifest sau khi đã chạy. Nếu khởi tạo/pull/start
lỗi, các file và volume được giữ lại để kiểm tra; không tự reset hoặc dọn Docker.
Nếu thư mục khởi tạo dở thiếu manifest, cần review thay vì ghi đè credential.

## Dùng hàng ngày

```powershell
node runtime/teammate-demo.mjs status
node runtime/teammate-demo.mjs config
node runtime/teammate-demo.mjs stop
node runtime/teammate-demo.mjs start
```

Stop giữ nguyên volume, tài khoản và dữ liệu. Không dùng `runtime/new-demo.ps1` hoặc
`runtime/start-recovery-demo.ps1` cho deployment này vì hai script đó thuộc project khác.

Có thể chạy `node runtime/teammate-demo.mjs stop` để dừng và
`node runtime/teammate-demo.mjs watchdog` để chạy Watchdog. Khóa `operation.lock` chặn start/stop/Watchdog chạy đồng thời;
status vẫn đọc được. Nếu đóng cưỡng bức cửa sổ, lock có thể còn lại: xác minh tiến
trình đã dừng và review trước khi xử lý lock; không xóa database/cấu hình.

Muốn chạy Watchdog cho normalizer đang khỏe:

```powershell
node runtime/teammate-demo.mjs watchdog
```

Giữ cửa sổ mở. Ctrl+C dừng Watchdog trước khi stop/resume demo. State/audit nằm cùng
thư mục local; lock/pending/circuit lỗi cần review, không xóa để vượt guard.
Watchdog dùng cấu hình EXPERIMENTAL hiện có: kiểm tra mỗi 10 giây sau vòng trước,
3 lần lỗi liveness, grace 60 giây, cooldown 120 giây, tối đa 2 restart/15 phút.
Không expose Docker socket cho UI/API/Agent. Không tự bật lại worker bị operator stop.

## Có gì / chưa có gì

- Có UI/API, PostgreSQL, Kafka, sáu downstream worker, profile/analytical releases,
  worker health và Kafka lag trên Admin; dữ liệu ban đầu **trống**.
- Có Watchdog host tùy chọn cho normalizer; chưa autoscale tự động.
- Không bật Medusa feed, catalog, Qwen hoặc copy event/cursor/database cũ.
- Không tự provision Prometheus/Grafana hoặc khóa metrics; những phần đó có runbook riêng.
- HTTP/UI healthy không chứng minh đã nhận event. Muốn xem dữ liệu nghiệp vụ cần bước
  fixture có nhãn hoặc kết nối source với boundary/credential được xác minh riêng.

## Kiểm chứng của launcher

Unit tests: tạo cấu hình độc lập, không ghi đè, kiểm tra scope/port/digest và Compose
`config --quiet`. Bộ image đã có acceptance isolated riêng; **chưa chứng nhận lần cài
trên máy người nhận**. Sau start kiểm tra UI và anonymous API trả 401; ghi kết quả
máy nhận, Docker/Compose version, Git SHA và limitations vào hồ sơ bàn giao.

Kiểm tra local ngày 11/10/2026: cấu hình sinh ra qua `docker compose config --quiet`.
Không dựng thêm stack trên máy gửi trong lượt chuẩn bị launcher; clean-install
end-to-end của chính launcher này và quyền pull trên máy nhận vẫn cần xác minh.

Thư mục `runtime/teammate-demo/` bị ignore toàn bộ. Chỉ chia sẻ source/runbook,
không gửi credential, state, logs hay database trong thư mục đó.
