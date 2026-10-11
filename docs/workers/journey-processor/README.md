# @funnelmetry/journey-processor

Progressive journey anchoring sau Canonical Ledger:

```text
canonical-persisted topic
  → PostgreSQL journey projection
  → Kafka transaction: journey-resolved handoff + input offset
```

Thứ tự evidence:

1. `STRONG`: direct correlation, cart/checkout/order/payment entity.
2. `MEDIUM`: authenticated user identity.
3. `WEAK`: session context.
4. Không đủ evidence: tạo journey cô lập mới.

`session_id` chỉ là context mapping, không phải `journey_id` hay event dedup key. Anonymous
identity chưa được reuse nếu thiếu subject/time policy đã benchmark. Nếu evidence trỏ tới
nhiều journey, processor rollback và không tự merge mù.

Confidence hiện là categorical (`STRONG | MEDIUM | WEAK | ISOLATED`), không hard-code
numeric threshold đang còn experimental.

Evidence trỏ tới nhiều journey làm PostgreSQL transaction rollback và không tự merge. Integration
test xác nhận event xung đột không tạo `journey_events` row và không thay đổi event count của hai
journey hiện hữu. Runtime hiện chưa có terminal conflict/DLQ contract; vì vậy conflict trên Kafka sẽ
được retry và có thể giữ partition tại offset đó. Không claim tự phục hồi cho tới khi handoff contract
được duyệt và triển khai.

## Chạy

Áp dụng hai migration trong `infra/postgres/v2/`, provision persisted/resolved topic rồi:

```powershell
cd workers/journey-processor
npm install
npm start
```
