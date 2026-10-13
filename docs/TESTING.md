# Kiểm thử Pipeline và mức bằng chứng

> **CURRENT TEST MAP — 2026-10-12.** Chạy từ root `Streaming_Pipeline`. Không dùng DB/volume demo thật cho test có ghi dữ liệu; không gửi event thật hoặc dùng key live khi test không yêu cầu. Một lệnh `npm test`/build thành công không chứng nhận end-to-end, production hoặc toàn bộ Master.

## Kiểm tra nhanh không làm thay đổi dữ liệu demo

| Mục tiêu | Lệnh / vị trí | Kết luận tối đa |
|---|---|---|
| Cú pháp stack Swarm phase 1 | `node runtime/swarm.mjs check` | Chỉ chứng minh render hợp lệ; chưa chứng minh service/UI chạy. Compose config là evidence legacy, không phải đường test triển khai mới. |
| Quy tắc Compose/monitoring runtime | `node --test runtime/unified-compose.test.mjs runtime/monitoring-rotation.test.mjs` | Test cấu hình/hành vi fixture, không bật dịch vụ |
| Dashboard API | `npm test --prefix apps/dashboard-api` | Unit/route tests; các bài PostgreSQL tùy cấu hình có thể skip |
| Chat semantic tool IDs | `node --test apps/dashboard-api/test/event-count-tool.test.js apps/dashboard-api/test/chat-v2.test.js` | Mock planner → HTTP route → registered runner/evidence cho ba tool; không gọi Qwen hoặc PostgreSQL thật |
| Dashboard Web | `npm run build --prefix apps/dashboard-web` và `node --test apps/dashboard-web/test/navigation.test.mjs` | Build/navigation, chưa phải browser với API thật |
| Contracts/packages | `npm test --prefix packages` | Test package, không kiểm tra Kafka/DB live |
| Analytical registry/assets | `node --test analytics/test/semantic-registry.test.mjs analytics/test/order-summary.test.mjs analytics/test/analysis-run.test.mjs` | Tool/metadata logic; kiểm tra output skip nếu thiếu DB |
| Bootstrap/observability artifacts | `node --test infra/bootstrap/bootstrap-handoff.test.mjs infra/observability/artifacts.test.mjs` | Schema/config artifact fixtures |
| Traffic raw input lineage | `npm test --prefix workers/traffic-source-writer` | Validation, idempotency và offset ordering bằng fixture; chưa xác nhận job schema/consumer trên DB và Kafka thật |
| Autoscaler policy/observer | `node --test tools/autoscaler/policy.test.mjs tools/autoscaler/observe.test.mjs` | Decision/observer tests; **không** chứng nhận actuator tự scale |

Các lệnh Node/npm cần dependency đã cài; `config --quiet` cần `deploy.env` thật nhưng không được in secret. Không dùng `--profile live` trong test đơn thuần nếu chưa được phép đọc Feed. Xem [`tests/README.md`](../tests/README.md) và README cạnh từng component cho test sâu hơn.

Hai bài Compose trong `runtime/unified-compose.test.mjs` tự SKIP nếu `TEST_COMPOSE_EXE` chưa trỏ tới Docker CLI; đặt biến đó bằng đường dẫn executable hợp lệ trước khi chạy để kiểm tra đủ cả profile. Không cần bật container để chạy `config` fixtures.

Với deployment mới hoặc sau khi build image chứa worker Traffic, kiểm tra `traffic-schema` hoàn tất, `traffic-source-writer` ready và Kafka group `funnelmetry-traffic-source-raw-v1` có offset tiến. Đối chiếu vài `event_id` đã biết trong `traffic_source_raw_events_v1` chỉ bằng truy vấn đọc, không in raw UTM. Hàng thiếu có thể do producer khác browser SDK, Raw Kafka đã hết retention hoặc worker chưa bắt kịp; không dùng số hàng làm tổng traffic/campaign chính thức.

## Tra cứu event trên Compose hiện hành (chỉ đọc)

Khi đã có `source_id` và `event_id` từ một event được gửi hợp lệ, chạy:

```powershell
node tools/event-trace/trace-event.mjs --source-id medusa-reference --event-id "EVENT_ID"
```

Nếu có record/receipt từ Source Feed với `event_feed_id` và `ingress_seq` chính xác, có thể đối chiếu thêm chặng Connector:

```powershell
node tools/event-trace/trace-event.mjs --source-id medusa-reference --event-id "EVENT_ID" --connector-id "CONNECTOR_ID" --event-feed-id "FEED_ID" --ingress-seq 42
```

Lệnh đọc PostgreSQL của project trong `runtime/deploy.env`; không gửi event, không sửa cursor hay dữ liệu. Kết quả cho biết receipt đã được lưu, canonicalization outcome, canonical ledger, journey, và nếu có thì ứng dụng funnel/KPI. Khi cung cấp tham chiếu Source, công cụ đối chiếu ingestion ID được Connector tạo từ `(event_feed_id, ingress_seq)`, Feed lineage và cursor ACK prefix. Tham chiếu này **do người vận hành cung cấp**, công cụ không tự xác minh Source Feed record hoặc tính toàn vẹn payload. Cursor chỉ là tiến độ Kafka handoff, không phải downstream processing-safe checkpoint. `NOT_OBSERVED_OR_NOT_APPLICABLE` ở funnel/KPI không tự chứng minh lỗi: có thể không có profile phù hợp hoặc worker chưa xử lý. Trạng thái `CANONICAL_JOURNEY_OBSERVED` chỉ xác nhận lineage trong PostgreSQL, **không** tự chứng minh độ đầy đủ dữ liệu hay production readiness. Không tính chênh lệch `ingress_seq` là số event mất.

Kiểm thử logic phân loại bằng chứng không cần Docker: `node --test tools/event-trace/trace-event.test.mjs`.

Admin có màn `/admin/event-trace` và API `GET /api/v2/admin/event-trace?source_id=...&event_id=...` cho tài khoản có `pipeline.monitor`. API chỉ trả metadata được chọn lọc từ receipt/outcome/ledger/projection, không trả raw payload. Test quyền và redaction: `node --test apps/dashboard-api/test/event-trace.test.js apps/dashboard-web/test/navigation.test.mjs`. API/UI chỉ quan sát PostgreSQL; tham chiếu Source/Connector bổ sung hiện có ở CLI bên trên, không phải ở màn Admin.

Trong Event Trace, `GET /api/v2/admin/traffic-source-input?source_id=...&event_id=...` đọc riêng projection UTM thô ở grain event. API chỉ trả trạng thái, loại event, thời điểm và synthetic; không trả raw UTM/hash. Bảng chưa có hoặc DB lỗi trả 503, UI không diễn giải thành `ABSENT`; không có hàng trả `NOT_OBSERVED`, có thể do event backend/retention/worker chưa xử lý. Test quyền, tham số và redaction: `node --test apps/dashboard-api/test/traffic-source-observation.test.js`; build UI bằng `npm run build --prefix apps/dashboard-web`. Đây không phải kiểm thử Traffic attribution.

DA có `/traffic` và `GET /api/v2/analytics/traffic-input?source_id=...&from=...&to=...` để đếm event browser đã được chiếu từ Raw Kafka theo `received_at` (cửa sổ tối đa 90 ngày). API chỉ trả count dạng chuỗi, latest timestamp, synthetic count và contract giới hạn; không trả raw UTM/hash. Test quyền, query bounds và redaction: `node --test apps/dashboard-api/test/traffic-input.test.js apps/dashboard-web/test/navigation.test.mjs`. Khi nghiệm thu Docker, so sánh một cửa sổ UTC cụ thể với bảng `traffic_source_raw_events_v1` và xác nhận worker đã xử lý; count bằng 0 không chứng minh Feed hoặc Raw Kafka không có event. Đây chưa phải channel attribution hoặc kiểm tra coverage lịch sử.

Traffic Source Registry có `traffic/002_source_registry.sql`, job `traffic-registry-schema`, API `GET/POST /api/v2/analytics/traffic-source-registry` và `POST .../lookup`. Role `analyst` có `analytics.workspace.use` và `traffic.mapping.write`; staff cũ không vào được trang/API Traffic. Test exact-hash, compare-and-swap, audit, quyền và redaction bằng `node --test apps/dashboard-api/test/traffic-source-registry.test.js`. `GET /api/v2/analytics/traffic-input/breakdown` nhóm event có UTM theo **nhãn registry hiện tại** hoặc “chưa map”; top 25 nhóm, không suy order/campaign attribution. Khi nghiệm thu thật, gán một UTM test bằng Analyst, đối chiếu phân nhóm trước/sau, kiểm tra audit và đảm bảo API không trả raw/hash. Thay nhãn có thể đổi kết quả đọc lịch sử mà không sửa event gốc.

Evidence cục bộ 12/10: hai migration Traffic đã chạy hai lần liên tiếp trên PostgreSQL container tạm và idempotent; container test đã được dừng/xóa. Deployment `core` hiện hành đã build từ source, `traffic-schema` và `traffic-registry-schema` exit 0, `traffic-source-writer` và Dashboard API/Web healthy, `/traffic` và `/healthz` trả 200. Đăng nhập Admin thành công; Admin gọi API Traffic nhận 403 đúng phân quyền. **Chưa** bật Live Feed trong lần kiểm này, chưa tạo mapping bằng Analyst trên DB demo, chưa chứng minh event mới đi qua registry hoặc completeness lịch sử.

Admin có màn `/admin/model-provider` và API `GET /api/v2/admin/model-provider` để xem cấu hình Qwen của tiến trình API hiện tại, không trả key hay endpoint và không gọi Model Studio. Test quyền/redaction: `node --test apps/dashboard-api/test/model-provider.test.js apps/dashboard-web/test/navigation.test.mjs`. `CONFIGURED` chỉ chứng minh cờ/key/endpoint hợp lệ về cú pháp, không chứng minh quyền key, quota, kết nối hoặc kết quả chat.

Admin có màn `/admin/agent` và API `GET /api/v2/admin/agent-observability` đếm evidence của **completed analytical tool executions đã lưu** theo bốn trạng thái trong 30 ngày. Test quyền, grain, count chính xác và không lộ actor/document: `node --test apps/dashboard-api/test/agent-observability.test.js apps/dashboard-web/test/navigation.test.mjs`. Không xem số liệu này là tổng request/chat, tỷ lệ thành công Agent hoặc số lỗi upstream/DB; API không có prompt/LLM telemetry.

### Kiểm chứng bổ sung 12/10 trên project mới

- Sau khi rebuild Dashboard API, proxy UI → API trả `401` cho `/api/auth/me` khi chưa đăng nhập (đúng kỳ vọng), không phải `502`.
- Bộ test Dashboard API: 183 pass, 4 skip, 0 fail. Thao tác tạo, đổi nhãn, retry idempotent và hai audit row của Traffic Registry đã chạy trên PostgreSQL thật trong một transaction rồi `ROLLBACK`; không để lại mapping thử.
- Profile `catalog` đã bật riêng trong `runtime/deploy.env` cục bộ; `catalog-sync` healthy và log báo `catalog_reference_saved` với 104 bản ghi. Đây là metadata hiện tại, chưa xác nhận coverage/freshness toàn bộ sản phẩm và không phải giá lịch sử.
- Feed preflight chỉ đọc xác nhận đúng `event_feed_id`, `retention_floor_seq=0` và `latest_available_seq=450`. Project đã có cursor 442 cùng lineage; sau khi bật `live,catalog`, Connector healthy và cursor tiến đến 450, không reset về 0. Trace read-only event `browser:49df62d3-cb75-4187-b111-d0d14bf15f46` ở sequence 450 trả `CANONICAL_JOURNEY_OBSERVED`, không mismatch: accepted receipt, source handoff/ACK prefix, canonical outcome `normalized`, canonical ledger `promotion.banner_impression`, journey và KPI application có evidence; funnel `NOT_OBSERVED_OR_NOT_APPLICABLE`. Traffic projection là `ABSENT` (event này không có raw `utm_source`). Catalog snapshot hiện tại có 104 tên sản phẩm. Đây là bằng chứng theo **một event**, không chứng minh mọi sequence/worker/reconciliation đã hoàn tất hay dữ liệu lịch sử đủ cho sản phẩm phân tích.

Monitoring profile cũng đã provision trên project cục bộ. Lần đầu launcher fail acceptance vì smoke test còn cố định 6 worker; Prometheus đã có 7 series, bao gồm `traffic-source-writer`. Sau khi sửa kiểm tra theo đúng tập worker, `node runtime/check-monitoring.mjs` PASS: Grafana 8 panel, Prometheus UP=1 và 7 worker ready. Chạy lại `node runtime/deploy.mjs start` với cả ba profile `live,catalog,monitoring` đã PASS, giữ nguyên volume/cursor. Không dùng kết quả này để claim auto-healing hay high availability. Gọi trực tiếp Qwen Flash/Singapore bằng prompt kiểm tra không chứa dữ liệu khách hàng cũng PASS; đây chỉ là provider connectivity, chưa phải nghiệm thu Chat/tool/evidence đầy đủ.

## Acceptance khi bật demo

1. Ghi commit hoặc image digest, project, profile và nguồn dữ liệu; phân biệt `OFFLINE_DEMO`, `PARALLEL_LIVE`, `RESTORE_REHEARSAL`, `MIGRATION_CUTOVER` theo [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md).
2. Kiểm tra service health/readiness, nhưng không dừng ở HTTP 200. Với event có `source_id`/`event_id` cụ thể, xác nhận Source Feed → Connector cursor/Kafka ACK → canonical outcome/ledger → projection và quality/reconciliation tương ứng. Không trừ sequence/offset để suy số event bị mất.
3. Với Catalog, đối chiếu product ID/name và snapshot/freshness; không lấy giá catalog hiện tại làm giá lịch sử.
4. Với AI, kiểm tra câu trả lời được route qua tool có quyền, provenance, warning, window/currency/grain; câu hỏi không được hỗ trợ phải nói rõ thiếu tool/dữ liệu, không bịa số.
5. Với monitoring, provision credential mới, kiểm tra quyền Admin/machine, metrics scrape, trạng thái unknown và cảnh báo; một trang mở/Prometheus UP không chứng minh toàn Pipeline khỏe.
6. Ghi rõ PASS/FAIL/SKIP, thời điểm, dữ liệu test và giới hạn. Không biến một demo thành claim production hoặc restore tổng quát.

## Hướng dẫn test cũ chưa dùng trực tiếp

[`tools/v2-e2e/README.md`](../tests/tools/v2-e2e/README.md) hiện còn lệnh `infra/compose.v2.yml` và profile `smoke` đã bị loại khỏi bộ Compose thống nhất. Đó là hướng dẫn cho topology cũ, **không chạy nguyên lệnh trên deployment hiện tại**. Trước khi có runner E2E mới cho `infra/compose.yaml`, dùng project test riêng và acceptance có kiểm soát; không reset cursor/volume demo để chạy lại bài test cũ. Các ghi nhận test ngày 08–10/10 trong [hồ sơ Admin/monitoring](archive/MONITORING_HISTORY.md) là bằng chứng theo phiên bản, không phải kết quả chạy hôm nay.

Nguồn chuẩn cho semantics/test acceptance: [Master Specification](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md) và [Core Implementation Contracts](https://github.com/3002tad/System_Backbone/blob/main/docs/implementation/CORE_IMPLEMENTATION_CONTRACTS_V1.md).
