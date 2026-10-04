# Bàn giao worker pipeline — 04/10/2026

**Release update:** ba image commit `a725fad` đã publish và verify trên GHCR
`vanoson2`; xem [CODEX_HANDOFF](../CODEX_HANDOFF.md) cho digest và hướng dẫn đầy đủ.
Các trạng thái chưa publish bên dưới mô tả các lượt trước phát hành, không phải
trạng thái registry hiện tại. Acceptance live trên máy nhận vẫn chưa được xác nhận.

Đọc [bộ khung handoff](HANDOFF.md) trước. Không dùng env/database/Kafka của demo cũ.
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
