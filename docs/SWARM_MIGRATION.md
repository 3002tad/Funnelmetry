# Docker Swarm migration

> CDC-13 current configuration: `infra/swarm-live.yml` retains Source Connector
> for Browser SDK/storefront events, and no longer contains `catalog-sync` or
> its Medusa Admin API secret. `SWARM_PRODUCT_REFERENCE_PROVIDER=catalog_cdc`
> is the only supported product-reference provider. The old API pull and
> native order message rollback instructions further below are historical
> migration records, not commands for the active reference deployment.

Current VPS tunnel deployment evidence: [KLTN_VPS_TUNNEL_LIVE_VALIDATION_2026-10-27.md](KLTN_VPS_TUNNEL_LIVE_VALIDATION_2026-10-27.md).

## Optional Qdrant knowledge for Chat V2

For a reviewed demo stack, set `SWARM_VECTOR_KNOWLEDGE_ENABLED=true` in the
machine-local ignored `runtime/deploy.env` and pin `SWARM_QDRANT_IMAGE` to the
official tag+digest shown in `deploy.env.example` (or review a newer digest).
Run `node runtime/swarm.mjs check-app` before `deploy-app`. This adds the
private `qdrant` service and the one-shot `knowledge-index` job through
`infra/swarm-knowledge.yml`. Qdrant uses a named local volume and the
`funnelmetry.stateful=true` placement label; no host port is published. Verify
the Qdrant task is running, the index job is `Complete` and reports 16 assets,
then ask Chat V2: “Giá trị đơn hàng đã đặt là gì?”. A definition answer must
cite `asset.fact_order@1.0.0` and say it is not paid revenue.

This is derived metadata retrieval, not numeric authority or a production RAG
corpus. Qdrant is **not** a generic autoscale target. Local volume does not
provide cross-node HA; after storage loss the index can be rebuilt from the
version-pinned API image. Do not enable a new stateful service without checking
node capacity and image availability. If the index job fails, do not claim
vector retrieval is active; inspect its task/logs and rerun after fixing the
underlying issue.

## Hai máy chạy độc lập (quy trình hiện hành)

Máy của bạn và máy đồng đội là **hai Swarm single-node riêng**, không dùng
`docker swarm join` để ghép thành một cluster. Cả hai checkout cùng phiên bản
source và lấy cùng bộ image digest trong [`deploy.env.example`](../runtime/deploy.env.example).
Các image GHCR trong mẫu đã được kiểm tra manifest `linux/amd64` ngày
2026-10-15; máy khác kiến trúc phải có bộ image tương ứng trước khi deploy.
Mỗi máy tự tạo file ignored `runtime/deploy.env`, tên stack, named volumes,
Swarm secrets, TLS private key và tài khoản admin riêng. Không gửi file env thật
hay thư mục `runtime/credentials` cho nhau. Không copy PostgreSQL/Kafka volume
hoặc Source Connector cursor từ máy này sang máy kia.

Trên **mỗi máy**, sau khi cài Docker Engine/Desktop chế độ Linux containers,
Node và pull source, operator làm theo thứ tự:

1. Tạo `runtime/deploy.env` từ mẫu. Chọn `SWARM_STACK_NAME` riêng; bắt đầu bằng
   `SWARM_MIGRATION_MODE=OFFLINE_DEMO` nếu chưa có Feed/cursor được Source xác nhận.
   Điền `SWARM_ADMIN_EMAIL`, hostname/TLS của chính máy đó; để trống các password
   được launcher sinh tự động. Không dùng `deploy.env` của máy khác.
2. Chạy `docker swarm init` **chỉ nếu** `docker info` cho biết Swarm chưa active.
   Kiểm tra `docker node ls` chỉ có một node. Sau khi xem vị trí lưu dữ liệu và
   cổng HTTPS, chạy `docker node update --label-add funnelmetry.stateful=true <NODE_ID>`
   và `docker node update --label-add funnelmetry.edge=true <NODE_ID>` trên manager,
   với `NODE_ID` lấy từ `docker node ls` của chính máy đó.
3. Với TLS local, đặt certificate/key ở đường dẫn tuyệt đối **ngoài repo** và
   cấu hình hai `SWARM_LOCAL_TLS_*_FILE`. Máy truy cập phải resolve hostname
   về node edge và trust certificate. Với ACME, phải có DNS/cổng 80, 443 thực
   sự thông trước khi đặt acknowledgement. Đăng nhập GHCR trên mỗi máy bằng
   tài khoản có quyền pull image private; không đưa token vào env mẫu.
4. Chạy `node runtime/swarm.mjs check-host`. Lệnh này chỉ đọc: render stack,
   xác nhận manager Linux một node, hai placement label và đường dẫn TLS local.
   Nó **không** chứng minh pull image, hostname/certificate trust, port trống,
   secret tồn tại hoặc service healthy. Sau đó theo luồng fresh deployment bên
   dưới: tạo secrets phù hợp mode, `deploy` data, xác nhận bootstrap/topic jobs
   Complete, rồi `deploy-app` và đối chiếu UI/API/event.

Nếu cả hai máy cần `PARALLEL_LIVE`, mỗi máy phải có consumer identity/cursor
độc lập và mốc `initial_after_seq` còn trong retention được Source xác nhận.
Không bật hai writer như cùng một hệ thống authoritative, và không chuyển mode
của stack đã có dữ liệu. Lần deploy đầu trên máy đồng đội vẫn cần kiểm chứng
runtime tại máy đó; preflight trên máy này không thay thế nghiệm thu máy kia.

## Đường triển khai hiện hành (15/10/2026)

Pipeline dùng **một** file cục bộ `runtime/deploy.env` và launcher `runtime/swarm.mjs` trên Windows/Linux. Tạo file từ [`deploy.env.example`](../runtime/deploy.env.example), điền các biến `SWARM_*` cần cho mode đã chọn và image pin đúng source commit. `infra/swarm-*.yml` là cấu hình stack; không chạy Compose Pipeline cũ. Source Ingress/Edge Relay do phía Medusa vận hành là hệ thống riêng, không bị thay đổi bởi việc bỏ Compose Pipeline.

Với môi trường mới, chọn `OFFLINE_DEMO` **hoặc** `PARALLEL_LIVE` trước khi tạo DB/Kafka/cursor; không đổi mode trên stack đã có dữ liệu. Live cần feed identity, retention floor và initial cursor đã được Medusa xác nhận, cùng Feed/Catalog/Qwen credentials riêng trong `SWARM_FEED_TOKEN`, `SWARM_CATALOG_KEY`, `SWARM_DASHSCOPE_API_KEY`. Bot test cần Source Ingress write key **khác** Feed read token; không suy ra hoặc sao chép giữa hai chặng. Mẫu env không chứa `HANDOFF_*`; launcher vẫn đọc bốn tên cũ tương ứng trong env cục bộ hiện có để không làm gián đoạn stack đang chạy, và từ chối khi cũ/mới khác nhau. Để chuyển sang tên mới, thay từng khóa tại chỗ, không commit file thật hoặc in secret ra terminal.

Trên manager đã gắn label stateful/edge và có TLS/registry credentials được duyệt, kiểm tra tĩnh trước:

```text
node --test runtime/swarm-config.test.mjs runtime/swarm-preflight.test.mjs runtime/swarm.test.mjs
node runtime/swarm.mjs check-app
```

Với **stack mới**, lần lượt tạo DB/app/live (nếu PARALLEL_LIVE)/TLS secrets bằng các lệnh `create-*-secrets` phù hợp, chạy `deploy` cho data substrate, xác nhận bootstrap và Kafka topic jobs `Complete`, sau đó chạy `deploy-app` và kiểm tra task, TLS, event ID, canonical projection. Với **stack đang chạy**, không chạy lại lệnh tạo secret và không đổi cursor/topic chỉ để cập nhật env; phải review rollout, digest image và rollback trước khi `deploy-app`. Nếu ba job một lần `bootstrap`, `kafka-topics`, `profile-publisher` đã `Complete`, đặt riêng `SWARM_BOOTSTRAP_REPLICAS=0`, `SWARM_KAFKA_TOPICS_REPLICAS=0`, `SWARM_PROFILE_PUBLISHER_REPLICAS=0` trong ignored `runtime/deploy.env` trước lần deploy manifest tiếp theo; mặc định `1` chỉ dành cho lần cài mới hoặc khi operator chủ động chạy lại job. Không đặt `0` trước khi job tương ứng hoàn thành. `check-app` thành công chỉ chứng minh YAML render, không chứng minh pull image, service health, replay hay auto-scale. Xem [test/evidence](TESTING.md) và [controller autoscale](../tools/swarm-controllers/README.md). Các mục bên dưới còn giữ chi tiết lịch sử migration và phải đọc theo thời điểm ghi nhận, không xem là trạng thái live hiện tại.

Current isolated live-stack evidence: [SWARM_PARALLEL_LIVE_VALIDATION_2026-10-14.md](SWARM_PARALLEL_LIVE_VALIDATION_2026-10-14.md). Current-image manual 1→2→1 fixture evidence and live autoscale blockers: [SWARM_AUTOSCALE_CURRENT_IMAGE_VALIDATION_2026-10-14.md](SWARM_AUTOSCALE_CURRENT_IMAGE_VALIDATION_2026-10-14.md). These runs do not supersede the remaining autoscale, monitoring, restore or cutover gates below.

> Bằng chứng chạy candidate local ngày 2026-10-13: [SWARM_CANDIDATE_VALIDATION_2026-10-13.md](SWARM_CANDIDATE_VALIDATION_2026-10-13.md). Đây là kiểm thử `OFFLINE_DEMO`, không phải live cutover.
> Bằng chứng candidate `PARALLEL_LIVE` và các gate còn thiếu: [SWARM_PARALLEL_LIVE_VALIDATION_2026-10-13.md](SWARM_PARALLEL_LIVE_VALIDATION_2026-10-13.md). Stack mới không phải authoritative cutover hoặc full-capability acceptance.

## Internal-only application smoke (không publish port)

Khi chưa có HTTPS domain/certificate được review, có thể kiểm thử API, Web và worker bên trong overlay của **candidate cô lập** bằng `check-internal` rồi `deploy-internal`. Profile này dùng cùng image và stack contract ứng dụng, nhưng không thêm Traefik và không publish port. Nó vẫn cần `SWARM_PUBLIC_DOMAIN`, `SWARM_TLS_MODE`, `SWARM_TRAEFIK_IMAGE`, `SWARM_ADMIN_EMAIL` hợp lệ cho app preflight/CORS và hai Docker Secrets app độc lập; certificate/key chưa cần. Không dùng đây làm đường truy cập cho người dùng hoặc claim full deployment.

```text
node runtime/swarm.mjs check-internal
node runtime/swarm.mjs deploy-internal
```

Sau khi app nội bộ đã có, `deploy` data-only sẽ từ chối để tránh xóa app services. `deploy-internal` cũng từ chối nếu HTTPS edge đã tồn tại. Các smoke script `runtime/swarm-smoke.cjs` và `runtime/swarm-fixture.mjs` chỉ dành cho candidate `OFFLINE_DEMO`; script đầu kiểm tra API bằng secret gắn trong container và vô hiệu hóa analyst test, script sau inject 4 event synthetic trực tiếp vào Kafka, **bỏ qua Source Connector**. Chúng cần acknowledgement tương ứng `SWARM_SMOKE_ACK=OFFLINE_DEMO_INTERNAL` và `SWARM_FIXTURE_ACK=OFFLINE_DEMO_SYNTHETIC` khi chạy trong container, không được chạy trên live.

Khi deploy image GHCR private, launcher dùng `docker stack deploy --with-registry-auth` để Swarm task có quyền pull. Với Kafka broker/controller single-node, quorum dùng `127.0.0.1:9093`; healthcheck dùng TCP local vì Kafka admin CLI phụ thuộc advertised hostname Swarm trước khi service healthy. Web dùng Swarm `volumes` kiểu `tmpfs` cho `/tmp` vì top-level Compose `tmpfs` không được `docker stack deploy` đưa vào service spec. API bật worker health probe và các worker mở cổng health nội bộ `32110` để endpoint readiness có ý nghĩa thực.

Trạng thái 2026-10-13: đã có **phase 1 OFFLINE_DEMO data substrate**, overlay ứng dụng và HTTPS edge local được kiểm thử trên single-node; chưa phải hệ thống Swarm đầy đủ hoặc production. [Backbone DEC-126–130](../../System_Backbone/docs/governance/DOCKER_SWARM_DEPLOYMENT_BASELINE_V1.md) là baseline; [DEC-125](../../System_Backbone/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) kiểm soát authoritative cutover. Ngày 2026-10-15, operator xác nhận demo Compose cũ đã dừng và bỏ dữ liệu, không có authoritative state cần chuyển hay rollback; đường triển khai Compose cũ được gỡ khỏi repo. Git history giữ provenance, **không** phải rollback runtime hiện hành. Quyết định bỏ demo này không chứng nhận các gate Swarm cutover/production của DEC-125/126 và không cho phép xóa state authoritative của môi trường khác.

Lần chạy candidate đầu tiên ngày 2026-10-13: PostgreSQL và bootstrap schema hoàn thành, nhưng Kafka không healthy vì controller và healthcheck tự truy vấn DNS `kafka` trước khi Swarm công bố task. Sau khi sửa hai chỗ này, candidate `funnelmetry-swarm-candidate` trên máy hiện tại đã có PostgreSQL/Kafka healthy, marker bootstrap bằng 1 và đủ 9 topic. Candidate này sau đó đã chạy `deploy-internal` với API/UI/8 worker; kết quả cụ thể ở [báo cáo validation](SWARM_CANDIDATE_VALIDATION_2026-10-13.md). Cả hai candidate được kiểm thử đều chưa bật live feed. Job một lần như `bootstrap`, `kafka-topics` hoặc `profile-publisher` có thể hiển thị `0/1` sau khi hoàn thành; xem task `Complete` và log để phân biệt với lỗi. Stateful services dùng restart policy `any` để hồi phục sau lần Docker dừng sạch.

## Phase 1 đã có trong code

- [`infra/swarm-stack.yml`](../infra/swarm-stack.yml): PostgreSQL, Kafka, bootstrap schema và Kafka topic init trên overlay network riêng; không public port, không có Source Connector live. Stateful services ràng buộc vào node có label `funnelmetry.stateful=true`; local named volumes chỉ bảo vệ khi task ở **cùng node**, không tạo HA cho DB/Kafka.
- Kafka KRaft một node dùng `127.0.0.1:9093` cho controller nội bộ; broker vẫn quảng bá `kafka:9092` cho client trên overlay. Healthcheck khởi động chỉ kiểm tra TCP listener cục bộ; lệnh Kafka AdminClient (`kafka-topics`) phải chạy **sau** khi service healthy và DNS `kafka` đã xuất hiện. Không dùng DNS `kafka` trong controller hoặc healthcheck vì sẽ gây vòng lặp khởi động.
- [`runtime/swarm.mjs`](../runtime/swarm.mjs): lệnh `check`, `create-db-secret`, `deploy` chạy được trên Windows/Linux từ **cùng một** `runtime/deploy.env` cục bộ. `check` chỉ render stack. `create-db-secret` gửi password mới vào Docker qua stdin, không ghi plaintext vào Compose/YAML/CLI arguments. Secret hiện có sẽ không bị ghi đè. `deploy` không tạo/đổi secret hoặc đụng Compose stack.
- [`runtime/swarm-preflight.mjs`](../runtime/swarm-preflight.mjs): yêu cầu stack name riêng, mode `OFFLINE_DEMO`, image ứng dụng GHCR pin full Git SHA/digest và image stateful pin digest. Đây là kiểm tra cú pháp/thẩm quyền tĩnh, **không** chứng minh image đã được push hoặc source/digest khớp nhau.
- Bootstrap chỉ cài trên DB mới trống. DB có schema/digest khác sẽ dừng để người vận hành review; không xóa dữ liệu. Launcher tính digest từ SQL trong checkout và bootstrap so khớp với SQL đóng gói trong image trước khi ghi DB. Sau schema, bootstrap cài ba analytical releases; chỉ ghi `swarm_release_bootstrap` khi các binding/release đã được kiểm tra thành công. Topic init không tự repartition hay đổi cleanup policy của topic đã có.
- [`infra/docker/swarm-readiness.mjs`](../infra/docker/swarm-readiness.mjs) là startup gate dành cho API/worker Swarm: phải có schema READY, analytical release marker, đúng digest đã duyệt và đủ Kafka topics. Lệnh `deploy` chỉ dựng data substrate; `deploy-internal` thêm API/UI/worker không publish port; `deploy-app` thêm cả HTTPS edge.

Stack **data-only** phase 1 không chứa API/UI hoặc worker. Candidate local đã triển khai/kiểm thử API/UI và worker xử lý nội bộ bằng `deploy-internal`, rồi thêm Traefik HTTPS qua `deploy-app`. URL `https://funnelmetry.local/healthz`, `/` và `/login` trả 200 với TLS được Windows tin cậy; `/api/auth/me` chưa có token trả 401 đúng kỳ vọng. Đây chỉ là đường local, không chứng minh truy cập từ máy khác hoặc domain công khai. Source Connector live, catalog synchronization, Qwen, monitoring, autoscaler và Recovery Controller chưa có trong Swarm candidate; chưa được gọi là full capability. Medusa chưa xác nhận `event_feed_id`, `initial_after_seq` và retention floor nên live connector cố ý không nằm trong overlay. Không chạy cùng lúc hai hệ thống ghi vào state authoritative.

## Fresh PARALLEL_LIVE candidate (chưa phải cutover)

Nếu chỉ nâng cấp Canonical Normalizer, đặt `SWARM_NORMALIZER_IMAGE` thành digest Workers đã kiểm chứng trong `runtime/deploy.env`; các worker khác tiếp tục dùng `SWARM_WORKERS_IMAGE`. Để trống override trên stack mới nếu muốn dùng chung image. Thay env không tự cập nhật service đang chạy: cần rollout có kiểm soát, kiểm tra health/Kafka lag và chuẩn bị digest cũ để rollback. `SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE` chỉ nhận số nguyên 1–256.

`runtime/swarm.mjs` hỗ trợ mode `PARALLEL_LIVE` cho **stack mới** với DB/Kafka/cursor riêng. Trước khi bật, xác minh read-only Feed trả đúng `event_feed_id`, retention floor, latest sequence và `initial_after_seq` còn trong vùng giữ liệu; dùng connector ID mới khác môi trường cũ. Không gắn Feed vào stack `OFFLINE_DEMO` đã có synthetic data. Đặt `SWARM_LIVE_ACK=FRESH_PARALLEL_LIVE`, `SWARM_CONNECTOR_ID`, `SWARM_FEED_URL/ID/INITIAL_AFTER_SEQ`, `SWARM_DASHSCOPE_BASE_URL` trong `runtime/deploy.env` (ignored); credential Feed/Qwen dùng `SWARM_FEED_TOKEN`, `SWARM_DASHSCOPE_API_KEY` **chỉ để tạo Docker Secrets**, không đưa vào stack spec. Catalog và order reference lấy qua CDC, không cần Medusa Admin API key hoặc `catalog-sync`. Nếu giá trị secret thay đổi, cần rotation có kế hoạch; lệnh tạo không overwrite.

Overlay `infra/swarm-live.yml` nối Source Connector, Catalog Sync và Qwen/Polars API vào cùng stack. Chạy `check-app`, sau đó `create-db-secret`, `create-app-secrets`, `create-live-secrets`, `create-tls-secrets`, `deploy` data substrate và `deploy-app` sau khi bootstrap/topic jobs hoàn thành. `create-db-secret` và `create-app-secrets` tự sinh giá trị độc lập nếu `SWARM_*` tương ứng để trống; các credential mới được lưu local trong `runtime/credentials/<stack>-*` (ignored), không in ra console. **Sao lưu chúng vào secret manager được phê duyệt trước khi coi đây là deployment có khả năng restore; file ignored không phải backup.** TLS PEM phải đặt ngoài repo. Image API/Workers phải được build từ đúng commit có overlay/bootstrap mới và pin digest/commit tương ứng; image candidate cũ không hỗ trợ mode này.

Prometheus/Grafana là overlay tùy chọn `infra/swarm-monitoring.yml`: sau khi API healthy, chạy `create-monitoring-secrets` để phát hành credential metrics-only, kiểm tra endpoint rồi lưu token/metadata/password/dashboard vào `runtime/monitoring/swarm/` (ignored). Sau đó đặt `SWARM_MONITORING_ENABLED=true`, `check-app` và `deploy-app` lại. Prometheus/Grafana chỉ nằm trong overlay private; Prometheus target phải `up=1`, Grafana dashboard và datasource phải được kiểm tra bằng API nội bộ. Credential mặc định hết hạn sau 7 ngày, **phải có kế hoạch rotation**; không coi file ignored là backup. Hai controller Swarm hiện có [host-side vertical slice cho canonical-normalizer](../tools/swarm-controllers/README.md): policy/actuator có unit test và live read-only observation; healthcheck đã deploy và Swarm Level-1 replacement qua SIGKILL/unhealthy, nhưng chưa có policy-triggered Level-2 recovery hoặc scale acceptance trên stack live, chưa bật runner nền hoặc metrics scrape. Không gọi stack là “full capability” hoặc xóa stack cũ theo điều kiện nghiệm thu chỉ vì mã controller đã tồn tại.

## Lớp ứng dụng HTTPS tùy chọn, vẫn cùng một Swarm stack

[`infra/swarm-workers.yml`](../infra/swarm-workers.yml) và [`infra/swarm-app.yml`](../infra/swarm-app.yml) thêm worker, API và Web trên mạng overlay nội bộ. Launcher chọn **một** edge theo `SWARM_TLS_MODE`: [`local`](../infra/swarm-edge-local.yml), [`acme`](../infra/swarm-edge-acme.yml) hoặc [`tunnel`](../infra/swarm-edge-tunnel.yml). Traefik dùng file provider, không gắn Docker socket vào edge, API hay Agent. Hostname lấy từ `SWARM_PUBLIC_DOMAIN` trong `runtime/deploy.env`, không hard-code trong stack. Đường `/api/` được Web proxy tới API nội bộ.

- `local`: dùng `funnelmetry.local` hoặc hostname nội bộ cấu hình trong env, certificate/key đã được máy demo tin cậy. Đặt hai PEM ở đường dẫn tuyệt đối **ngoài repository**, sau đó chạy `create-tls-secrets`; private key không đưa vào Git/chat. Máy truy cập phải resolve hostname về edge node và tin cậy CA/certificate. Chỉ cổng 443 được publish.
- `acme`: cần domain public đã trỏ DNS tới edge node và TCP 80/443 thông từ Internet. Sau khi xác nhận, đặt `SWARM_ACME_READY_ACK=DNS_AND_PORTS_CONFIRMED`; nếu thiếu, `deploy-app` từ chối. `SWARM_ACME_EMAIL` là email đăng ký Let's Encrypt; Traefik tự xin/gia hạn cert, lưu ACME state trong volume gắn với node `funnelmetry.edge=true`. Chỉ gắn label edge cho một node giữ volume này trong profile hiện tại. Local volume không tạo node HA, nên phải có kế hoạch backup/chuyển node trước khi đổi placement.
- `tunnel`: Cloudflare Tunnel cung cấp HTTPS public cho `SWARM_PUBLIC_DOMAIN`; origin Traefik dùng HTTP tại `SWARM_TUNNEL_ORIGIN_PORT` (mặc định `31080`). Published application route của `analyst.entidi.io.vn` trỏ tới `http://localhost:31080`, giống cách route Medusa `api`/`store` tới HTTP origin. Không tạo TLS secrets hay mở 80/443 cho Pipeline. **Swarm host-mode publish không hỗ trợ bind riêng `127.0.0.1`; Docker published port có thể vượt qua UFW.** Phải chặn kết nối từ mạng ngoài tới origin port bằng provider firewall hoặc Docker-aware firewall, xác minh từ một máy bên ngoài, rồi mới đặt `SWARM_TUNNEL_ORIGIN_RESTRICTED_ACK=ORIGIN_FIREWALL_VERIFIED` để `deploy-app` cho phép chạy. Giữ tunnel connector trên cùng máy hoặc một private boundary tương đương; không coi origin HTTP là endpoint public.

  Trên Linux host dùng iptables, [`infra/firewall/restrict-tunnel-origin.sh`](../infra/firewall/restrict-tunnel-origin.sh) thêm rule idempotent ở cả `DOCKER-USER` và `INPUT` cho IPv4/IPv6; [`infra/firewall/funnelmetry-origin-firewall.service`](../infra/firewall/funnelmetry-origin-firewall.service) chạy lại khi Docker khởi động. Cài script vào `/usr/local/sbin/funnelmetry-restrict-tunnel-origin`, unit vào `/etc/systemd/system/`, và tạo `/etc/funnelmetry/origin-firewall.env` với `FUNNELMETRY_ORIGIN_PORT=<SWARM_TUNNEL_ORIGIN_PORT>` và `FUNNELMETRY_EXTERNAL_INTERFACE=<public-interface>`, quyền `600`. Sau `systemctl daemon-reload && systemctl enable --now funnelmetry-origin-firewall.service`, xác minh rule, chạy một HTTP origin probe không chứa dữ liệu nhạy cảm và kiểm tra từ bên ngoài rằng direct `http://<VPS-IP>:<port>` thất bại trong khi tunnel HTTPS vẫn hoạt động. Không dùng UFW như bằng chứng duy nhất: Docker published port có thể bỏ qua UFW.

Trên single-node candidate, gắn thêm `docker node update --label-add funnelmetry.edge=true <NODE_ID>` sau khi kiểm tra host port/firewall. Chọn Traefik image có **tag + digest** đã xác minh, và set `SWARM_ADMIN_EMAIL`, `SWARM_JWT_SECRET`, `SWARM_ADMIN_PASSWORD` mới, độc lập với Compose. Sau `create-db-secret`/`deploy` của data phase, thao tác tiếp theo trên manager là:

```text
node runtime/swarm.mjs check-app
node runtime/swarm.mjs create-app-secrets
node runtime/swarm.mjs create-tls-secrets   # chỉ local; tunnel không cần
node runtime/swarm.mjs deploy-app
```

`check-app` chỉ render. `deploy-app` không tạo secret và chưa xác nhận TLS: kiểm tra `docker stack services`, task/log `edge`, `dashboard-api`, `dashboard-web`, worker, rồi truy cập `https://<SWARM_PUBLIC_DOMAIN>/healthz` từ client có trust cert. Sau khi đã có `edge`, lệnh data-only `deploy` sẽ từ chối để tránh vô tình xóa dịch vụ ứng dụng. Không chạy `deploy-app` nếu chưa xác nhận DNS/port/certificate hoặc image provenance. Static render pass không chứng minh cert được cấp hay worker đã xử lý event. YAML worker khai báo `/healthz` liveness-only cho bảy worker chạy liên tục. Bản cập nhật 2026-10-14 đã deploy và bảy worker báo healthy; chỉ normalizer có fault-test, sáu worker còn lại chưa có fault-injection acceptance riêng. `/readyz` vẫn là tín hiệu quan sát, không dùng làm healthcheck thay task. Chi tiết: [autoscale/health follow-up](SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).

## Chuẩn bị một Swarm candidate mới

1. Trên một **single-node Swarm manager** mới/riêng, `docker swarm init` nếu máy chưa vào Swarm; xem `docker node ls`, rồi gắn label `docker node update --label-add funnelmetry.stateful=true <NODE_ID>` cho chính manager sẽ giữ volume. Launcher phase 1 từ chối manager không có label này. Kiểm tra chỗ lưu dữ liệu, dung lượng và backup trước khi tạo stateful volume. Không tái sử dụng DB/Kafka volume hoặc Source Connector cursor của Compose.
2. Build/push API và Workers từ **đúng commit** chứa `bootstrap-swarm.mjs`, `swarm-entrypoint.mjs` và `swarm-kafka-topics.mjs`; kiểm tra digest và pull quyền truy cập registry trên node. `SWARM_WEB_IMAGE` cũng phải trỏ tới image pin cho kế hoạch đầy đủ, nhưng Web chưa chạy ở phase 1. Image API/Workers GHCR cũ không chứa script này sẽ không hoạt động. PostgreSQL/Kafka dùng image upstream có tag **và digest** đã xác minh; không dùng `latest`.
3. Tạo `runtime/deploy.env` từ [`runtime/deploy.env.example`](../runtime/deploy.env.example) trên máy đích. Điền `SWARM_STACK_NAME` riêng, `SWARM_MIGRATION_MODE=OFFLINE_DEMO`, các image refs `SWARM_*_IMAGE` và để launcher tạo DB password mới hoặc điền `SWARM_DB_PASSWORD` độc lập. Giữ file ngoài Git, không gửi file hoặc giá trị secret qua chat. Nếu registry private, cần cấp quyền pull cho Swarm nodes theo cơ chế registry credentials được phê duyệt trước khi deploy.
4. Tại thư mục `Streaming_Pipeline`, chạy các lệnh giống nhau trên PowerShell hoặc shell Linux:

   ```text
   node --test infra/bootstrap/bootstrap-swarm.test.mjs infra/docker/swarm-entrypoint.test.mjs infra/docker/swarm-kafka-topics.test.mjs runtime/swarm-preflight.test.mjs runtime/swarm.test.mjs
   node runtime/swarm.mjs check
   node runtime/swarm.mjs create-db-secret
   node runtime/swarm.mjs deploy
   ```

   `check` không thay đổi Docker. Hai lệnh cuối chỉ dùng trên manager dành cho candidate sau khi xác nhận stack name/node/volumes. Chúng không tự chạy trong demo Compose.

5. Kiểm tra `docker stack services <SWARM_STACK_NAME>`, `docker service ps <SWARM_STACK_NAME>_postgres`, `docker service ps <SWARM_STACK_NAME>_kafka`, `docker service logs <SWARM_STACK_NAME>_bootstrap` và `docker service logs <SWARM_STACK_NAME>_kafka-topics`. Bootstrap/topic task phải hoàn thành thành công; DB/Kafka phải healthy. Sau đó mới chạy smoke end-to-end khi các ứng dụng Swarm được đưa vào stack.

Không thực hiện `docker stack rm`, xóa volume/secret, chuyển live feed hay cutover tự động. Cần runbook riêng cho backup/restore và rehearsal theo DEC-125 trước khi thay Compose. `docker stack deploy` không đọc `runtime/deploy.env` tự động; launcher Node truyền chỉ các biến render cần thiết và không in cấu hình/secret đã render.

Ứng dụng Node hiện còn nhận secret qua biến môi trường, nên `swarm-entrypoint.mjs` đọc secret mount rồi chuyển vào **process con trong container**. Stack/service spec không chứa plaintext, nhưng process có quyền cao trên host vẫn có thể thấy môi trường tiến trình; không xem đây là hardening cuối cùng cho production.

## Việc còn thiếu để hoàn thành migration

API/UI/worker nội bộ đã được kiểm chứng bằng image GHCR pin digest và event synthetic; HTTPS edge local đã qua smoke trên máy này, nhưng chưa có bằng chứng live Source Connector hoặc truy cập HTTPS từ client ngoài máy. Cần kiểm chứng task identity khi scale; nối live/catalog/Qwen bằng secrets riêng; monitoring Swarm; stateless autoscale có actuator giới hạn quyền; Recovery Controller phân biệt lỗi ứng dụng và lỗi task; kiểm thử scale, rolling rollback, node failure, replay/restore, backup và authoritative cutover. CPU/RAM trong stack hiện là ngưỡng **EXPERIMENTAL**, cần đo capacity trước khi dùng cho multi-node hay production. Không claim stateful HA từ Swarm một node.
