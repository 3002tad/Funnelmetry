# Docker Swarm migration

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

Trạng thái 2026-10-13: đã có **phase 1 OFFLINE_DEMO data substrate**, overlay ứng dụng và HTTPS edge local được kiểm thử trên single-node; chưa phải hệ thống Swarm đầy đủ hoặc production. [Backbone DEC-126–130](../../System_Backbone/docs/governance/DOCKER_SWARM_DEPLOYMENT_BASELINE_V1.md) là baseline; [DEC-125](../../System_Backbone/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) kiểm soát cutover. [`infra/legacy/compose.yaml`](../infra/legacy/compose.yaml) và [`runtime/deploy.mjs`](../runtime/deploy.mjs) chỉ còn là artifact rollback/provenance, **không phải đường chạy demo hay triển khai mới**. Launcher Compose bị khóa mặc định; không chạy hai hệ cùng ghi state.

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

`runtime/swarm.mjs` hỗ trợ mode `PARALLEL_LIVE` cho **stack mới** với DB/Kafka/cursor riêng. Trước khi bật, xác minh read-only Feed trả đúng `event_feed_id`, retention floor, latest sequence và `initial_after_seq` còn trong vùng giữ liệu; dùng connector ID mới khác Compose. Không gắn Feed vào stack `OFFLINE_DEMO` đã có synthetic data. Đặt `SWARM_LIVE_ACK=FRESH_PARALLEL_LIVE`, `SWARM_CONNECTOR_ID`, `SWARM_FEED_URL/ID/INITIAL_AFTER_SEQ`, `SWARM_CATALOG_URL`, `SWARM_DASHSCOPE_BASE_URL` trong `runtime/deploy.env` (ignored); credential Feed/Catalog/Qwen hiện được đọc từ `HANDOFF_*` cùng file **chỉ để tạo Docker Secrets**, không đưa vào stack spec. Nếu giá trị secret thay đổi, cần rotation có kế hoạch; lệnh tạo không overwrite.

Overlay `infra/swarm-live.yml` nối Source Connector, Catalog Sync và Qwen/Polars API vào cùng stack. Chạy `check-app`, sau đó `create-db-secret`, `create-app-secrets`, `create-live-secrets`, `create-tls-secrets`, `deploy` data substrate và `deploy-app` sau khi bootstrap/topic jobs hoàn thành. `create-db-secret` và `create-app-secrets` tự sinh giá trị độc lập nếu `SWARM_*` tương ứng để trống; các credential mới được lưu local trong `runtime/credentials/<stack>-*` (ignored), không in ra console. **Sao lưu chúng vào secret manager được phê duyệt trước khi coi đây là deployment có khả năng restore; file ignored không phải backup.** TLS PEM phải đặt ngoài repo. Image API/Workers phải được build từ đúng commit có overlay/bootstrap mới và pin digest/commit tương ứng; image candidate cũ không hỗ trợ mode này.

Prometheus/Grafana là overlay tùy chọn `infra/swarm-monitoring.yml`: sau khi API healthy, chạy `create-monitoring-secrets` để phát hành credential metrics-only, kiểm tra endpoint rồi lưu token/metadata/password/dashboard vào `runtime/monitoring/swarm/` (ignored). Sau đó đặt `SWARM_MONITORING_ENABLED=true`, `check-app` và `deploy-app` lại. Prometheus/Grafana chỉ nằm trong overlay private; Prometheus target phải `up=1`, Grafana dashboard và datasource phải được kiểm tra bằng API nội bộ. Credential mặc định hết hạn sau 7 ngày, **phải có kế hoạch rotation**; không coi file ignored là backup. Hai controller Swarm hiện có [host-side vertical slice cho canonical-normalizer](../tools/swarm-controllers/README.md): policy/actuator có unit test và live read-only observation; healthcheck đã deploy và Swarm Level-1 replacement qua SIGKILL/unhealthy, nhưng chưa có policy-triggered Level-2 recovery hoặc scale acceptance trên stack live, chưa bật runner nền hoặc metrics scrape. Không gọi stack là “full capability” hoặc xóa stack cũ theo điều kiện nghiệm thu chỉ vì mã controller đã tồn tại.

## Lớp ứng dụng HTTPS tùy chọn, vẫn cùng một Swarm stack

[`infra/swarm-workers.yml`](../infra/swarm-workers.yml) và [`infra/swarm-app.yml`](../infra/swarm-app.yml) thêm worker, API và Web trên mạng overlay nội bộ. Chỉ [`infra/swarm-edge-local.yml`](../infra/swarm-edge-local.yml) hoặc [`infra/swarm-edge-acme.yml`](../infra/swarm-edge-acme.yml) publish cổng. Launcher chọn **một** edge theo `SWARM_TLS_MODE`; Traefik dùng file provider, không gắn Docker socket vào edge, API hay Agent. Hostname lấy từ `SWARM_PUBLIC_DOMAIN` trong `runtime/deploy.env`, không hard-code trong stack. Đường `/api/` được Web proxy tới API nội bộ.

- `local`: dùng `funnelmetry.local` hoặc hostname nội bộ cấu hình trong env, certificate/key đã được máy demo tin cậy. Đặt hai PEM ở đường dẫn tuyệt đối **ngoài repository**, sau đó chạy `create-tls-secrets`; private key không đưa vào Git/chat. Máy truy cập phải resolve hostname về edge node và tin cậy CA/certificate. Chỉ cổng 443 được publish.
- `acme`: cần domain public đã trỏ DNS tới edge node và TCP 80/443 thông từ Internet. Sau khi xác nhận, đặt `SWARM_ACME_READY_ACK=DNS_AND_PORTS_CONFIRMED`; nếu thiếu, `deploy-app` từ chối. `SWARM_ACME_EMAIL` là email đăng ký Let's Encrypt; Traefik tự xin/gia hạn cert, lưu ACME state trong volume gắn với node `funnelmetry.edge=true`. Chỉ gắn label edge cho một node giữ volume này trong profile hiện tại. Local volume không tạo node HA, nên phải có kế hoạch backup/chuyển node trước khi đổi placement.

Trên single-node candidate, gắn thêm `docker node update --label-add funnelmetry.edge=true <NODE_ID>` sau khi kiểm tra host port/firewall. Chọn Traefik image có **tag + digest** đã xác minh, và set `SWARM_ADMIN_EMAIL`, `SWARM_JWT_SECRET`, `SWARM_ADMIN_PASSWORD` mới, độc lập với Compose. Sau `create-db-secret`/`deploy` của data phase, thao tác tiếp theo trên manager là:

```text
node runtime/swarm.mjs check-app
node runtime/swarm.mjs create-app-secrets
node runtime/swarm.mjs create-tls-secrets   # chỉ local
node runtime/swarm.mjs deploy-app
```

`check-app` chỉ render. `deploy-app` không tạo secret và chưa xác nhận TLS: kiểm tra `docker stack services`, task/log `edge`, `dashboard-api`, `dashboard-web`, worker, rồi truy cập `https://<SWARM_PUBLIC_DOMAIN>/healthz` từ client có trust cert. Sau khi đã có `edge`, lệnh data-only `deploy` sẽ từ chối để tránh vô tình xóa dịch vụ ứng dụng. Không chạy `deploy-app` nếu chưa xác nhận DNS/port/certificate hoặc image provenance. Static render pass không chứng minh cert được cấp hay worker đã xử lý event. YAML worker khai báo `/healthz` liveness-only cho bảy worker chạy liên tục. Bản cập nhật 2026-10-14 đã deploy và bảy worker báo healthy; chỉ normalizer có fault-test, sáu worker còn lại chưa có fault-injection acceptance riêng. `/readyz` vẫn là tín hiệu quan sát, không dùng làm healthcheck thay task. Chi tiết: [autoscale/health follow-up](SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).

## Chuẩn bị một Swarm candidate mới

1. Trên một **single-node Swarm manager** mới/riêng, `docker swarm init` nếu máy chưa vào Swarm; xem `docker node ls`, rồi gắn label `docker node update --label-add funnelmetry.stateful=true <NODE_ID>` cho chính manager sẽ giữ volume. Launcher phase 1 từ chối manager không có label này. Kiểm tra chỗ lưu dữ liệu, dung lượng và backup trước khi tạo stateful volume. Không tái sử dụng DB/Kafka volume hoặc Source Connector cursor của Compose.
2. Build/push API và Workers từ **đúng commit** chứa `bootstrap-swarm.mjs`, `swarm-entrypoint.mjs` và `swarm-kafka-topics.mjs`; kiểm tra digest và pull quyền truy cập registry trên node. `SWARM_WEB_IMAGE` cũng phải trỏ tới image pin cho kế hoạch đầy đủ, nhưng Web chưa chạy ở phase 1. Image API/Workers GHCR cũ không chứa script này sẽ không hoạt động. PostgreSQL/Kafka dùng image upstream có tag **và digest** đã xác minh; không dùng `latest`.
3. Tạo `runtime/deploy.env` từ [`runtime/deploy.env.example`](../runtime/deploy.env.example) trên máy đích. Điền `SWARM_STACK_NAME` khác `HANDOFF_PROJECT`, `SWARM_MIGRATION_MODE=OFFLINE_DEMO`, 5 image refs `SWARM_*_IMAGE`, và một `SWARM_DB_PASSWORD` mới khác `HANDOFF_DB_PASSWORD`. Giữ file ngoài Git, không gửi file hoặc giá trị secret qua chat. Nếu registry private, cần cấp quyền pull cho Swarm nodes theo cơ chế registry credentials được phê duyệt trước khi deploy.
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
