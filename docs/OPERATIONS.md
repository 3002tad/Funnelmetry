# Vận hành Compose cũ — chỉ cho rollback

> **Không dùng cho triển khai hoặc demo mới.** Docker Swarm là đường chạy mới theo DEC-126. Xem [Swarm migration](SWARM_MIGRATION.md). `runtime/deploy.mjs` từ chối chạy mặc định; chỉ người vận hành thực hiện rollback có kế hoạch DEC-125 mới có thể mở khóa bằng `FUNNELMETRY_LEGACY_COMPOSE_ACK=ROLLBACK_ONLY`. Candidate Swarm đã kiểm thử API/UI/worker và HTTPS local, nhưng chưa có Medusa Live Feed nên chưa phải demo live đầy đủ.

> **LEGACY COMPOSE RUNBOOK — migration in progress (2026-10-13).** Hướng dẫn này chỉ áp dụng cho demo Compose đã có và đường rollback; không còn là baseline triển khai mới theo Backbone DEC-126–130. Xem [kế hoạch chuyển Swarm](SWARM_MIGRATION.md) trước khi tạo môi trường mới. Không chạy Compose và Swarm cùng ghi state authoritative. Quy tắc [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) vẫn áp dụng.

## Một bộ cấu hình Compose cũ

| Thành phần | Vai trò |
|---|---|
| [`infra/legacy/compose.yaml`](../infra/legacy/compose.yaml) | Core services và các profile `live`, `catalog`, `monitoring` trên Windows/Linux |
| [`runtime/deploy.env.example`](../runtime/deploy.env.example) | Mẫu biến môi trường, không chứa key thật |
| `runtime/deploy.env` | Env duy nhất của từng máy/project, Git-ignored; không đưa vào chat hoặc Git |
| [`runtime/deploy.mjs`](../runtime/deploy.mjs) | Lệnh check/start/status/stop chung Windows/Linux, dùng profile khai báo trong env |
| [`infra/docker/`](infra/docker/README.md), `infra/bootstrap/` | Image build và bootstrap schema cho deployment mới |
| [Monitoring artifacts](MONITORING.md#observability-artifacts) | Prometheus/Grafana; profile chỉ dùng sau khi provision secret |

`infra/` giữ Compose, Dockerfile và bootstrap schema; `runtime/` giữ env local và tiện ích vận hành. Xem [Docker build definitions](infra/docker/README.md) và [PostgreSQL schema](infra/postgres/README.md) khi cần chi tiết. Các Compose V2/handoff/private-ingress và launcher demo cũ không thuộc đường chạy hiện hành.

Tạo `runtime/deploy.env` từ mẫu, điền secret riêng, giữ `HANDOFF_PROJECT` ổn định khi resume và kiểm tra `git check-ignore runtime/deploy.env`. Mỗi deployment phải có project/DB/cursor riêng; không copy volume Kafka hoặc tái dùng JWT/Admin secret giữa các máy. Tránh biến `HANDOFF_*`, `MONITORING_*`, `COMPOSE_*` ở terminal ghi đè `--env-file`. Không in `docker compose config` đã render hoặc `docker inspect` khi có secret.

Các env/demo private cũ, secret monitoring và bản backup demo cũ đã được dọn khỏi `runtime/`. Nếu bật profile monitoring trên project mới, phải provision lại token/password/dashboard và kiểm tra credential lifecycle; không thể phục hồi bản dump đã xóa từ Git. Nếu phục hồi một DB demo cũ ở nơi khác, kiểm tra hoặc thu hồi credential monitoring cũ trước khi mở truy cập.

Mẫu hiện tại build API/Web/worker từ source bằng image local. Nếu triển khai bằng image phát hành, pin đúng digest đã kiểm chứng cho cùng version code; image cũ không tự có tool/Polars mới. Không mount source hoặc Docker socket vào API/Web.

## Khởi động, kiểm tra và dừng

### Máy mới của đồng đội: một env, launcher và nghiệm thu

Áp dụng cho **project mới, dữ liệu riêng** (`OFFLINE_DEMO` hoặc `PARALLEL_LIVE` sau khi duyệt theo DEC-125), không phải restore/cutover của project cũ. Cần Docker Compose và Node.js 22+ trên host Windows hoặc Linux. Clone/pull **đúng commit** chứa bộ Compose này; image build từ source mặc định (`HANDOFF_IMAGE_POLICY=build`), không dùng tag GHCR cũ để giả định đã có tính năng mới.

1. Kiểm tra Docker Desktop/Docker Engine đang chạy, Docker Compose và Node.js 22+ sẵn sàng:

   ```text
   docker compose version
   node --version
   ```

2. Sao chép `runtime/deploy.env.example` thành `runtime/deploy.env` trên máy đó. Đặt `HANDOFF_PROJECT` riêng, các secret DB/JWT/Admin mới và cổng UI không xung đột. File thật phải được Git-ignore; không gửi qua chat hoặc commit. Xác minh mà không in nội dung env:

   ```text
   git check-ignore runtime/deploy.env
   ```

3. Để bật các **capability được bộ Compose này hỗ trợ** cho demo, đặt `HANDOFF_DEPLOY_PROFILES=live,catalog,monitoring`, `HANDOFF_ENABLE_QWEN=true` và `HANDOFF_MONITORING_ENABLED=true`. Cấp riêng Feed URL/token/`event_feed_id`/cursor cho chặng đọc Source, Medusa Admin URL/key chỉ đọc catalog, và Alibaba Model Studio key. Không dùng key của chặng này cho chặng khác. Feed URL và Catalog URL phải là HTTPS có thể truy cập từ container, không phải `localhost` của host. Model Studio key phải cùng region Singapore với `HANDOFF_DASHSCOPE_BASE_URL`; nếu dùng workspace-dedicated endpoint thì thay URL theo [tài liệu endpoint chính thức](https://www.alibabacloud.com/help/en/model-studio/regions), không dùng Coding/Token Plan key cho backend.
4. Chỉ đặt `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE` sau khi xác nhận đây là DB/Kafka/cursor mới, connector ID riêng, feed lineage/retention và `HANDOFF_INITIAL_AFTER_SEQ` đã chọn có căn cứ. `0` chỉ hợp lệ khi Source còn đủ history. Không dùng launcher này để nối tiếp một DB clone/snapshot hoặc giành quyền authoritative từ máy khác.
5. Sau khi clone/pull hoặc thay đổi source, chạy bộ kiểm tra tối thiểu trước deployment. `git status` dùng để nhận diện thay đổi đang có, không phải yêu cầu xóa một working tree hợp lệ. Nếu host chưa có dependency test, chạy `npm ci --prefix apps/dashboard-api` và `npm ci --prefix apps/dashboard-web` trước; đây là dependency local Git-ignore, không phải runtime dependency của Docker image:

   ```text
   git status --short
   npm test --prefix apps/dashboard-api
   node --test apps/dashboard-web/test/navigation.test.mjs
   npm run build --prefix apps/dashboard-web
   node --test runtime/unified-compose.test.mjs runtime/monitoring-rotation.test.mjs
   ```

   Test bị skip phải được đọc lý do; không tự quy đổi skip thành pass. Xem [ma trận kiểm thử](TESTING.md) nếu thay đổi chạm worker, schema, analytics, monitoring hoặc integration contract.
6. Từ root `Streaming_Pipeline` chạy:

   ```text
   node runtime/deploy.mjs check
   node runtime/deploy.mjs start
   node runtime/deploy.mjs status
   ```

   `start` kiểm tra Compose, build core API/Web/worker, cài **migration monitoring bổ sung** sau bootstrap, cấp metrics-only credential trong `runtime/monitoring/` nếu chưa có, rồi bật cùng `live`, `catalog`, `monitoring` và kiểm tra Grafana scrape. Script không in key, không reset cursor, không xóa volume. Nếu bước nào lỗi, giữ nguyên state để kiểm tra; không chạy `down -v` hoặc xóa monitoring artifact để thử lại. Các lần chạy sau dùng cùng env/project và lệnh `start`.

7. UI mặc định ở `http://localhost:5181`; Grafana ở `http://localhost:5182` (đọc cổng thực tế từ env). Dùng checklist nghiệm thu dưới đây để kiểm tra capability đã bật; container healthy không chứng minh các bước đó đã đạt. Dừng mà giữ dữ liệu bằng `node runtime/deploy.mjs stop`.

### Nghiệm thu sau khi `start`

#### 1. Đọc đúng trạng thái Compose

`node runtime/deploy.mjs start` chỉ hoàn tất thành công sau khi các healthcheck được chọn đạt và, nếu bật `monitoring`, lần authenticated scrape đầu tiên đạt. Dòng kết thúc mong đợi có dạng `PASS: selected services started (...)`. Sau đó chạy lại:

```text
node runtime/deploy.mjs status
```

Đối chiếu theo loại service, không yêu cầu mọi container đều `Up`:

| Loại | Trạng thái mong đợi |
|---|---|
| Core dài hạn | `postgres`, `kafka`, `dashboard-api`, `dashboard-web` và các worker core ở `Up`; service có healthcheck phải `healthy` |
| Profile `live` | `source-connector` ở `Up (healthy)` |
| Profile `catalog` | `catalog-sync` ở `Up`; nếu healthcheck được khai báo thì phải `healthy` |
| Profile `monitoring` | `prometheus` và `grafana` ở `Up (healthy)` |
| Job one-shot | `bootstrap`, `kafka-topics`, `traffic-schema`, `traffic-registry-schema`, `analytical-releases`, `profile-publisher`, `monitoring-schema` có thể ở `Exited (0)`; đây là thành công, không phải service bị chết |

`Restarting`, `unhealthy`, exit khác `0`, hoặc launcher dừng trước dòng `PASS` đều phải được điều tra. Không chạy `down -v`, reset cursor hoặc xóa monitoring artifacts để thử lại.

#### 2. Smoke test HTTP và route UI

Dùng cổng thực tế từ `HANDOFF_UI_PORT` (ví dụ dưới đây dùng giá trị mặc định `5181`; thay cả hai chỗ nếu env đặt cổng khác). Trên Windows gọi `curl.exe`; trên Linux/macOS gọi `curl`:

```text
curl -fsS http://localhost:5181/healthz
curl -fsSI http://localhost:5181/assets
```

- `/healthz` phải trả `200`/`ready`.
- `/assets` phải trả `200` với `Content-Type: text/html`, không trả `301/302`, không có header `Location` trỏ tới cổng nội bộ `8080`.
- Mở trực tiếp rồi reload `http://localhost:5181/assets`; trang **Analytical Assets** phải render. Điều này kiểm tra Nginx SPA route riêng, khác với click navigation từ trang đã tải.
- Nếu UI trả `502` sau khi API vừa được recreate, kiểm tra health/log của `dashboard-api`, sau đó recreate Web bằng cùng env/project/profile; không đổi hostname nội bộ hoặc đưa API port ra host để né lỗi.

#### 3. Bootstrap tài khoản và kiểm tra RBAC

1. Mở `http://localhost:5181/login`, đăng nhập bằng `HANDOFF_ADMIN_EMAIL` và `HANDOFF_ADMIN_PASSWORD` trong `runtime/deploy.env`. Không in hoặc copy hai giá trị này vào log/tài liệu.
2. Vào `/admin/users`, tạo tài khoản riêng có role `analyst`, email hợp lệ và mật khẩu ban đầu tối thiểu 12 ký tự. Không dùng lại mật khẩu Admin.
3. Đăng xuất Admin rồi đăng nhập Analyst. Admin kỹ thuật không mặc nhiên có quyền analytics; Analyst phải thấy các trang Overview, Data Workspace, Evidence, Funnel/Journey/Product, Metrics/Assets, Events, Data Health và AI Chat khi capability tương ứng bật.
4. Xác nhận Analyst không truy cập được trang quản trị. Việc ẩn menu không thay thế backend authorization; một URL quản trị gọi trực tiếp vẫn phải bị `403` hoặc redirect theo UI.

#### 4. Checklist capability đầy đủ

| Capability | Ai kiểm tra | Acceptance tối thiểu |
|---|---|---|
| Core analytics | Analyst | `/overview`, `/events`, `/funnels`, `/journeys`, `/products`, `/data-health`, `/metrics`, `/assets`, `/workspace`, `/analysis-runs` và `/evidence` tải được; trạng thái `PROVISIONAL`, reconciliation warning hoặc dữ liệu rỗng phải được giữ nguyên, không đổi thành số `0` hay claim đã verified |
| Live Feed | Admin | `/admin/event-feed`, `/admin/connector`, `/admin/processing` tải được; feed identity/cursor đúng deployment; connector không báo auth/feed mismatch; chọn một `event_id` để đối chiếu receipt/outcome → canonical → projection theo [TESTING.md](TESTING.md) |
| Catalog | Admin + Analyst | Trang metadata/catalog quản trị tải được; `/assets`, `/metrics`, `/products` hiển thị release/binding hiện hành; catalog enrichment không được làm đổi grain hoặc amount lịch sử |
| Monitoring | Admin | Launcher đã vượt authenticated scrape; Grafana mở ở `MONITORING_GRAFANA_PORT`; Prometheus/Grafana healthy; trạng thái unknown/stale không được trình bày thành số `0` |
| Account/audit | Admin | User vừa tạo xuất hiện ở `/admin/users`; login Analyst thành công; create/role/lock/password operations có audit tương ứng |
| Evidence/report | Analyst | Một structured analysis tạo `analysis_run_id`/`evidence_id`; Evidence Explorer hiển thị tool ID, catalog release, scope, quality/warnings và kết quả; reload trang không tự chạy lại analysis |

#### 5. Nghiệm thu Qwen và analyst tools

Chỉ thực hiện phần này khi `HANDOFF_ENABLE_QWEN=true`, key/chi phí đã được duyệt và người vận hành đã chấp thuận gửi **câu hỏi + scope/tool metadata hoặc dữ liệu tổng hợp cần giải thích** tới Alibaba Cloud Singapore. Không nhập secret, PII hoặc raw identity vào Chat.

Đăng nhập bằng Analyst, chọn đúng source/time window rồi chạy ba câu hỏi độc lập:

| Câu hỏi mẫu | Tool/evidence mong đợi |
|---|---|
| `Tóm tắt tổng giá trị đơn hàng đã đặt, số đơn và AOV trong phạm vi hiện tại.` | `tool.metric_summary`; kết quả dùng gross placed-order value, không gọi là paid/net revenue; giữ currency, quality warning và evidence ID |
| `Đơn hàng nào có giá trị đã đặt cao nhất trong phạm vi hiện tại?` | `tool.order_ranking`; xếp hạng trong từng currency, không cộng chéo tiền tệ |
| `Top sản phẩm theo tổng đơn giá lúc đặt nhân số lượng trong phạm vi hiện tại.` | `tool.product_value_ranking`; ghi rõ đây là proxy unit price × quantity, không phải paid revenue |

Với mỗi lượt, mở nhóm **Bằng chứng** và xác nhận tool ID/cửa sổ thời gian/source đúng. Câu trả lời phải được tạo từ deterministic template/evidence cho ba tool trên; Qwen chỉ chọn kế hoạch. HTTP `503` ở `/api/v2/chat`, `invalid_tool_plan`, thiếu evidence, tool ID không thuộc registry hoặc số liệu do model tự sinh đều là failure. Không ghi cứng giá trị số mong đợi vào runbook vì dữ liệu và time window thay đổi theo deployment.

#### 6. Ghi biên bản lần triển khai

Ghi lại tối thiểu: Git commit, image tag/digest, `HANDOFF_PROJECT`, profile set, source/feed identity không chứa token, initial/resume cursor, thời điểm UTC, số lượng/coverage quan sát, catalog release, trạng thái reconciliation, kết quả monitoring, tài khoản/role đã kiểm tra và các evidence ID mẫu. Không ghi password, JWT, Feed/Catalog/Qwen token hoặc output cấu hình Compose đã render. Đây là runtime evidence của lần triển khai, không tự nâng thành production certification.

### Dừng hệ thống an toàn (routine, giữ nguyên state)

Quy trình này dùng để tạm dừng demo/development trên **cùng máy và cùng deployment**, sau đó có thể chạy lại. Nó giữ named volumes của PostgreSQL/Kafka, cursor, evidence, account và monitoring artifacts. Nó **không** tạo backup, processing-safe checkpoint hay migration manifest, nên không được dùng để tuyên bố snapshot/cutover sang máy khác đã an toàn.

1. Không sửa `runtime/deploy.env`, đặc biệt là `HANDOFF_PROJECT` và `HANDOFF_DEPLOY_PROFILES`, trước khi dừng. Launcher chỉ chọn các service thuộc đúng project/profile đang khai báo; đổi profile trước có thể bỏ sót container vẫn đang chạy.
2. Ngừng bắt đầu analysis/chat hoặc thao tác quản trị mới và chờ request đang dùng hoàn tất. Nếu đang kiểm thử, ghi lại commit/image và evidence cần giữ. Với profile `live`, Source Event Feed có thể tiếp tục tích lũy event trong thời gian Pipeline dừng; phải bảo đảm retention của Source bao phủ thời gian downtime dự kiến.
3. Từ root `Streaming_Pipeline`, kiểm tra đúng deployment rồi dừng:

   ```text
   node runtime/deploy.mjs status
   node runtime/deploy.mjs stop
   node runtime/deploy.mjs status
   ```

   Chờ lệnh `stop` kết thúc; không tắt Docker Desktop/daemon hoặc đóng cưỡng bức terminal giữa chừng. Launcher chạy `docker compose stop` với đúng env/project/profile đã duyệt. Compose gửi tín hiệu dừng và chờ `stop_grace_period` của service; launcher không chạy `down` và không xóa volume.
4. Ở lần `status` cuối, các service chạy dài hạn thuộc profile đã chọn không còn ở trạng thái `Up`. Các job one-shot như `bootstrap`, `kafka-topics`, `analytical-releases`, `profile-publisher` hoặc `monitoring-schema` có thể đã ở `Exited (0)` từ trước; đây không phải lỗi shutdown. Nếu vẫn còn service `Up`, kiểm tra lại `HANDOFF_PROJECT`, profile set và tên project thực tế; không dùng `down -v` để xử lý.
5. Để chạy lại, giữ nguyên env/project/profile và dùng:

   ```text
   node runtime/deploy.mjs check
   node runtime/deploy.mjs start
   node runtime/deploy.mjs status
   ```

   Sau khi start, kiểm tra Source Connector/cursor, worker readiness, backlog/lag, Data Health và một event/evidence theo [ma trận kiểm thử](TESTING.md). `start`/`status` thành công chỉ chứng minh deployment chạy, không tự chứng minh backlog đã catch up hoặc dữ liệu đã đối soát.

Các trường hợp sau **không thuộc routine stop**:

| Mục đích | Yêu cầu |
|---|---|
| Chuyển authoritative deployment sang máy khác | Quiesce writer, dừng pull tại barrier, drain required stages, chốt `processing_safe_checkpoint`, tạo logical PostgreSQL snapshot + manifest và kiểm tra replay/rollback theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md). Lệnh `stop` đơn thuần không thay thế quy trình này. |
| Dừng lâu hơn retention của Source Event Feed | Xác minh coverage/archive và kế hoạch recovery trước khi dừng; không giả định connector có thể đọc lại history đã hết retention. |
| Xóa/decommission dữ liệu | Cần phê duyệt retention/backup/credential revocation riêng. `down --volumes`, `prune` và xóa artifact không phải thao tác shutdown routine. |

Nếu chưa có quyền đọc Feed, Admin catalog hoặc Qwen, để profile/flag tương ứng **tắt** và ghi capability đó là chưa bật; không điền giá trị giả để vượt preflight. Monitoring cần Admin bootstrap login và credential còn hiệu lực; credential cũ hết hạn phải rotate theo [runbook monitoring](MONITORING.md), không tự cấp thêm khi file đã tồn tại. Launcher không tự kiểm chứng Source TLS/auth/coverage, không tự chạy autoscaler/watchdog, không bật các UI placeholder, và không chứng nhận production.

### Lệnh Compose thủ công

Compose hiện hành chỉ publish Dashboard Web trên loopback ở `http://localhost:${HANDOFF_UI_PORT:-5181}` (mặc định `5181`). Dashboard API (`32000`), Kafka (`9092`) và PostgreSQL (`5432`) là cổng **nội bộ container**, không phải URL/port mặc định để truy cập từ host. Input Gateway `31000` thuộc topology cũ, không có service đó trong Compose hiện hành. Cổng UI thực tế lấy từ `runtime/deploy.env`.

```text
docker compose --env-file runtime/deploy.env -f infra/legacy/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/legacy/compose.yaml up -d --wait
docker compose --env-file runtime/deploy.env -f infra/legacy/compose.yaml ps -a
```

Thêm **cùng một bộ** `--profile live`, `--profile catalog`, `--profile monitoring` vào `config`, `up`, `ps` khi profile đó đã được duyệt. Ví dụ deployment đã duyệt Live Feed + Catalog:

```text
docker compose --env-file runtime/deploy.env -f infra/legacy/compose.yaml --profile live --profile catalog up -d --wait
```

- `live`: xác minh HTTPS Feed URL, read token, `event_feed_id`, initial sequence, retention/coverage và quyền đọc trước khi bật. Fresh `PARALLEL_LIVE` cần `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE`; không gắn feed vào DB restored/cursor cũ khi chưa qua replay gate. Source→Pipeline là pull-based Long Polling, không cần private Pipeline ingress/Tailscale như baseline.
- `catalog`: dùng Medusa Admin URL/key riêng, không tái dùng Feed token hoặc browser/backend signing key.
- Qwen: không có Compose profile; `HANDOFF_ENABLE_QWEN=true` cùng Model Studio key trong env sau khi duyệt chi phí và dữ liệu gửi ra provider. Flag không tạo ra tool chưa được implement.
- `monitoring`: cần chạy job `monitoring-schema` bổ sung, provision token/password/dashboard vào `runtime/monitoring/` qua `node runtime/prepare-monitoring.mjs` rồi mới bật Prometheus/Grafana; launcher ở trên thực hiện đúng thứ tự đó. Bộ secret demo cũ đã bị xóa; **profile chưa sẵn sàng chỉ bằng cách thêm cờ**.

Sau đổi image/env/code, chạy lại `up -d --wait` cùng project/profile để Compose recreate; `restart` không nạp env/image mới. Web image mới dùng Docker DNS để resolve lại `dashboard-api` sau khi container API đổi IP; vẫn có thể có 502 thoáng qua trong lúc API chưa sẵn sàng hoặc DNS cache chưa hết hạn. Nếu 502 kéo dài, kiểm tra API readiness, DNS/network và log proxy; không coi `/healthz` của Web là bằng chứng API khỏe. Image Web cũ vẫn giữ cấu hình proxy cũ và cần build/recreate để nhận bản sửa.

Ưu tiên quy trình launcher ở mục **Dừng hệ thống an toàn**. Nếu buộc phải dùng Compose thủ công, lệnh `stop` phải lặp lại **đúng toàn bộ profile đã dùng khi start**. Ví dụ deployment đã chạy cả ba profile:

```text
docker compose --env-file runtime/deploy.env -f infra/legacy/compose.yaml --profile live --profile catalog --profile monitoring stop
```

Không dùng `down -v`, `prune`, reset cursor, copy Kafka volume hoặc đổi initial sequence để “sửa” deployment đã có dữ liệu. `config --quiet`, HTTP 200 và container healthy không chứng minh event đã canonical đầy đủ hay chat đã dùng Qwen; xem [ma trận kiểm thử](TESTING.md). Fresh demo khác restore/migration authoritative state theo DEC-125. Chỉ một integration writer được phép authoritative.

## Raw Kafka nhiều partition (chỉ project mới)

Mặc định `HANDOFF_RAW_PARTITIONS=1` và `HANDOFF_NORMALIZER_ID_MODE=explicit` giữ nguyên hành vi demo hiện tại. Nếu cần kiểm tra nhiều replica Normalizer trong **project mới, dữ liệu tách biệt**, đặt `HANDOFF_RAW_PARTITIONS=2` và `HANDOFF_NORMALIZER_ID_MODE=container` trong `runtime/deploy.env` trước lần `start` đầu tiên. Launcher từ chối cấu hình nhiều partition nhưng dùng transaction ID cố định; job tạo topic kiểm tra partition count và từ chối sai lệch, không tự repartition topic cũ.

Hai biến này chỉ chuẩn bị điều kiện topology, **không bật autoscaler**. Trước khi scale thực tế vẫn cần chứng minh host capacity, replay/dedupe, drain khi giảm replica và phối hợp Watchdog; xem [Resilience](tools/RESILIENCE.md). Không thay đổi partition của project đang có dữ liệu chỉ bằng cách sửa env.

## Giới hạn tài nguyên worker

[`infra/legacy/compose.yaml`](../infra/legacy/compose.yaml) đặt giới hạn **mỗi replica** cho chín service dưới đây; mặc định mỗi service 1 CPU, 512 MiB RAM và 128 PID. Đây là mức cấu hình thử nghiệm, không phải SLA, reservation hay số replica an toàn cho host. Chỉnh trong `runtime/deploy.env` và recreate đúng service; không cần build lại image khi chỉ thay quota.

| Service | Prefix biến `_CPUS`, `_MEMORY`, `_PIDS` |
|---|---|
| `canonical-normalizer` | `HANDOFF_NORMALIZER` |
| `canonical-ledger-writer` | `HANDOFF_LEDGER` |
| `ingress-telemetry-writer` | `HANDOFF_TELEMETRY` |
| `traffic-source-writer` | `HANDOFF_TRAFFIC` |
| `journey-processor` | `HANDOFF_JOURNEY` |
| `funnel-processor` | `HANDOFF_FUNNEL` |
| `funnel-maturity-scheduler` | `HANDOFF_MATURITY` |
| `kpi-projector` | `HANDOFF_KPI` |
| `profile-publisher` (job chạy một lần) | `HANDOFF_PUBLISHER` |

Ví dụ: `HANDOFF_JOURNEY_MEMORY=768m`. RAM limit không phải riêng JS heap, CPU quota không phải CPU pinning, PID cap tính cả threads. Theo dõi OOM/restart/lag trước khi giảm quota; các giá trị này không tự bật autoscaling. Watchdog host-side và autoscaler actuator cũng **không tự chạy trong Compose**. Các con số kiểm tra trên `funnelmetry-demo-new` ngày 11/10 chỉ là evidence của demo cũ, không chứng minh limits đã áp dụng trên project mới.

Evidence lịch sử 11/10: trên project demo cũ, bảy container worker/job đã được recreate riêng; Docker HostConfig báo `NanoCpus=1000000000`, `Memory=536870912`, `PidsLimit=128`, sáu worker `/readyz` ready và publisher exit 0 tại thời điểm kiểm tra. Không xóa volume/reset cursor; đây không phải benchmark tải hoặc xác nhận cấu hình của deployment hiện hành.

## Traffic input lineage bổ sung

Compose core chạy `traffic-schema` sau bootstrap, rồi `traffic-source-writer` dùng consumer group độc lập để đọc Raw Kafka. Bảng `traffic_source_raw_events_v1` chỉ ghi trạng thái và SHA-256 của `source_metadata.utm_source` theo `(source_id,event_id)`; không có giá trị UTM rõ trong bảng mới. Kiểm tra bằng `node --test runtime/unified-compose.test.mjs` và `npm test --prefix workers/traffic-source-writer` trước khi build image mới. Triển khai trên project đang chạy cần xác nhận job schema hoàn tất, worker `/readyz` và offset group mới; HTTP ready không chứng minh đã xử lý đủ event. Kafka retention giới hạn phạm vi replay: bản ghi trước retention floor không tự xuất hiện, nên không được coi đây là backfill lịch sử hoàn chỉnh. SHA-256 của một nguồn phổ biến có thể bị đoán, không phải ẩn danh; chỉ cấp quyền DB cần thiết và không đưa bảng này lên public API.

DA có `/traffic` để xem số event browser có/không có `utm_source` trong cửa sổ `received_at` 7/30/90 ngày. Analyst có quyền `traffic.mapping.write` để kiểm tra chính xác raw UTM rồi tạo/đổi nhãn trong Traffic Source Registry; thay đổi phải khớp phiên bản và ghi audit trong cùng transaction. Bảng registry chỉ lưu SHA-256, không trả raw/hash qua API, nhưng hash vẫn có thể bị đoán. Trang cũng hiển thị số **event** theo nhãn hiện tại; nhãn mới/đổi nhãn có thể làm phân nhóm lịch sử thay đổi khi đọc lại, không sửa bản ghi event. Đây không phải số khách, campaign attribution, order conversion hoặc doanh thu theo nguồn. Trên deployment cũ phải build lại API/Web và chạy job `traffic-schema` cùng `traffic-registry-schema` trước khi kiểm tra trang; xác nhận `traffic-source-writer` bắt kịp Raw Kafka. `0` không chứng minh Source không gửi event.

## Giới hạn và tài liệu liên quan

Ngày 12/10, deployment cục bộ hiện hành đã build API/Web/worker từ source với các profile `live,catalog,monitoring`; launcher vượt authenticated monitoring scrape, Dashboard/Grafana và các service được chọn đạt healthcheck, `/assets` mở trực tiếp không redirect sang cổng container, và ba analytical tool `tool.metric_summary`, `tool.order_ranking`, `tool.product_value_ranking` đã tạo evidence qua Analyst Chat. Đây là **runtime demo evidence của một project**, không phải nghiệm thu production, completeness, backup/restore, migration/cutover, autoscaling actuator hoặc khả năng tái lập trên mọi máy. Mỗi deployment mới vẫn phải chạy lại checklist ở trên và lưu evidence riêng.

- [Chức năng đã có/chưa xong](FEATURE_STATUS.md) và [kiểm thử](TESTING.md).
- [Schema PostgreSQL](infra/postgres/README.md), [Source Connector](workers/source-connector/README.md).
- [Monitoring và khóa metrics](MONITORING.md); [hồ sơ demo/handoff cũ](archive/DEMO_HANDOFF_HISTORY.md).
- Kiến trúc/transport: [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md) và [Master Specification](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md). Các lệnh handoff/private-ingress cũ chỉ còn là lịch sử.
