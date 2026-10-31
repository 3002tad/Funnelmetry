# CDC-14 — bằng chứng hợp nhất CDC runtime trên VPS

Ngày: 2026-10-31. Môi trường: VPS `kltn`, Pipeline branch
`feature/cdc-medusa-v1`. Trạng thái: **COMPLETE / PRIMARY CDC RUNTIME ACTIVE**.
Tài liệu kiểm kê trước chuyển:
[CDC14_RUNTIME_CONSOLIDATION_PLAN_2026-10-31.md](../../CDC14_RUNTIME_CONSOLIDATION_PLAN_2026-10-31.md).

## Chuẩn bị và cutover

- Tạo backup logic Pipeline DB và mapper DB ở
  `/srv/KLTN/.cdc14-backups/pre-cutover-9kGXSeg6`. Hai archive có TOC và
  SHA256; restore rehearsal vào PostgreSQL cô lập, không nối mạng, đã PASS.
- CI `Publish primary CDC Workers` run `41163709192` PASS. Image production:
  `ghcr.io/3002tad/funnelmetry-cdc-workers@sha256:03fa2f3639b8fe8cca6b7c13c912db8b6a29c11a3b402de55cc1a02c108d255c`.
  VPS đã pull đúng digest trước khi dừng service cũ. Launcher
  `runtime/cdc-live.mjs check` render PASS.
- Dừng quality monitor cũ, Connect cũ, bốn worker cũ và mapper DB cũ theo
  thứ tự; xác nhận cả bảy service `funnelmetry_cdc_target_shadow_*` ở `0/0`
  trước khi deploy. `funnelmetry_cdc` sau đó hội tụ **sáu service 1/1**.
  Không có hai Connect/writer cùng slot hoặc consumer group chạy đồng thời.
- Stack mới giữ source ID `medusa-reference`, ba coverage epoch, publication,
  slot, topic, consumer group, hai Docker secret và volume mapper vật lý
  `funnelmetry_cdc_target_shadow_order-mapper-data`. Tên vật lý có chữ
  `shadow` được giữ để bảo toàn state/offset; mode worker là
  `ACTIVE_REFERENCE_V2`. Thay tên vật lý cần epoch/snapshot riêng.
- Quality monitor mới chạy bằng
  `tools/cdc-operations/monitor-quality.py` và profile ở
  `/etc/funnelmetry/cdc/profiles`. Unit cũ đã dừng, disable và gỡ.

## Đối soát sau chuyển

| Gate | Kết quả |
|---|---|
| CDC service | `funnelmetry_cdc` có 6/6 service `1/1`; stack `target_shadow` đã gỡ. |
| Catalog | 104 sản phẩm, source/projection digest bằng nhau, offset bắt kịp. |
| Inventory/price | 16 bảng, row key/thuộc tính/soft delete khớp nguồn, offset bắt kịp. |
| Order | 187 current-state records, source/mapper/sink digest bằng nhau, fact offset 376. |
| Connect/slot | Ba connector RUNNING, slot usable; WAL headroom tối thiểu 1025 MiB, không có alert slot. |
| Quality | `PASS_ACTIVE_DRY_RUN` và nhiều chu kỳ `PASS_ACTIVE_LEASE` (240 giây). |
| Public endpoints | `analyst/healthz`, `ingest/healthz`, `api/health` đều HTTP 200. |
| Event sau cutover | Tạo đúng một giỏ hàng rỗng `cart_01M680H38W46ZEY5EHGC3KEXA6` qua Store API; Kafka topic `cdc_shadow_medusa_order_v2_e1.public.cart` tăng end offset 559→560, mapper applied offset cũng 560. Transaction offset 1864→1866. Order count 187/fact offset 376 giữ nguyên vì không checkout; quality `PASS_ACTIVE_LEASE` sau event. |

Giỏ hàng rỗng chỉ kiểm tra tuyến CDC cart và tính liên tục offset sau cutover;
không chứng minh một order mới hay tải flash-sale. Các ca checkout/order,
update catalog, replay và recovery đã có bằng chứng riêng ở CDC-10/11/12;
CDC-14 không lặp lại chúng.

## Dọn dẹp và giữ lại

- Đã gỡ stack `funnelmetry_cdc_target_shadow` (bao gồm candidate-schema 0/0)
  và private overlay cũ; mapper volume vẫn tồn tại và được stack mới mount.
- Dựa trên JSON inventory cùng kiểm tra state, Compose label, mount và owner:
  xóa đúng 54 exited test containers, 31 named test volumes, 5 test bridge
  networks. Sáu anonymous volumes không có container owner được xóa; năm
  anonymous volumes gắn Connect/Kafka live được giữ.
- Gỡ 24 image test/rollback sau khi xác nhận không service/container nào
  tham chiếu. Các image còn lại thuộc runtime hoặc cần kiểm tra provenance;
  không dùng `image prune` tổng quát.
- Xóa tám checkout clone/rollback sau khi kiểm tra bind mount, systemd unit và
  process cwd; gỡ unit `funnelmetry-cdc10-recovery-verify.service` đã fail và
  disabled. Mười một script/profile tạm đã chuyển vào
  `/srv/KLTN/.cdc14-backups/legacy-operator-artifacts` (backup, không còn ở
  runtime root). Các script thao tác chuẩn nằm trong repo
  `tools/cdc-operations/`.
- Giữ `/srv/KLTN/.cdc11-backups`, `.cdc11-source-state`,
  `.cdc-target-shadow.env` ở quyền hạn hiện có để truy vết/phục hồi; hai
  `.cdc11-medusa-*.yml` vẫn là Compose overlay live của Medusa. Runtime mới
  đọc `runtime/cdc-live.env` ignored trên VPS; profile mới nằm trong
  `/etc/funnelmetry/cdc/profiles`.
- Cuối phiên: 2 Swarm stacks (`funnelmetry_cdc` sáu service,
  `funnelmetry_vps_live` 17 service), 11 volumes, 10 networks, 36 container
  records gồm task history/one-shot, 30 image IDs. Không coi task history
  exited của Swarm là clone còn chạy.

## Vận hành tiếp

`runtime/cdc-live.mjs check|deploy` đọc `runtime/cdc-live.env`; `deploy` từ
chối nếu stack cũ còn desired replicas khác `0/0`. Chỉ có một owner CDC cho
mỗi slot/group. Quality monitor systemd:
`funnelmetry-cdc-quality.service`. Source Ingress/Event Feed vẫn phục vụ
behavioral traffic; Gateway HTTP là công việc riêng. Không đổi semantic
contract `order_recorded_state.v2`, metadata binding hay khôi phục backend
message/Admin API pull.
