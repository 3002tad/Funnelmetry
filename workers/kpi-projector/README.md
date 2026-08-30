# @funnelmetry/kpi-projector

Worker materialize `funnel.updated.v1` thành KPI base fact trong PostgreSQL:

```text
funnel-updated topic
  -> idempotent Funnel Instance KPI facts
  -> observed profile/step aggregate views
  -> Kafka transaction: kpi-updated handoff + input offset
```

Projection lưu snapshot theo `funnel_instance_id` cùng SHA-256 hash và revision. Redelivery hoặc
snapshot không đổi không cộng counter lần nữa. Outcome và quality được giữ thành hai chiều riêng.

Hai view hiện có:

- `funnel_kpi_profile_observed_totals`
- `funnel_kpi_step_observed_totals`

Các view này cố ý mang tên `observed`: chúng không claim matured/final conversion rate. KPI time
window vẫn chờ contract được chốt, nên worker không hard-code bucket 1 phút hay horizon.

## Chạy

Áp dụng bốn migration trong `infra/postgres/v2/`, provision funnel/kpi topic rồi:

```powershell
cd workers/kpi-projector
npm install
npm start
```

Integration test PostgreSQL được bật khi có `TEST_DATABASE_URL`.
