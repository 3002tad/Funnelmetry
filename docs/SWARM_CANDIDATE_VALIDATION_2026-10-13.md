# Swarm candidate validation — 2026-10-13

## Phạm vi và trạng thái

- Máy: Docker Desktop local, single-node Swarm; stack `funnelmetry-swarm-offline-20261013`, mode `OFFLINE_DEMO`.
- Image API/Web/Workers: GHCR tag `sha-b45327cc430d35ae148a60d27dff66dc1ca5b596`; PostgreSQL 15, Kafka 3.9.1 pin digest. App và worker dùng overlay nội bộ, **không có published port**; không chạy Traefik, Source Connector hoặc live Event Feed.
- Docker Secrets DB/JWT/admin mới, riêng candidate; không ghi plaintext vào Git. Volume Compose cũ không được gắn/xóa. Stack candidate còn chạy sau kiểm thử để có thể đối chiếu tiếp.
- SSH tới `ubuntuserver` qua Tailscale đã xác nhận: host đó chạy Medusa, Source Ingress, Redis và PostgreSQL; Docker Swarm trên server vẫn inactive. Không triển khai Pipeline stack lên server Medusa.

## Bằng chứng đã qua

1. `docker stack services`: PostgreSQL, Kafka, API, Web và 8 worker liên tục đạt `1/1` sau khi readiness ổn định. `bootstrap`, `kafka-topics` và `profile-publisher` là one-shot job, task cuối cùng `Complete` exit 0 nên hiển thị `0/1` sau khi kết thúc.
2. DB candidate có `swarm_release_bootstrap` marker bằng 1 và 59 bảng; Kafka healthy, đủ 9 topic manifest. Bootstrap cài schema và ba analytical releases; profile publisher hoàn tất.
3. API container `/health` trả 200, admin login/`me`/registry/worker-readiness/Kafka lag trả 200. Worker readiness có đủ 7 worker `READY`, không phải `NOT_CONFIGURED`.
4. Analyst test tạm được tạo rồi vô hiệu hóa trong DB candidate. Catalog, overview, journeys, events, data-health, traffic-source registry và evidence endpoints đều trả 200; sau synthetic run, API overview còn trả profile `commerce-conversion` với `observed_converted >= 1`. Web `/healthz` và `/` trả 200; proxy `/api/auth/me` trả 401 khi không có token (đúng auth boundary, không phải 502).
5. Synthetic run `3ca911a6-86ea-4c0b-a89f-5ba515bedbf2` được publish **trực tiếp vào Kafka candidate**, gồm `behavior.product_viewed`, `cart.item_added`, `checkout.started`, `medusa.order_placed`. DB ghi 4 ingress receipts, 4 canonical events, 4 journey events cùng một journey; profile `commerce-conversion` đạt `CONVERTED`, KPI instance `4/4` bước. Canonical `order.placed` giữ `total_amount=20`, `currency_code=eur` và `cart_id` liên kết. Traffic writer ghi 2 browser events có `utm_source_state=PRESENT` (không lộ raw UTM trong bảng này).
   Run thứ hai `1aa1451d-dfed-412d-941e-44f1e8062826` xác nhận script đã có acknowledgement và `source_metadata.synthetic=true`: 4 canonical events, KPI `CONVERTED 4/4`, 2 traffic records `PRESENT` với cờ `synthetic=true`.
6. Bộ test Swarm/bootstrap/Web proxy sau sửa: 28 pass, 0 fail. Trước đó API suite: 183 pass, 4 skip; Traffic writer: 13 pass; Web build pass.

KafkaJS có ghi lỗi coordinator/transaction thoáng qua trong hai lần synthetic publish; publisher retry rồi hoàn tất, và DB xác nhận đủ từng run. Cần quan sát lỗi này khi kiểm thử tải, không diễn giải riêng dòng `PASS` của publisher thành bảo đảm zero-retry.

## Sửa lỗi phát hiện trong lần deploy

- Swarm task không pull được GHCR private dù `docker pull` trên client thành công: launcher thêm `--with-registry-auth`.
- Kafka controller không tự đăng ký qua service VIP lúc khởi động: quorum single-node chuyển sang localhost. Admin CLI healthcheck cũng bị vòng lặp DNS/readiness nên đổi sang local TCP probe.
- Swarm bỏ qua top-level Compose `tmpfs`, làm nginx fail read-only `/tmp`: đổi sang Swarm tmpfs volume mount; service spec đã xác nhận mount thực.
- API readiness ban đầu trả 200 nhưng `NOT_CONFIGURED`: bật worker health flag và health port, rồi xác minh đủ 7 worker `READY`.

## Chưa được xác nhận

- Source Connector ↔ Medusa HTTPS Event Feed, cursor/replay/retention, cũng như live end-to-end từ trình duyệt/Medusa. Synthetic fixture **không** chứng minh các đường này.
- HTTPS edge/certificate, DNS, truy cập từ client ngoài overlay; catalog sync, Qwen/AI, monitoring, autoscaler, Recovery Controller và các scenario scale/rollback/node failure/restore. Những module này chưa nằm trong Swarm candidate hiện tại.
- `ubuntuserver` không phải Pipeline Swarm manager trong lần kiểm tra này; chưa cutover hoặc thay thế hệ thống nào trên host đó.

Không được diễn giải replica healthy hay các API trả 200 thành claim full capability/cutover. Bước tiếp theo là hoàn thiện các overlay/module còn thiếu và kiểm thử Source Connector với feed lineage/cursor được review theo DEC-125 trước khi cho live data vào Swarm.
