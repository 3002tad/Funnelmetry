# Vận hành và triển khai Pipeline

> **CURRENT RUNBOOK — 2026-10-12.** Áp dụng cho bộ Compose hiện tại của `Streaming_Pipeline`; không phải chứng nhận production. Chạy lệnh từ root repo. Quy tắc chuẩn về demo song song, backup/restore và cutover nằm ở [Backbone DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md); khi mâu thuẫn, Backbone có ưu tiên cao hơn.

## Một bộ cấu hình

| Thành phần | Vai trò |
|---|---|
| [`infra/compose.yaml`](../infra/compose.yaml) | Core services và các profile `live`, `catalog`, `monitoring` trên Windows/Linux |
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

### Máy mới của đồng đội: một env, một lệnh chạy

Áp dụng cho **project mới, dữ liệu riêng** (`OFFLINE_DEMO` hoặc `PARALLEL_LIVE` sau khi duyệt theo DEC-125), không phải restore/cutover của project cũ. Cần Docker Compose và Node.js 22+ trên host Windows hoặc Linux. Clone/pull **đúng commit** chứa bộ Compose này; image build từ source mặc định (`HANDOFF_IMAGE_POLICY=build`), không dùng tag GHCR cũ để giả định đã có tính năng mới.

1. Sao chép `runtime/deploy.env.example` thành `runtime/deploy.env` trên máy đó. Đặt `HANDOFF_PROJECT` riêng, các secret DB/JWT/Admin mới và cổng UI không xung đột. File thật phải được Git-ignore; không gửi qua chat hoặc commit.
2. Để bật các **capability được bộ Compose này hỗ trợ** cho demo, đặt `HANDOFF_DEPLOY_PROFILES=live,catalog,monitoring`, `HANDOFF_ENABLE_QWEN=true` và `HANDOFF_MONITORING_ENABLED=true`. Cấp riêng Feed URL/token/`event_feed_id`/cursor cho chặng đọc Source, Medusa Admin URL/key chỉ đọc catalog, và Alibaba Model Studio key. Không dùng key của chặng này cho chặng khác. Feed URL và Catalog URL phải là HTTPS có thể truy cập từ container, không phải `localhost` của host. Model Studio key phải cùng region Singapore với `HANDOFF_DASHSCOPE_BASE_URL`; nếu dùng workspace-dedicated endpoint thì thay URL theo [tài liệu endpoint chính thức](https://www.alibabacloud.com/help/en/model-studio/regions), không dùng Coding/Token Plan key cho backend.
3. Chỉ đặt `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE` sau khi xác nhận đây là DB/Kafka/cursor mới, connector ID riêng, feed lineage/retention và `HANDOFF_INITIAL_AFTER_SEQ` đã chọn có căn cứ. `0` chỉ hợp lệ khi Source còn đủ history. Không dùng launcher này để nối tiếp một DB clone/snapshot hoặc giành quyền authoritative từ máy khác.
4. Từ root `Streaming_Pipeline` chạy:

   ```text
   node runtime/deploy.mjs check
   node runtime/deploy.mjs start
   node runtime/deploy.mjs status
   ```

   `start` kiểm tra Compose, build core API/Web/worker, cài **migration monitoring bổ sung** sau bootstrap, cấp metrics-only credential trong `runtime/monitoring/` nếu chưa có, rồi bật cùng `live`, `catalog`, `monitoring` và kiểm tra Grafana scrape. Script không in key, không reset cursor, không xóa volume. Nếu bước nào lỗi, giữ nguyên state để kiểm tra; không chạy `down -v` hoặc xóa monitoring artifact để thử lại. Các lần chạy sau dùng cùng env/project và lệnh `start`.

5. UI mặc định ở `http://localhost:5181`; Grafana ở `http://localhost:5182` (đọc cổng thực tế từ env). Dùng [ma trận kiểm thử](TESTING.md) để đối chiếu một `event_id` đến canonical/projection và tool/evidence; container healthy không chứng minh các bước đó đã đạt. Dừng mà giữ dữ liệu bằng `node runtime/deploy.mjs stop`.

Nếu chưa có quyền đọc Feed, Admin catalog hoặc Qwen, để profile/flag tương ứng **tắt** và ghi capability đó là chưa bật; không điền giá trị giả để vượt preflight. Monitoring cần Admin bootstrap login và credential còn hiệu lực; credential cũ hết hạn phải rotate theo [runbook monitoring](MONITORING.md), không tự cấp thêm khi file đã tồn tại. Launcher không tự kiểm chứng Source TLS/auth/coverage, không tự chạy autoscaler/watchdog, không bật các UI placeholder, và không chứng nhận production.

### Lệnh Compose thủ công

Compose hiện hành chỉ publish Dashboard Web trên loopback ở `http://localhost:${HANDOFF_UI_PORT:-5181}` (mặc định `5181`). Dashboard API (`32000`), Kafka (`9092`) và PostgreSQL (`5432`) là cổng **nội bộ container**, không phải URL/port mặc định để truy cập từ host. Input Gateway `31000` thuộc topology cũ, không có service đó trong Compose hiện hành. Cổng UI thực tế lấy từ `runtime/deploy.env`.

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/compose.yaml up -d --wait
docker compose --env-file runtime/deploy.env -f infra/compose.yaml ps -a
```

Thêm **cùng một bộ** `--profile live`, `--profile catalog`, `--profile monitoring` vào `config`, `up`, `ps` khi profile đó đã được duyệt. Ví dụ deployment đã duyệt Live Feed + Catalog:

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog up -d --wait
```

- `live`: xác minh HTTPS Feed URL, read token, `event_feed_id`, initial sequence, retention/coverage và quyền đọc trước khi bật. Fresh `PARALLEL_LIVE` cần `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE`; không gắn feed vào DB restored/cursor cũ khi chưa qua replay gate. Source→Pipeline là pull-based Long Polling, không cần private Pipeline ingress/Tailscale như baseline.
- `catalog`: dùng Medusa Admin URL/key riêng, không tái dùng Feed token hoặc browser/backend signing key.
- Qwen: không có Compose profile; `HANDOFF_ENABLE_QWEN=true` cùng Model Studio key trong env sau khi duyệt chi phí và dữ liệu gửi ra provider. Flag không tạo ra tool chưa được implement.
- `monitoring`: cần chạy job `monitoring-schema` bổ sung, provision token/password/dashboard vào `runtime/monitoring/` qua `node runtime/prepare-monitoring.mjs` rồi mới bật Prometheus/Grafana; launcher ở trên thực hiện đúng thứ tự đó. Bộ secret demo cũ đã bị xóa; **profile chưa sẵn sàng chỉ bằng cách thêm cờ**.

Sau đổi image/env/code, chạy lại `up -d --wait` cùng project/profile để Compose recreate; `restart` không nạp env/image mới. Nếu API bị recreate và Web 502, kiểm tra proxy/upstream và recreate Web; vấn đề DNS proxy chưa được sửa tận gốc.

Để dừng nhưng giữ PostgreSQL/Kafka/cursor:

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml --profile live --profile catalog stop
```

Không dùng `down -v`, `prune`, reset cursor, copy Kafka volume hoặc đổi initial sequence để “sửa” deployment đã có dữ liệu. `config --quiet`, HTTP 200 và container healthy không chứng minh event đã canonical đầy đủ hay chat đã dùng Qwen; xem [ma trận kiểm thử](TESTING.md). Fresh demo khác restore/migration authoritative state theo DEC-125. Chỉ một integration writer được phép authoritative.

## Giới hạn tài nguyên worker

[`infra/compose.yaml`](../infra/compose.yaml) đặt giới hạn **mỗi replica** cho tám service dưới đây; mặc định mỗi service 1 CPU, 512 MiB RAM và 128 PID. Đây là mức cấu hình thử nghiệm, không phải SLA, reservation hay số replica an toàn cho host. Chỉnh trong `runtime/deploy.env` và recreate đúng service; không cần build lại image khi chỉ thay quota.

| Service | Prefix biến `_CPUS`, `_MEMORY`, `_PIDS` |
|---|---|
| `canonical-normalizer` | `HANDOFF_NORMALIZER` |
| `canonical-ledger-writer` | `HANDOFF_LEDGER` |
| `ingress-telemetry-writer` | `HANDOFF_TELEMETRY` |
| `journey-processor` | `HANDOFF_JOURNEY` |
| `funnel-processor` | `HANDOFF_FUNNEL` |
| `funnel-maturity-scheduler` | `HANDOFF_MATURITY` |
| `kpi-projector` | `HANDOFF_KPI` |
| `profile-publisher` (job chạy một lần) | `HANDOFF_PUBLISHER` |

Ví dụ: `HANDOFF_JOURNEY_MEMORY=768m`. RAM limit không phải riêng JS heap, CPU quota không phải CPU pinning, PID cap tính cả threads. Theo dõi OOM/restart/lag trước khi giảm quota; các giá trị này không tự bật autoscaling. Watchdog host-side và autoscaler actuator cũng **không tự chạy trong Compose**. Các con số kiểm tra trên `funnelmetry-demo-new` ngày 11/10 chỉ là evidence của demo cũ, không chứng minh limits đã áp dụng trên project mới.

Evidence lịch sử 11/10: trên project demo cũ, bảy container worker/job đã được recreate riêng; Docker HostConfig báo `NanoCpus=1000000000`, `Memory=536870912`, `PidsLimit=128`, sáu worker `/readyz` ready và publisher exit 0 tại thời điểm kiểm tra. Không xóa volume/reset cursor; đây không phải benchmark tải hoặc xác nhận cấu hình của deployment hiện hành.

## Giới hạn và tài liệu liên quan

Ngày 11/10, một project mới đã build API/Web/worker từ source và kiểm tra riêng Live Feed, canonical outcome, 104 catalog entries và chat Qwen. Đây là **demo evidence**, không phải nghiệm thu production end-to-end, completeness, backup/restore hay cutover. Monitoring và autoscaler actuator chưa được nghiệm thu trong bộ mới.

- [Chức năng đã có/chưa xong](FEATURE_STATUS.md) và [kiểm thử](TESTING.md).
- [Schema PostgreSQL](infra/postgres/README.md), [Source Connector](workers/source-connector/README.md).
- [Monitoring và khóa metrics](MONITORING.md); [hồ sơ demo/handoff cũ](archive/DEMO_HANDOFF_HISTORY.md).
- Kiến trúc/transport: [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md) và [Master Specification](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md). Các lệnh handoff/private-ingress cũ chỉ còn là lịch sử.
