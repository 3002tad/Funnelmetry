# CDC-14 — hợp nhất CDC runtime và dọn tài nguyên thử nghiệm trên VPS

Trạng thái: **COMPLETE / PRIMARY CDC RUNTIME ACTIVE**
(2026-10-31, VPS `kltn`). Phần kiểm kê bên dưới là baseline trước cutover;
kết quả thực thi nằm tại
[CDC14_RUNTIME_EXECUTION_2026-10-31.md](CDC14_RUNTIME_EXECUTION_2026-10-31.md).
Bản chụp tên từng tài nguyên trước cutover:
[CDC14_VPS_RESOURCE_INVENTORY_2026-10-31.json](CDC14_VPS_RESOURCE_INVENTORY_2026-10-31.json).
JSON chỉ chứa tên, trạng thái, image ID và đường dẫn; không chứa giá trị secret.

## Mục tiêu và ranh giới

Đưa sáu service CDC đang cấp dữ liệu Medusa về một deployment production được
quản lý rõ ràng bởi Pipeline, thay nhãn `target_shadow`/candidate và cấu hình
`SHADOW_ONLY` bằng contract runtime đã duyệt, không tạo writer/connector thứ
hai cùng slot hoặc consumer group. Sau khi cutover và đối soát, dọn container,
volume, network, image và checkout thử nghiệm không còn được tham chiếu.
PostgreSQL Medusa vẫn là nguồn; PostgreSQL/Kafka Pipeline và Source Ingress
behavioral tiếp tục hoạt động. Gateway HTTP là dự án riêng, không thuộc CDC-14.

## Kiểm kê read-only trên VPS

| Nhóm | Ghi nhận | Xử lý CDC-14 |
|---|---|---|
| Swarm services | 24 service: 7 thuộc `funnelmetry_cdc_target_shadow` (6 chạy 1/1, `candidate-schema` 0/0), 17 thuộc `funnelmetry_vps_live`. | Chuyển 6 CDC service vào định nghĩa production; bỏ candidate job sau khi xác minh migration journal. Ba job main 0/1 là `bootstrap`, `kafka-topics`, `profile-publisher`, task đã Complete; không coi là lỗi runtime. |
| Containers | 98 bản ghi: 26 đang chạy và 72 exited. Trong 72 exited có 54 container từ 5 Compose clone test, 8 task history của CDC target và 10 task history/one-shot của stack main. | Xóa chính xác clone đã dừng; Swarm task history có thể tiếp tục xuất hiện sau rollout nên không lấy “0 exited” làm tiêu chí. |
| Compose | 3 project chạy: tunnel, Source Ingress, Medusa. 5 project test đã exited. | Giữ 3 project live; đối chiếu rồi `down` từng project test với đúng tập compose file. |
| Volumes | 77 volume: 37 có tên, 40 anonymous. Trong volume có tên, 31 thuộc clone shadow cũ; `funnelmetry_cdc_target_shadow_order-mapper-data` là **state live** của mapper DB. | Không chạy `volume prune` hoặc `down -v` tổng quát. Đối chiếu mount/backup từng volume trước khi xóa; giữ mapper data qua cutover. |
| Networks | 15 network: 5 bridge của clone test; `funnelmetry_cdc_source` và `funnelmetry_cdc_target_shadow_mapper_data` là mạng CDC đang dùng. | Xóa network clone chỉ sau khi container phụ thuộc đã hết; giữ/migrate hai mạng live theo deployment mới. |
| Secrets | 6 Docker secret chỉ được kiểm kê tên. `funnelmetry_cdc_target_shadow_mapper_db_password_v1` đang phục vụ mapper DB. | Giữ tới khi service mới dùng secret production được kiểm chứng; không đọc hoặc ghi giá trị vào tài liệu. |
| Images | 53 image entries, gồm image live vẫn mang chữ `candidate` và nhiều image clone test. | Đối chiếu digest đang được service/container tham chiếu; chỉ gỡ image không còn dùng, không `image prune -a` mù. |

### Sáu service CDC đang chạy — tuyệt đối giữ đến khi cutover

| Service hiện tại | Vai trò | State/phụ thuộc cần giữ |
|---|---|---|
| `funnelmetry_cdc_target_shadow_connect` | Debezium Connect đọc Medusa WAL | Publication/slot, connector config, Kafka Connect internal topics và source network. |
| `funnelmetry_cdc_target_shadow_catalog-writer` | CDC catalog → Pipeline PostgreSQL | Consumer group, offsets, catalog projection/quality lease. |
| `funnelmetry_cdc_target_shadow_inventory-price-writer` | CDC inventory/price → Pipeline PostgreSQL | Consumer group, offsets, context projection/quality lease. |
| `funnelmetry_cdc_target_shadow_order-mapper` | DB changes → order state records | Consumer group, epoch, mapper DB và fact topic. |
| `funnelmetry_cdc_target_shadow_order-mapper-db` | Durable state/order mapper | Volume `funnelmetry_cdc_target_shadow_order-mapper-data`, mapper DB secret và private network. |
| `funnelmetry_cdc_target_shadow_order-sink` | Order state records → Pipeline PostgreSQL | Consumer group, inbox/current state/sink offsets và quality state. |

`funnelmetry_cdc_target_shadow_candidate-schema` là service migration cũ
`0/0`, không phải worker live. `funnelmetry_vps_live_postgres`,
`funnelmetry_vps_live_kafka`, API/Web/Workers/Edge, `funnelmetry_source_ingress`,
`medusa_reference` và `funnelmetry-tunnel` là thành phần chính cần giữ.

### Compose clone đã dừng

| Project | Exited containers | Nguồn config trên VPS |
|---|---:|---|
| `funnelmetry_cdc_catalog_shadow_catalog1` | 6 | `/srv/KLTN/cdc-shadow-catalog1` |
| `funnelmetry_cdc_combined_shadow_c1` | 10 | `/srv/KLTN/Funnelmetry-cdc-combined/tools/medusa-reference-cdc-shadow` |
| `funnelmetry_cdc_inventory_price_shadow_stage2a` | 8 | `/srv/KLTN/cdc-shadow-inventory-price1` |
| `funnelmetry_cdc_inventory_price_shadow_stage2b` | 9 | `/srv/KLTN/cdc-shadow-inventory-price2` |
| `funnelmetry_cdc_shadow_cdc10` | 21 | `/srv/KLTN/cdc-shadow` và `/srv/KLTN/cdc-shadow-cdc10` |

Ngoài 54 container trên, các volume tên `funnelmetry_cdc_shadow_*` còn
tồn tại dù project gốc đã ngừng. Năm bridge network clone tương ứng cũng còn.
Danh sách **từng container, volume, network và image** nằm trong JSON inventory.

### Checkout và tệp tạm trên VPS

- **Giữ live/reserved:** `/srv/KLTN/Funnelmetry-cdc-profile` (Source Ingress và
  config Pipeline hiện hành), `/srv/KLTN/dtc-starter-funnelmetry`,
  `/srv/KLTN/Funnelmetry` (đối chiếu trước khi gỡ), `/srv/KLTN/DB-GPT`,
  `/srv/KLTN/cloudflared.compose.yml`, `/srv/KLTN/.cdc-target-shadow.env`,
  `/srv/KLTN/.cdc11-medusa-network.yml` và
  `/srv/KLTN/.cdc11-medusa-logical.yml`. Hai overlay Medusa hiện nằm trong
  Compose live.
- **Clone/backup cần rà soát rồi dọn:** `/srv/KLTN/cdc-shadow`,
  `cdc-shadow-cdc10`, `cdc-shadow-catalog1`,
  `cdc-shadow-inventory-price1`, `cdc-shadow-inventory-price2`,
  `Funnelmetry-cdc-combined`, `dtc-starter-funnelmetry-pre-cdc12`.
  `Funnelmetry-cdc-workers-build` là checkout build, cần xác nhận image
  provenance trước khi lưu trữ/xóa. Các checkout này chiếm khoảng 25 MiB cộng
  lại theo `du -sh`; dữ liệu lớn nằm trong Docker volumes và chưa đo dung lượng.
- **Tệp/cụm tạm cần kiểm tra tham chiếu:** `.cdc11-topic-bootstrap`,
  `.cdc11-tools`, `.cdc11-profiles`, `.cdc11-source-state`,
  `.cdc11-backups`, `.cdc11-moving-probe`, `.cdc11-migration027`,
  `.cdc12-stage2`, `.cdc12-order-v2`,
  `.cdc12-catalog-service-before-20261030.json`,
  `.cdc11-install-target-source.py`,
  `.cdc11-check-cdc-source-config.mjs`,
  `.cdc11-funnel-api-query.sql`. Không xóa backup, profile, source state hoặc
  script bảo trì cho đến khi chuyển chức năng vào repo/runbook chính.

## Source/config trong repo cần chuyển khỏi nhánh “shadow”

1. [`infra/swarm-cdc-shadow.yml`](../infra/swarm-cdc-shadow.yml) hiện tạo
   **stack CDC live riêng** và service `candidate-schema`; cần định nghĩa
   production cho Connect, bốn worker và mapper DB trong deployment Pipeline,
   với image digest, secret, network, volume và startup/health rõ ràng.
2. [`workers/reference-order-cdc-v2-mapper/src/main.js`](../workers/reference-order-cdc-v2-mapper/src/main.js)
   và [`workers/reference-order-cdc-v2-sink/src/main.js`](../workers/reference-order-cdc-v2-sink/src/main.js)
   đang **từ chối mọi `REFERENCE_CDC_MODE` khác `SHADOW_ONLY`**. Cần contract
   runtime mới và test migration; thay tên env đơn thuần sẽ làm worker không khởi động.
3. Medusa manifest `Medusa_Reference/funnelmetry.integration.yaml` và
   [installer](../tools/medusa-ci-installer/src/manifest.mjs) còn key
   `cdc_*_shadow`, `mode: shadow_only`, topic `cdc_shadow_*`. Đây là tên
   vật lý/compatibility đang gắn slot, Kafka topic và offset. Không đổi ngầm
   tên topic, slot, epoch hoặc giả sử đổi tên tạo ra dữ liệu mới đầy đủ; nếu
   muốn tên sạch cần một profile/epoch versioned với snapshot/reconciliation.
4. [`tools/medusa-reference-cdc-shadow`](../tools/medusa-reference-cdc-shadow)
   gồm **cả** installer/monitor/quality scripts đang cần cho live lẫn fixture,
   probe và Compose clone lịch sử. Chuyển script live sang thư mục vận hành CDC
   chính, sửa hardcoded `funnelmetry_cdc_target_shadow_*` (nhất là
   `monitor-target-quality.py` và `target_shadow_workers.py`); giữ test
   conformance riêng/archived với nhãn rõ ràng. Không xóa cả thư mục.
5. Các migration `021`–`027` và bảng `*_candidate` đang chứa dữ liệu được
   đọc bởi API/quality gate. Tên không phải bằng chứng chúng đã vô dụng.
   Trước khi đổi tên schema cần mapping/view/version migration riêng và
   so sánh kết quả; không DROP bảng lịch sử.

## Trình tự thực hiện CDC-14

1. **Chốt baseline:** lưu inventory này, service spec/digest, connector config
   (không có credential), publication/slot, Kafka topics/consumer offsets,
   migration journal, bảng/quality lease và backup PostgreSQL/mapper volume.
   Xác minh có thể phục hồi từ backup trước khi đổi deployment.
2. **Chuẩn hóa source và deployment:** tạo production CDC overlay/stack cùng
   launcher/runtime config chính; đưa installer/monitor live vào đường chính,
   định nghĩa mode runtime mới theo DEC-142 mà không đổi semantic contract
   `order_recorded_state.v2`. Chạy CI/render/test migration trên cấu hình này.
   Quyết định rõ stack production đích và cách map volume/network/secret trước
   khi chạy; không chạy hai Connect/writer cùng identity song song.
3. **Cutover stop-first:** dừng sáu service `target_shadow` theo thứ tự an toàn,
   ghi offset/LSN/epoch cuối, khởi chạy service production dùng cùng state và
   chỉ **một** owner cho mỗi slot/topic/group. Kiểm tra lag, ordered replay,
   catalog/inventory/order projection và quality lease; API tiếp tục đọc đúng
   binding. Nếu có gap, xử lý bằng epoch/snapshot như DEC-142, không bật lại
   backend message hoặc Admin API pull.
4. **Dọn sau xác nhận:** gỡ service `candidate-schema`, stack `target_shadow`,
   5 Compose project exited, volume/network/image và checkout test theo allowlist
   đã đối chiếu. Sao lưu hoặc archive bằng chứng cần giữ trước khi xóa. Không
   dùng `docker system prune`, `volume prune` hay xóa thư mục theo wildcard.
5. **Đóng hồ sơ:** cập nhật Backbone, runbook, installer docs và inventory sau
   dọn; ghi chính xác volume/secret/slot/topic được giữ, cùng kết quả health,
   offset, reconciliation và dung lượng giải phóng.

## Điều kiện hoàn thành

- CDC Connect, catalog, inventory/price, order mapper, mapper DB và order sink
  nằm trong deployment production đã pin/version; không còn service live tên
  `target_shadow`. Không có hai writer/connector cùng identity tại bất cứ thời
  điểm nào. Mapper DB state và source WAL coverage liên tục hoặc có gap được
  khai báo/đã rebaseline.
- Source row counts/digest, Kafka offsets, order current-state/fact và quality
  lease đạt các gate hiện hành; Dashboard API và Source Ingress health đạt.
  Một event mới sau cutover được phản ánh ở projection tương ứng.
- 5 Compose clone test, container/network/volume riêng của chúng và checkout
  tạm được dọn hoặc ghi ngoại lệ có lý do. Không xóa volume main, mapper live,
  Kafka/PostgreSQL Pipeline, Source Ingress event log hay Medusa database.
- Runtime/installer không còn đường tạo backend order message hoặc gọi Admin
  API catalog. Lịch sử đã persist vẫn được giữ cho truy vấn/replay.

**Chưa được xác minh trong lần kiểm kê:** kích thước và chủ sở hữu của 40
anonymous volumes; mapping chính xác của mọi image cũ tới container/backup;
đường khôi phục mapper volume khi đổi stack; tất cả slot/topic/group và
connector config đang dùng. Các mục này là gate trước khi xóa hoặc chuyển
service, không phải lý do để coi một volume tên `shadow` là rác.
