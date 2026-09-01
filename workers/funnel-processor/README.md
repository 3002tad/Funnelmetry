# @funnelmetry/funnel-processor

Worker chiếu `journey.resolved.v1` thành Funnel Instance theo Funnel Profile bất biến và có
version:

```text
journey-resolved topic
  -> PostgreSQL funnel projection
  -> Kafka transaction: funnel-updated handoff + input offset
```

Các nguyên tắc hiện tại:

- Một entry event tạo một Funnel Instance riêng, kể cả cùng journey có nhiều lần thử.
- Step phải đúng cả `event_type` và `event_class`; browser intent không thể thay business fact.
- Projection được dựng lại từ Journey Event theo event-time, nên hỗ trợ event đến Kafka sai thứ tự.
- Negative event được giữ ở nhánh riêng và không đảo ngược một conversion đã hoàn tất.
- `conversion_horizon_seconds` và `late_arrival_grace_seconds` thuộc từng profile; worker không
  tự gán một con số kiến trúc mặc định.
- Worker chưa tự kết luận `DROPPED` theo thời gian. `time-semantics.v1` hiện chỉ cung cấp phép tính
  thuần; runtime maturity persistence/scheduler phải có contract và migration riêng trước khi bật.

## Chạy

Áp dụng ba migration trong `infra/postgres/v2/`, publish/activate ít nhất một profile cho
`source_id`, provision journey/funnel topic rồi:

```powershell
cd workers/funnel-processor
npm install
npm run profiles:publish-reference
npm start
```

Lệnh publish dùng `FUNNEL_PROFILE_SOURCE_ID` trong `infra/.env`, hiện cung cấp đúng hai profile
tham chiếu đã duyệt: Commerce Conversion và Online Payment. Chạy lại lệnh là idempotent nếu
profile cùng version không đổi; semantics khác phải dùng version mới.

Integration test PostgreSQL được bật khi có `TEST_DATABASE_URL`.
