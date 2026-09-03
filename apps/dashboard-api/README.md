# dashboard-api

## Local V2 demo data

The demo seeder applies PostgreSQL migrations `001` through `011`, creates an
`analyst` account, and inserts a small source-scoped dataset for the dashboard:

```powershell
$env:DEMO_DATABASE_URL = "postgresql://app:demo@127.0.0.1:55432/realtime"
npm run demo:seed-v2
```

Default credentials are `analyst@funnelmetry.local` / `funnelmetry-demo` and
the seeded analytics source is `medusa-reference`. Use this only with a local
demo database; it is not production bootstrap data.

Tài liệu V1 tham khảo: **[API](../../legacy/docs-v1/API.md)** · **[Tech stack](../../legacy/docs-v1/TECH_STACK.md)**

## Analytics API V2

Các endpoint read-only mới đọc trực tiếp Journey/Funnel/KPI projection V2:

```text
GET /api/v2/analytics/overview?source_id=medusa-reference&from=<ISO>&to=<ISO>
GET /api/v2/analytics/funnels/:profileId?source_id=medusa-reference&profile_version=1.0.0
GET /api/v2/analytics/journeys?source_id=medusa-reference&limit=25
GET /api/v2/analytics/journeys/:journeyId?source_id=medusa-reference
GET /api/v2/analytics/events?source_id=medusa-reference&event_class=BUSINESS_FACT&limit=50
GET /api/v2/analytics/data-health?source_id=medusa-reference&from=<ISO>&to=<ISO>
```

Các endpoint dùng authentication/role zone giống shop analytics API hiện tại. `source_id` là bắt
buộc. `from`/`to` dùng `entry_at` cho Funnel KPI, `occurred_at` cho Event browser và `persisted_at`
cho canonical Data Health; response luôn ghi rõ window basis. Funnel cohort không được diễn giải là
KPI window đã mature. Response funnel ghi `metric_state: OBSERVED` và giữ outcome/quality thành hai chiều riêng.
Overview và funnel totals công bố riêng `finalized_dropped`, `late_conversions`, hai arrival class và
`late_conversion_rate = late_conversions / finalized_dropped`; late conversion không được cộng vào
`observed_converted` hay sửa historical horizon metric.
Final KPI công bố `eligible_matured`, `matured_converted`, `final_end_to_end_rate` và
`final_dropoff_rate`; pending, unconfigured hoặc non-authoritative conversion không vào mẫu số này.

Journey detail chỉ trả canonical event metadata và evidence summary; không trả raw/canonical
payload, identity value hoặc `journey_entities.entity_key`. Event browser cũng loại bỏ normalized data,
relations, source event identity và aggregate ID.
Late-conversion detail chỉ trả classification, timestamps và loại/phương pháp liên kết; không trả
matched business-key value hoặc evidence document nội bộ.

Data Health công bố metric từ accepted ingress receipt, terminal canonicalization outcome, canonical
ledger và Funnel KPI facts: terminal outcome rate, canonicalization/normalization/persistence latency,
time-basis quality và projection quality. Các metric pre-handoff loss, duplicate/rejected attempt,
queue drop và reconciliation vẫn được trả trong `unavailable_metrics` thay vì dựng số.

Dashboard UI hiện dùng API V2 cho Overview, Funnels, Journeys, Events và Data Health.

HTTP contract test khởi chạy Express trên cổng tạm và kiểm tra `401`, `403`, `400`, `404`, role
`analyst/viewer`, query validation và response thành công. PostgreSQL integration test được bật khi có
`TEST_DATABASE_URL`.
