# Admin/monitoring implementation evidence — 08–10/10/2026

> **HISTORICAL / NON-NORMATIVE.** Hồ sơ này gộp bảy bản ghi `ADMIN_*_2026-10-08/09/10.md` của Pipeline. Số test, image tag và trạng thái container dưới đây thuộc các mốc đó, **không** phải kết quả chạy trên deployment hiện tại. Xem [trạng thái chức năng](../FEATURE_STATUS.md), [kiểm thử](../TESTING.md) và [vận hành](../OPERATIONS.md) trước khi demo. Bản gốc vẫn truy vết được qua Git history theo tên file cũ.

## Tóm tắt theo mốc

| Ngày / capability | Đã triển khai tại mốc đó | Bằng chứng / giới hạn |
|---|---|---|
| 08/10 — Event Feed | Connector lưu `feed_observation` trong memory sau whole-batch validation; `GET /api/v2/admin/event-feed` và trang Admin read-only | Connector 34 PASS; API 144 PASS, 4 DB-dependent SKIP; navigation 5 PASS/build PASS. Chưa có live-source/browser E2E ở đợt này. |
| 08/10 — Processing | `GET /api/v2/admin/processing` tổng hợp PostgreSQL latest outcomes/canonical/KPI và trang stage cards | API 145 PASS, 4 SKIP; PostgreSQL shadow-table + local HTTP smoke. Không phải Kafka lag hay completeness audit. |
| 08/10 — Kafka lag | `GET /api/v2/admin/kafka-lag` đọc allowlisted group/topic offsets bằng KafkaJS admin | API 151 PASS, 4 SKIP; offline broker 7 pairs/partitions, NO_COMMITTED_OFFSET. Chưa thử workload live nonempty. |
| 09/10 — Membership | Additive `membership` (status/state/member_count) theo broker group trên lag API | API 154 PASS, 4 SKIP; broker demo 6 groups Stable/1 member, 7 topic rows. Không có worker-kill/browser automation. |
| 09/10 — Worker readiness | `/healthz`/`/readyz` nội bộ cho sáu worker; `GET /api/v2/admin/worker-readiness` và UI cards | API 158 PASS, 4 SKIP; worker/shared health 85 PASS, 6 SKIP; sáu demo endpoints READY. Chỉ process-local runtime flag, không phải continuous DB check hay all-replica inventory. |
| 09/10 — Metrics | Authenticated `GET /api/v2/admin/metrics` xuất Prometheus text 0.0.4 từ bounded probes | API 162 PASS, 4 SKIP; real HTTP metrics và `promtool check metrics` PASS. Chưa có unattended scrape/alert delivery ở đợt này. |
| 10/10 — Monitoring warnings | `GET /api/v2/admin/monitoring-alerts`, Prometheus target/worker/key-expiry observations và UI poll khi trang mở | API 169 PASS, 4 SKIP; local fault test stop/restart một worker rồi warning clear. Chưa chứng minh catch-up/idempotency dưới tải, persisted incident hay external notification. |

Đây là các snapshot test suite tăng dần, **không cộng** chúng thành tổng số test độc lập. Các tag local cũ (`20261008-*`, `20261009-*`, `20261010-*`) không tự chứa thay đổi mới và không phải digest phát hành hiện hành.

## Semantics và ranh giới bảo mật còn phải giữ

- Tất cả Admin APIs cần current session + `pipeline.monitor`, recheck sau bounded probe/query, `no-store`; không nhận broker/URL/topic tùy ý từ client. Không có Docker control, reset offset/cursor, replay hay scale endpoint. Analyst/anonymous không có quyền.
- Event Feed observation có thể cũ sau poll error hoặc mất khi Connector restart. Nó được chụp **trước** Kafka publish; valid Source batch không chứng minh durable Pipeline handoff. Sequence gap không phải số event thiếu.
- Processing counts có grain khác nhau: latest outcome per source event, canonical per mapping version và KPI application per trigger. Không trừ count/timestamp giữa grain để suy backlog hoặc latency. DB/schema failure phải là unavailable, không là zero.
- Kafka lag là high offset trừ committed **next** offset theo partition, unit offset positions. Missing commit, below retention, inconsistent snapshot và oversized response trả unknown/null; lag zero không chứng minh worker đang xử lý. Membership Stable/member count là broker group evidence, không phải số container hay business-event completeness.
- Worker readiness chỉ kiểm tra fixed internal targets và local Kafka runtime flag. `healthz` khác `readyz`; endpoint worker không được public. Unreachable/old image/mismatch là `UNVERIFIED`, không tự suy STOPPED.
- Metrics unknown không bị xuất thành zero; exact large offsets vượt safe float bị bỏ khỏi metric nhưng JSON API có decimal string. Scrape HTTP 200 chỉ là collection; phải xem availability/freshness. Label/cardinality từ allowlist, không xuất member identity, payload, secret hay raw error.
- Monitoring warnings phân biệt scrape DOWN với target UNKNOWN, worker non-ready với absent observation, và key expiry với key actually used. Browser poll mỗi 15 giây chỉ khi mở trang; không có sustained-condition window, Alertmanager/email, ack history hoặc auto-recovery.

## Giới hạn bàn giao

Đợt 08–10/10 phần lớn dùng demo/project và image cũ. Sau khi chuyển sang một Compose/env mới, monitoring secret cũ đã xóa; cần provision lại và chạy acceptance của deployment mới. Không nâng kết quả lịch sử thành claim rằng Prometheus/Grafana, Admin alerts hoặc live Medusa/Qwen đang hoạt động trên máy nhận.

Nguồn gốc trong Git history: `docs/ADMIN_EVENT_FEED_2026-10-08.md`, `ADMIN_PROCESSING_2026-10-08.md`, `ADMIN_KAFKA_LAG_2026-10-08.md`, `ADMIN_KAFKA_MEMBERSHIP_2026-10-09.md`, `ADMIN_WORKER_READINESS_2026-10-09.md`, `ADMIN_MONITORING_METRICS_2026-10-09.md`, `ADMIN_MONITORING_ALERTS_2026-10-10.md`. Hồ sơ này tóm lược, không thay thế source code/test hay Backbone Master.
